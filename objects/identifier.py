import uuid
from pathlib import Path


class Identifier:
    __slots__ = '_value'

    def __init__(self, preset = None, t = "s"):
        self._value = preset if preset else self._create(t)

    @staticmethod
    def _create(t: str):
        key_file = Path.home() / ".private_data" / "key.txt"

        key_file.parent.mkdir(parents=True, exist_ok=True)

        if key_file.exists():
            return t + key_file.read_text(encoding="utf-8").strip()

        key = str(uuid.uuid4())

        key_file.write_text(key, encoding="utf-8")

        return t + key

    @staticmethod
    def empty() -> 'Identifier':
        return Identifier("UNIDENTIFIED")

    @property
    def is_empty(self):
        return self._value == "UNIDENTIFIED"

    def __str__(self):
        return self._value
