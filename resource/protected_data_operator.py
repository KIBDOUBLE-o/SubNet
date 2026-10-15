from crypto import Crypto


class PDOperator:
    @staticmethod
    def read_bm(path: str, key: int) -> str:
        with open(path, "rb") as f:
            content = f.read()

        return Crypto.decode(content, key)

    @staticmethod
    def write_bm(path: str, content: str, key: int) -> None:
        encoded = Crypto.encode(content, key)

        with open(path, "wb") as f:
            f.write(encoded)
