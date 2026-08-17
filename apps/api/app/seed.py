"""Idempotent seed script — no hardcoded default credentials (CWE-798).

Usage: python -m app.seed
Requires SEED_USER_EMAIL. If SEED_USER_PASSWORD is unset, a random
password is generated and printed once — never a fixed fallback.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import sys

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import async_session_factory
from app.models import User


async def _seed() -> int:
    email = os.environ.get("SEED_USER_EMAIL", "").strip()
    if not email:
        print("SEED_USER_EMAIL is required", file=sys.stderr)
        return 1

    password = os.environ.get("SEED_USER_PASSWORD", "").strip()
    generated = not password
    if generated:
        password = secrets.token_urlsafe(16)

    async with async_session_factory() as session:
        existing = await session.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none() is not None:
            print(f"seed: {email} already exists, no-op")
            return 0

        user = User(email=email, password_hash=hash_password(password))
        session.add(user)
        await session.commit()

    print(f"seed: created {email}")
    if generated:
        print(f"seed: generated password (shown once, not stored anywhere else): {password}")
    return 0


def main() -> None:
    sys.exit(asyncio.run(_seed()))


if __name__ == "__main__":
    main()
