from __future__ import annotations

from typing import Set

try:
    from argon2 import PasswordHasher  # type: ignore
    from argon2.exceptions import VerifyMismatchError  # type: ignore
    _HAVE_ARGON2 = True
except Exception:  # pragma: no cover - test fallback
    import hashlib

    _HAVE_ARGON2 = False

    class PasswordHasher:  # minimal shim
        def hash(self, password: str) -> str:
            return hashlib.sha256(password.encode("utf-8")).hexdigest()

        def verify(self, password_hash: str, password: str) -> bool:
            return password_hash == hashlib.sha256(password.encode("utf-8")).hexdigest()

    class VerifyMismatchError(Exception):
        ...


_ph = PasswordHasher()  # Argon2id default


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)  # type: ignore[arg-type]
    except VerifyMismatchError:
        return False
    except Exception:
        return False


# Role codes per SDS 2
ROLES: Set[str] = {"SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"}
