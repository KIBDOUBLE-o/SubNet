import io
import os
import string
from hashlib import sha256
import base64
import subprocess


LETTERS = string.ascii_uppercase

from typing import Any


class SimCode:
    __slots__ = 'value'

    def __init__(self, hexadecimal = ""):
        self.value = hexadecimal

    @property
    def integer(self):
        return int(self.value, 16)

    @staticmethod
    def create(source: str) -> 'SimCode':
        unicodes = [ord(c) for c in source]

        code = 0
        for i in range(len(unicodes)):
            unicode = unicodes[i]

            code += unicode * (i + 1)

        return SimCode(hex(code)[2:])

    def is_similar_with(self, threshold: int, source: str | Any | None = None, log=False) -> bool:
        if isinstance(source, str):
            return self.is_similar_with(threshold, source=SimCode.create(source))

        if not isinstance(source, SimCode):
            return False

        difference = abs(self.integer - source.integer)

        result = difference <= threshold

        if log:
            print(f"""
            Hex:
            - Self:     {self.value}
            - Checking: {source.value}

            Integer:
            - Self:     {self.integer}
            - Checking: {source.integer}

            Difference:
            - Hex:      {hex(difference)[2:]}
            - Dec:      {difference}

            Is Similar({threshold}): 
            - Value:    {"yes" if result else "no"}
            """)

        return result


def fast_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()

def execute_bash(bash: str):
    result = subprocess.run(
        ["cmd.exe", "/c", bash],
        capture_output=True,
        text=True,
        check=True
    )
    return result.stderr + result.stdout

def build_local_tree(path: str) -> list:
    if path.endswith("\\") and len(path) > 3:
        path = path[:-1]
    folder = []
    if path != "!":
        for item in os.listdir(path):
            full = f"{path}\\{item}"
            folder.append({
                "folder": os.path.isdir(full),
                "name": item
            })
    else:
        for letter in LETTERS:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                folder.append({
                    "folder": True,
                    "name": drive
                })

    return folder

def notify(title: str, message: str):
    from winotify import Notification

    Notification(
        app_id="SubNet",
        title=title,
        msg=message
    ).show()

def encode_base64(data: str) -> str:
    return base64.b64encode(data.encode(errors="replace")).decode("ascii")

def decode_base64(data: str) -> str:
    return base64.b64decode(data.encode("ascii", errors="replace")).decode()

def add_to_startup():
    import winreg
    import sys
    import os

    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

    if getattr(sys, "frozen", False):
        program_path = sys.executable
    else:
        program_path = f'"{sys.executable}" "{os.path.abspath(sys.argv[0])}"'

    with winreg.OpenKey(
        winreg.HKEY_CURRENT_USER,
        key_path,
        0,
        winreg.KEY_SET_VALUE
    ) as key:
        winreg.SetValueEx(
            key,
            "SubNet",
            0,
            winreg.REG_SZ,
            program_path if getattr(sys, "frozen", False)
            else program_path
        )

def is_in_startup():
    import winreg

    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_READ
        ) as key:
            winreg.QueryValueEx(key, "SubNet")
            return True

    except FileNotFoundError:
        return False

def remove_from_startup():
    import winreg

    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            key_path,
            0,
            winreg.KEY_SET_VALUE
        ) as key:
            winreg.DeleteValue(key, "SubNet")

        return True

    except FileNotFoundError:
        return False

def capture_screen(quality: int = 70, scale: float = 0.6) -> str:
    from PIL import Image
    from mss import MSS
    import pyautogui

    quality = max(1, min(int(quality), 95))
    scale = max(0.1, min(float(scale), 1.0))

    with MSS() as sct:
        mon = sct.monitors[1]
        raw = sct.grab(mon)

        im = Image.frombytes(
            "RGB", raw.size, raw.bgra, "raw", "BGRX"
        ).convert("RGBA")

        # Позиция курсора на экране
        x, y = pyautogui.position()
        x -= mon["left"]
        y -= mon["top"]

        # Рисуем курсор поверх скриншота
        from PIL import ImageDraw
        draw = ImageDraw.Draw(im)
        draw.polygon(
            [(x, y), (x, y + 18), (x + 5, y + 13),
             (x + 10, y + 22), (x + 14, y + 20),
             (x + 9, y + 11), (x + 16, y + 11)],
            fill="white",
            outline="black",
        )

        im = im.convert("RGB")

        if scale < 1.0:
            w = max(1, int(im.width * scale))
            h = max(1, int(im.height * scale))
            im = im.resize((w, h), Image.Resampling.BILINEAR)

        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
        return base64.b64encode(buf.getvalue()).decode("ascii")

