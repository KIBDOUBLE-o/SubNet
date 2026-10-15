from __future__ import annotations

import base64
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

import pyautogui
from pynput import keyboard as pynput_keyboard
from pynput.keyboard import Controller as KeyController, Key

from client.client import Client, Payload
from utils import capture_screen, execute_bash, encode_base64, build_local_tree, decode_base64, notify

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

keyboard = KeyController()

QUALITY_MAP = {
    "low": (40, 0.4),
    "mid": (55, 0.55),
    "medium": (55, 0.55),
    "high": (75, 0.75),
}

PNPUT_KEYS = {
    "ctrl": Key.ctrl,
    "control": Key.ctrl,
    "shift": Key.shift,
    "alt": Key.alt,
    "win": Key.cmd,
    "meta": Key.cmd,
    "command": Key.cmd,
    "esc": Key.esc,
    "escape": Key.esc,
    "enter": Key.enter,
    "return": Key.enter,
    "tab": Key.tab,
    "space": Key.space,
    "backspace": Key.backspace,
    "delete": Key.delete,
    "up": Key.up,
    "down": Key.down,
    "left": Key.left,
    "right": Key.right,
    "arrowup": Key.up,
    "arrowdown": Key.down,
    "arrowleft": Key.left,
    "arrowright": Key.right,
    "home": Key.home,
    "end": Key.end,
    "pageup": Key.page_up,
    "pagedown": Key.page_down,
    "capslock": Key.caps_lock,
    "f1": Key.f1,
}


