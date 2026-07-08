import base64
import hashlib
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


@lru_cache(maxsize=1)
def _get_fernet() -> Optional[Fernet]:
    secret = (os.getenv("INIT_SECRET_KEY") or os.getenv("INIT_ENCRYPTION_KEY") or "").strip()
    if not secret:
        return None
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: Optional[str]) -> str:
    if not value:
        return ""

    fernet = _get_fernet()
    if fernet:
        return "fernet:" + fernet.encrypt(value.encode("utf-8")).decode("ascii")

    # Backward-compatible development fallback. Production must set INIT_SECRET_KEY.
    return "b64:" + base64.b64encode(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: Optional[str]) -> str:
    text = value or ""
    if text.startswith("fernet:"):
        fernet = _get_fernet()
        if not fernet:
            return ""
        try:
            return fernet.decrypt(text[7:].encode("ascii")).decode("utf-8")
        except (InvalidToken, Exception):
            return ""
    if text.startswith("b64:"):
        try:
            return base64.b64decode(text[4:].encode("ascii")).decode("utf-8")
        except Exception:
            return ""
    return text
