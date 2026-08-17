"""Exercises app.seed's logic in-process rather than via subprocess.run().

subprocess.run() forks this process before exec; with a live asyncpg
connection pool open (from other tests' fixtures), the fork corrupts
asyncpg's protocol state for the rest of the test session ("attached to
a different loop" errors on every later async test). Calling _seed()
directly — with env vars monkeypatched and its session factory pointed
at the test database — exercises the same logic without that class of
bug, and is what actually matters: SEED_USER_EMAIL enforcement, password
generation, and idempotency are pure Python in _seed(), not OS-process
behavior.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app import seed as seed_module
from app.models import User

from .conftest import test_session_factory as _test_session_factory


@pytest.fixture(autouse=True)
def _seed_targets_test_db(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(seed_module, "async_session_factory", _test_session_factory)


async def test_seed_requires_email_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEED_USER_EMAIL", raising=False)
    exit_code = await seed_module._seed()
    assert exit_code != 0


async def test_seed_generates_password_when_unset(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SEED_USER_EMAIL", "seed-gen@example.com")
    monkeypatch.delenv("SEED_USER_PASSWORD", raising=False)

    exit_code = await seed_module._seed()

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "seed-gen@example.com" in out
    # A generated password is printed once, not silently hardcoded.
    assert "password" in out.lower()


async def test_seed_is_idempotent_by_email(
    monkeypatch: pytest.MonkeyPatch, db_session
) -> None:
    email = "seed-idempotent@example.com"
    monkeypatch.setenv("SEED_USER_EMAIL", email)
    monkeypatch.setenv("SEED_USER_PASSWORD", "a-fixed-test-password")

    assert await seed_module._seed() == 0
    assert await seed_module._seed() == 0

    result = await db_session.execute(select(User).where(User.email == email))
    users = result.scalars().all()
    assert len(users) == 1
