from __future__ import annotations

from typing import Set

from argon2 import PasswordHasher  # type: ignore
from argon2.exceptions import VerifyMismatchError  # type: ignore

_ph = PasswordHasher()  # Argon2id default

def _is_argon2_hash(password_hash: str) -> bool:
    # argon2-cffi emits hashes like: "$argon2id$v=19$m=...$..."
    return password_hash.startswith("$argon2")


def hash_password(password: str) -> str:
    return _ph.hash(password)  # type: ignore[union-attr]


def verify_password(password: str, password_hash: str) -> bool:
    # Enforce Argon2 hashes only. If a user was created with a legacy/weak hash,
    # they must reset their password.
    if not _is_argon2_hash(password_hash):
        return False
    try:
        return _ph.verify(password_hash, password)  # type: ignore[union-attr,arg-type]
    except VerifyMismatchError:
        return False
    except Exception:
        return False


# Role codes per SDS 2
ROLES: Set[str] = {"SALES", "OPERATOR", "PROD_MANAGER", "SYS_ADMIN"}
