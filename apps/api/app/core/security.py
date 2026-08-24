"""Password hashing (Argon2id) and the internal-secret / user-id
FastAPI dependencies every router uses."""

from __future__ import annotations

import hmac
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db_session
from app.models import User

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
    comparison must never authorize.

    detail is deliberately distinct from require_user_id's "unauthorized"
    (round-17 REVIEW finding: apps/web's api-client.ts logFailure uses this
    detail string to distinguish a broken web<->api deployment from a
    routine unknown/malformed user id — a shared string made that
    discriminator false).
    """
    if not x_internal_secret or not settings.internal_api_secret:
        raise HTTPException(status_code=401, detail="invalid internal secret")
    if not hmac.compare_digest(x_internal_secret, settings.internal_api_secret):
        raise HTTPException(status_code=401, detail="invalid internal secret")


async def require_user_id(
    x_user_id: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db_session),
) -> uuid.UUID:
    """Reads X-User-Id, 401 if absent, malformed, or unknown.

    apps/web attaches this header only after reading it from the
    caller's validated NextAuth session (spec AC16) — this dependency
    doesn't and can't verify that provenance itself, it only confirms
    the id names a real user.
    """
    if not x_user_id:
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        user_id = uuid.UUID(x_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="unauthorized") from exc

    result = await db.execute(select(User).where(User.id == user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user_id
