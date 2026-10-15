import hashlib
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class Crypto:
    NONCE_SIZE = 12
    KEY_SIZE = 32

    @staticmethod
    def get_offset() -> int:
        raise NotImplementedError(
            "get_offset() is not used by the secure implementation"
        )

    @staticmethod
    def create_seed() -> int:
        return secrets.randbits(256)

    @staticmethod
    def _derive_key(key: int) -> bytes:
        if not isinstance(key, int):
            raise TypeError("key must be an int")

        if key == 0:
            raise ValueError(
                "key=0 cannot be used for encryption; "
                "provide a secret non-zero key"
            )

        key_bytes = key.to_bytes(
            max(1, (key.bit_length() + 7) // 8),
            byteorder="big",
            signed=True,
        )

        return hashlib.sha256(
            b"ByteMoving-AES-256-GCM-v1\x00" + key_bytes
        ).digest()

    @staticmethod
    def encode(data: str, key=0) -> bytes:
        if not isinstance(data, str):
            raise TypeError("data must be str")

        aes_key = Crypto._derive_key(key)

        plaintext = data.encode("utf-8")

        nonce = secrets.token_bytes(Crypto.NONCE_SIZE)

        cipher = AESGCM(aes_key)

        ciphertext = cipher.encrypt(
            nonce,
            plaintext,
            None,
        )

        return nonce + ciphertext

    @staticmethod
    def decode(data: bytes, key: int) -> str:
        if not isinstance(data, bytes):
            raise TypeError("data must be bytes")

        minimum_size = (
                Crypto.NONCE_SIZE + 16
        )

        if len(data) < minimum_size:
            raise ValueError(
                "Invalid ByteMoving data: "
                "ciphertext is too short"
            )

        aes_key = Crypto._derive_key(key)

        nonce = data[:Crypto.NONCE_SIZE]
        ciphertext = data[Crypto.NONCE_SIZE:]

        cipher = AESGCM(aes_key)

        try:
            plaintext = cipher.decrypt(
                nonce,
                ciphertext,
                None,
            )
        except Exception as exc:
            raise ValueError(
                "Invalid key or corrupted ciphertext"
            ) from exc

        try:
            return plaintext.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(
                "Decrypted data is not valid UTF-8"
            ) from exc