class Slave(Client):
    # окно между нажатиями Alt+F1 (сек)
    OVERCONTROL_COMBO_TIMEOUT = 1.5
    OVERCONTROL_COMBO_NEED = 3

    def __init__(self, password: str = "wrong"):
        super().__init__(password=password, auto_reconnect=True, identifier_t="s")
        self._stream_stop = threading.Event()
        self._stream_lock = threading.Lock()

        self._frame_lock = threading.Lock()
        self._pending_frame: str | None = None
        self._frame_ready = threading.Event()

        self._screen_w, self._screen_h = pyautogui.size()

        # --- Overcontrolling ---
        self._alt_pressed = False
        self._overcontrol_count = 0
        self._overcontrol_last_ts = 0.0
        self._overcontrol_lock = threading.Lock()
        self._hotkey_listener: pynput_keyboard.Listener | None = None
        self.overcontrolling = False

    def run(self) -> None:
        self._start_hotkey_listener()
        self.start()
        try:
            while self.running:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self._stop_hotkey_listener()
            self._stop_stream()
            self.stop()

    def on_auth_success(self, response: str) -> None:
        print(f"Auth success: {response}")

    def on_disconnected(self) -> None:
        print("Disconnected.")

    # ---------- overcontrolling ----------

    def onOvercontrollingToggle(self) -> None:
        self.overcontrolling = not self.overcontrolling
        notify(title="Slave Overcontrolling", message=f"Your overcontrolling is {"enabled." if self.overcontrolling else "disabled."}")

    def _register_alt_f1(self) -> None:
        """Одно срабатывание комбинации Alt+F1."""
        now = time.monotonic()
        with self._overcontrol_lock:
            if now - self._overcontrol_last_ts > self.OVERCONTROL_COMBO_TIMEOUT:
                self._overcontrol_count = 0
            self._overcontrol_count += 1
            self._overcontrol_last_ts = now
            count = self._overcontrol_count
            if count >= self.OVERCONTROL_COMBO_NEED:
                self._overcontrol_count = 0

        print(f"[slave] Alt+F1 ({count}/{self.OVERCONTROL_COMBO_NEED})")
        if count >= self.OVERCONTROL_COMBO_NEED:
            try:
                self.onOvercontrollingToggle()
            except Exception as e:
                print(f"[slave] onOvercontrollingToggle error: {e}")

    def _start_hotkey_listener(self) -> None:
        """Локальный перехват Alt+F1 на машине slave."""

        def on_press(key):
            try:
                if key in (Key.alt, Key.alt_l, Key.alt_r):
                    self._alt_pressed = True
                    return
                if self._alt_pressed and key == Key.f1:
                    self._register_alt_f1()
            except Exception:
                pass

        def on_release(key):
            try:
                if key in (Key.alt, Key.alt_l, Key.alt_r):
                    self._alt_pressed = False
            except Exception:
                pass

        self._hotkey_listener = pynput_keyboard.Listener(
            on_press=on_press,
            on_release=on_release,
        )
        self._hotkey_listener.daemon = True
        self._hotkey_listener.start()

    def _stop_hotkey_listener(self) -> None:
        if self._hotkey_listener is not None:
            try:
                self._hotkey_listener.stop()
            except Exception:
                pass
            self._hotkey_listener = None

    # ---------- stream ----------

    def _start_stream(self, master: str, fps: int, quality_name: str):
        with self._stream_lock:
            self._stream_stop.set()
            stop = threading.Event()
            self._stream_stop = stop

        q, scale = QUALITY_MAP.get(quality_name.lower(), (55, 0.55))
        fps = max(1, min(int(fps), 30))

        with self._frame_lock:
            self._pending_frame = None
            self._frame_ready.clear()

        threading.Thread(target=self._capture_loop, args=(fps, q, scale, stop), daemon=True).start()
        threading.Thread(target=self._send_loop, args=(master, stop), daemon=True).start()

    def _stop_stream(self):
        with self._stream_lock:
            self._stream_stop.set()
        with self._frame_lock:
            self._pending_frame = None
            self._frame_ready.clear()

    def _capture_loop(self, fps: int, quality: int, scale: float, stop: threading.Event):
        interval = 1.0 / fps
        while not stop.is_set() and self.running:
            t0 = time.monotonic()
            try:
                frame = capture_screen(quality=quality, scale=scale)
                with self._frame_lock:
                    self._pending_frame = frame
                    self._frame_ready.set()
            except Exception as e:
                print(f"[slave] capture error: {e}")
            stop.wait(max(0.0, interval - (time.monotonic() - t0)))

    def _send_loop(self, master: str, stop: threading.Event):
        while not stop.is_set() and self.running:
            if not self._frame_ready.wait(timeout=0.5):
                continue
            with self._frame_lock:
                frame = self._pending_frame
                self._pending_frame = None
                self._frame_ready.clear()
            if not frame:
                continue
            try:
                self.send(f"send slave_screen {master} {frame}")
            except Exception as e:
                print(f"[slave] send frame error: {e}")
                break

    # ---------- input ----------

    def _norm_to_screen(self, nx: float, ny: float) -> tuple[int, int]:
        nx = max(0.0, min(1.0, float(nx)))
        ny = max(0.0, min(1.0, float(ny)))
        x = int(nx * (self._screen_w - 1))
        y = int(ny * (self._screen_h - 1))
        return x, y

    def _resolve_key(self, key: str):
        k = key.strip().lower()
        if k in PNPUT_KEYS:
            return PNPUT_KEYS[k]
        if len(k) == 1:
            return k
        if k.startswith("f") and k[1:].isdigit():
            return getattr(Key, k, k)
        return k

    def _handle_input(self, tokens: list[str]):
        if self.overcontrolling:
            return
        if len(tokens) < 2:
            return
        action = tokens[1]

        try:
            if action == "mouse_move" and len(tokens) >= 4:
                x, y = self._norm_to_screen(tokens[2], tokens[3])
                pyautogui.moveTo(x, y)

            elif action == "mouse_down" and len(tokens) >= 5:
                btn = tokens[2]
                x, y = self._norm_to_screen(tokens[3], tokens[4])
                pyautogui.moveTo(x, y)
                pyautogui.mouseDown(button=btn)

            elif action == "mouse_up" and len(tokens) >= 5:
                btn = tokens[2]
                x, y = self._norm_to_screen(tokens[3], tokens[4])
                pyautogui.moveTo(x, y)
                pyautogui.mouseUp(button=btn)

            elif action == "mouse_scroll" and len(tokens) >= 4:
                dy = int(float(tokens[3]))
                if dy:
                    pyautogui.scroll(dy)

            elif action == "key_down" and len(tokens) >= 3:
                raw = tokens[2].strip().lower()
                k = self._resolve_key(raw)
                print(f"[input] key_down {tokens[2]!r} -> {k!r}")
                # на случай, если combo приходит удалённо
                if raw in ("alt",):
                    self._alt_pressed = True
                elif raw == "f1" and self._alt_pressed:
                    self._register_alt_f1()
                keyboard.press(k)

            elif action == "key_up" and len(tokens) >= 3:
                raw = tokens[2].strip().lower()
                k = self._resolve_key(raw)
                print(f"[input] key_up {tokens[2]!r} -> {k!r}")
                if raw in ("alt",):
                    self._alt_pressed = False
                keyboard.release(k)

            elif action == "key_tap" and len(tokens) >= 3:
                k = self._resolve_key(tokens[2])
                keyboard.press(k)
                keyboard.release(k)

            elif action == "key_hotkey" and len(tokens) >= 3:
                combo = tokens[2].strip().lower()
                if combo in ("alt+f1", "f1+alt"):
                    self._register_alt_f1()
                keys = [self._resolve_key(k) for k in combo.split("+") if k]
                for k in keys:
                    keyboard.press(k)
                for k in reversed(keys):
                    keyboard.release(k)

        except Exception as e:
            print(f"[slave] input error: {e} | {tokens}")

    def on_message(self, message: str) -> Optional[Payload]:
        if message.strip() == "ping":
            return "pong"

        tokens = message.split()
        if not tokens or tokens[0] != "request" or len(tokens) < 2:
            return None

        subject = tokens[1]

        if subject == "stream_start":
            if len(tokens) < 5:
                return None
            master = tokens[2]
            try:
                fps = int(tokens[3])
            except ValueError:
                fps = 15
            self._start_stream(master, fps, tokens[4])

        elif subject == "stream_stop":
            self._stop_stream()

        elif subject == "slave_screen":
            quality_name = tokens[2].lower() if len(tokens) > 2 else "mid"
            q, scale = QUALITY_MAP.get(quality_name, (55, 0.55))
            master = tokens[-1] if len(tokens) >= 3 else ""
            try:
                frame = capture_screen(quality=q, scale=scale)
                if master:
                    self.send(f"send slave_screen {master} {frame}")
            except Exception as e:
                print(f"[slave] single frame error: {e}")

        elif subject == "common_info":
            master = tokens[-1]
            try:
                info = {"path": str(Path.cwd())}
                if master:
                    self.send(f"send common_info {master} {encode_base64(json.dumps(info))}")
            except Exception as e:
                print(f"[slave] common info consuming error: {e}")

        elif subject == "local":
            path = " ".join(tokens[2:-1])
            master = tokens[-1]
            try:
                local = build_local_tree(path)
                if master:
                    self.send(f"send local {master} {encode_base64(json.dumps(local))}")
            except Exception as e:
                print(f"[slave] local consuming error: {e}")

        elif subject == "file":
            path = " ".join(tokens[2:-1])
            master = tokens[-1]
            try:
                with open(path, "rb") as file:
                    content = base64.b64encode(file.read()).decode("ascii")
                    payload = encode_base64(f"{path}\1{content}")
                    if master:
                        self.send(f"send file {master} {payload}")
            except Exception as e:
                print(f"[slave] file consuming error: {e}")

        elif subject == "create":
            path = " ".join(tokens[2:-2])
            is_folder = tokens[-2] == "True"
            master = tokens[-1]
            try:
                if not os.path.exists(path):
                    if is_folder:
                        os.mkdir(path)
                    else:
                        with open(path, "w") as file:
                            file.write("")
                local = build_local_tree("\\".join(path.split("\\")[:-1]))
                if master:
                    self.send(f"send local {master} {encode_base64(json.dumps(local))}")
            except Exception as e:
                print(f"[slave] item creating error: {e}")

        elif subject == "remove":
            path = " ".join(tokens[2:-2])
            is_folder = tokens[-2] == "True"
            master = tokens[-1]
            try:
                if os.path.exists(path):
                    if is_folder:
                        shutil.rmtree(path)
                    else:
                        os.remove(path)
                local = build_local_tree("\\".join(path.split("\\")[:-1]))
                if master:
                    self.send(f"send local {master} {encode_base64(json.dumps(local))}")
            except Exception as e:
                print(f"[slave] item removing error: {e}")

        elif subject == "save":
            path = " ".join(tokens[2:-2])
            content = base64.b64decode(tokens[-2])
            try:
                with open(path, "wb") as file:
                    file.write(content)
            except Exception as e:
                print(f"[slave] file saving error: {e}")

        elif subject == "rename":
            path = " ".join(tokens[2:-2])
            new_path = decode_base64(tokens[-2])
            master = tokens[-1]
            try:
                if os.path.exists(path):
                    os.rename(path, new_path)
                local = build_local_tree("\\".join(path.split("\\")[:-1]))
                if master:
                    self.send(f"send local {master} {encode_base64(json.dumps(local))}")
            except Exception as e:
                print(f"[slave] file renaming error: {e}")

        elif subject == "move":
            path = " ".join(tokens[2:-2])
            new_path = decode_base64(tokens[-2])
            master = tokens[-1]
            try:
                if os.path.exists(path):
                    shutil.move(path, new_path)
                local = build_local_tree("\\".join(path.split("\\")[:-1]))
                if master:
                    self.send(f"send local {master} {encode_base64(json.dumps(local))}")
            except Exception as e:
                print(f"[slave] file moving error: {e}")

        elif subject == "bash_execution":
            bash = " ".join(tokens[2:-1])
            master = tokens[-1]
            try:
                result = encode_base64(execute_bash(bash))
                if master:
                    self.send(f"send bash_execution {master} {result}")
            except Exception as e:
                if master:
                    self.send(f"send bash_execution {master} {encode_base64(f'Execution error: {e}')}")
                print(f"[slave] bash executing error: {e}")

        elif subject == "input":
            self._handle_input(tokens[1:])

        return None
