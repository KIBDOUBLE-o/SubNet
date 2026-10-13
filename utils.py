import io
from hashlib import sha256
import base64


def fash_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()

def capture_screen(quality):
    from PIL import Image
    from mss import MSS

    with MSS() as act:
        monitor = act.monitors[1]
        img = act.grab(monitor)

        im = Image.frombytes(
            "RGB",
            (img.size.width, img.size.height),
            img.bgra,
            "raw",
            "BGRX"
        )

        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=quality)

        return base64.b64encode(buf.getvalue()).decode("utf-8")

