from hashlib import sha256

def fash_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()
