"""Test-database provisioning: creates `focusflow_test` on the same
Postgres instance the dev `db` service runs (no testcontainers, no
second Postgres service — see plan.md's Design decisions), migrates it,
and truncates all tables between tests."""

from __future__ import annotations

import os
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db_session

_API_ROOT = Path(__file__).resolve().parent.parent

test_engine = create_async_engine(settings.database_url_test, pool_pre_ping=True)
test_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)


async def _ensure_test_database_exists() -> None:
    conn = await asyncpg.connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host="db",
        database="postgres",
    )
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", f"{settings.postgres_db}_test"
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{settings.postgres_db}_test"')
    finally:
        await conn.close()


def _run_migrations_against_test_db() -> None:
    env = os.environ.copy()
    env["ALEMBIC_DATABASE_URL"] = settings.database_url_test
    subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=str(_API_ROOT),
        env=env,
        check=True,
    )


@pytest.fixture(scope="session", autouse=True)
def _provision_test_database() -> None:
    import asyncio

    asyncio.run(_ensure_test_database_exists())
    _run_migrations_against_test_db()


@pytest_asyncio.fixture(autouse=True)
async def _truncate_tables_between_tests() -> AsyncGenerator[None]:
    yield
    async with test_engine.begin() as conn:
        table_names = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
        if table_names:
            await conn.execute(text(f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"))


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession]:
    async with test_session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient]:
    from app.main import app

    async def _override_get_db_session() -> AsyncGenerator[AsyncSession]:
        async with test_session_factory() as session:
            yield session

    app.dependency_overrides[get_db_session] = _override_get_db_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
