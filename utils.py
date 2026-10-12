import io
from hashlib import sha256

from PIL import Image
from mss import MSS


def fash_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()

def capture_screen(quality):
    with MSS() as act:
        monitor = act.monitors[1]
        img = act.grab(monitor)

        im = Image.frombytes("RGB", (img.size.width, img.size.height), img.bgra, "raw", "BGRX")

        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()

