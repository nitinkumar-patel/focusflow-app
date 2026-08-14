"""Password hashing (Argon2id) and the internal-secret / user-id
FastAPI dependencies every router uses."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()

# Fixed dummy hash for the /auth/verify timing-attack mitigation (T4):
# verified against on an unknown email so an unknown-email 401 costs the
# same wall-clock time as a wrong-password 401. Computed once at import
# time, not derived from any real user's data.
DUMMY_PASSWORD_HASH = _hasher.hash("focusflow-timing-mitigation-dummy")


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, raw)
    except VerifyMismatchError:
        return False
