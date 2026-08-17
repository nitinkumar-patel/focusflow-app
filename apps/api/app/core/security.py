"""Password hashing (Argon2id) and the internal-secret / user-id
FastAPI dependencies every router uses."""

from __future__ import annotations

import hmac

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Header, HTTPException

from app.core.config import settings

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


async def require_internal_secret(x_internal_secret: str | None = Header(default=None)) -> None:
    """Rejects when either side is unset/empty — an empty-to-empty
    comparison must never authorize."""
    if not x_internal_secret or not settings.internal_api_secret:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not hmac.compare_digest(x_internal_secret, settings.internal_api_secret):
        raise HTTPException(status_code=401, detail="unauthorized")
