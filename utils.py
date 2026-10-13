import io
import os
import string
from hashlib import sha256
import base64
import subprocess


LETTERS = string.ascii_uppercase

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

def encode_base64(data: str) -> str:
    return base64.b64encode(data.encode(errors="replace")).decode("ascii")

def decode_base64(data: str) -> str:
    return base64.b64decode(data.encode("ascii", errors="replace")).decode()

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

