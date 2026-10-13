from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import pyautogui

from client.client import Client, Payload
from utils import capture_screen, execute_bash, encode_base64, build_local_tree, decode_base64

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

QUALITY_MAP = {
    "low": (40, 0.4),
    "mid": (55, 0.55),
    "medium": (55, 0.55),
    "high": (75, 0.75),
}

# browser key -> pyautogui key
KEY_MAP = {
    "control": "ctrl",
    "ctrl": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "meta": "win",
    "command": "command",
    "escape": "esc",
    "esc": "esc",
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    " ": "space",
    "space": "space",
    "enter": "enter",
    "return": "enter",
    "backspace": "backspace",
    "tab": "tab",
    "delete": "delete",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "capslock": "capslock",
}


class Slave(Client):
    def __init__(self, password: str = "wrong"):
        super().__init__(password=password, auto_reconnect=True, identifier_t="s")
        self._stream_stop = threading.Event()
        self._stream_lock = threading.Lock()

        self._frame_lock = threading.Lock()
        self._pending_frame: str | None = None
        self._frame_ready = threading.Event()

        self._screen_w, self._screen_h = pyautogui.size()

    def run(self) -> None:
        self.start()
        try:
            while self.running:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self._stop_stream()
            self.stop()

    # ---------- stream (как было) ----------

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

    def _map_key(self, key: str) -> str:
        k = key.strip().lower()
        if len(k) == 1:
            return k
        return KEY_MAP.get(k, k)

    def _handle_input(self, tokens: list[str]):
        # tokens: ["input", <action>, ...]
        if len(tokens) < 2:
            return
        action = tokens[1]

        try:
            if action == "mouse_move" and len(tokens) >= 4:
                x, y = self._norm_to_screen(tokens[2], tokens[3])
                pyautogui.moveTo(x, y, _pause=False)

            elif action == "mouse_down" and len(tokens) >= 5:
                btn = tokens[2]
                x, y = self._norm_to_screen(tokens[3], tokens[4])
                pyautogui.moveTo(x, y, _pause=False)
                pyautogui.mouseDown(button=btn, _pause=False)

            elif action == "mouse_up" and len(tokens) >= 5:
                btn = tokens[2]
                x, y = self._norm_to_screen(tokens[3], tokens[4])
                pyautogui.moveTo(x, y, _pause=False)
                pyautogui.mouseUp(button=btn, _pause=False)

            elif action == "mouse_click" and len(tokens) >= 5:
                btn = tokens[2]
                x, y = self._norm_to_screen(tokens[3], tokens[4])
                pyautogui.click(x=x, y=y, button=btn, _pause=False)

            elif action == "mouse_scroll" and len(tokens) >= 4:
                dx, dy = int(float(tokens[2])), int(float(tokens[3]))
                if dy:
                    pyautogui.scroll(dy, _pause=False)
                if dx:
                    try:
                        pyautogui.hscroll(dx, _pause=False)
                    except Exception:
                        pass

            elif action == "key_down" and len(tokens) >= 3:
                pyautogui.keyDown(self._map_key(tokens[2]), _pause=False)

            elif action == "key_up" and len(tokens) >= 3:
                pyautogui.keyUp(self._map_key(tokens[2]), _pause=False)

            elif action == "key_tap" and len(tokens) >= 3:
                pyautogui.press(self._map_key(tokens[2]), _pause=False)

            elif action == "key_hotkey" and len(tokens) >= 3:
                keys = [self._map_key(k) for k in tokens[2].split("+") if k]
                if keys:
                    pyautogui.hotkey(*keys, _pause=False)

        except Exception as e:
            print(f"[slave] input error: {e} | {tokens}")

    def on_message(self, message: str) -> Optional[Payload]:
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
                info = {
                    "path": str(Path.cwd())
                }
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
                print(f"[slave] file saving error: {e}")

        elif subject == "bash_execution":
            bash = " ".join(tokens[2:-1])
            master = tokens[-1]
            try:
                result = encode_base64(execute_bash(bash))
                if master:
                    self.send(f"send bash_execution {master} {result}")
            except Exception as e:
                if master:
                    self.send(f"send bash_execution {master} {encode_base64(f"Execution error: {e}")}")
                print(f"[slave] bash executing error: {e}")

        elif subject == "input":
            # request input <action> ...
            self._handle_input(tokens[1:])

        return None