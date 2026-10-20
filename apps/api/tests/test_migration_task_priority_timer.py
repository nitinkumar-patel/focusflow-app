"""T1: migration round-trip on a throwaway database, and DB-level constraints.

The round-trip never touches the shared `focusflow_test` database."""

from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models import ActiveTimer, Task, User

_API_ROOT = Path(__file__).resolve().parent.parent
_PREV_REV = "75d3bf36261f"
_NOW = datetime(2026, 1, 1, tzinfo=UTC)


def _admin_conn():
    return asyncpg.connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host="db",
        database="postgres",
    )


async def _admin_exec(sql: str) -> None:
    conn = await _admin_conn()
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


def _alembic(url: str, *args: str) -> None:
    env = os.environ.copy()
    env["ALEMBIC_DATABASE_URL"] = url
    subprocess.run(["alembic", *args], cwd=str(_API_ROOT), env=env, check=True)


@pytest.fixture
def throwaway_db() -> Iterator[tuple[str, str]]:
    name = f"focusflow_mig_{uuid.uuid4().hex[:12]}"
    asyncio.run(_admin_exec(f'CREATE DATABASE "{name}"'))
    url = settings.database_url_test.rsplit("/", 1)[0] + f"/{name}"
    try:
        yield name, url
    finally:
        asyncio.run(_admin_exec(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


async def _fetch(name: str, sql: str):
    conn = await asyncpg.connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host="db",
        database=name,
    )
    try:
        return await conn.fetch(sql)
    finally:
        await conn.close()


async def _seed_old_schema(name: str, user_id, task_ids, session_id) -> None:
    conn = await asyncpg.connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host="db",
        database=name,
    )
    try:
        await conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES ($1, 'u@example.com', 'x')",
            user_id,
        )
        for i, tid in enumerate(task_ids):
            await conn.execute(
                "INSERT INTO tasks (id, user_id, title) VALUES ($1, $2, $3)",
                tid, user_id, f"task {i}",
            )
        await conn.execute(
            "INSERT INTO pomodoro_sessions (id, task_id, started_at, ended_at, duration_seconds)"
            " VALUES ($1, $2, $3, $4, 1500)",
            session_id, task_ids[0], _NOW, _NOW.replace(minute=25),
        )
    finally:
        await conn.close()


def test_migration_round_trip_on_existing_data(throwaway_db: tuple[str, str]) -> None:
    name, url = throwaway_db
    user_id = uuid.uuid4()
    task_ids = [uuid.uuid4(), uuid.uuid4()]
    session_id = uuid.uuid4()

    _alembic(url, "upgrade", _PREV_REV)
    asyncio.run(_seed_old_schema(name, user_id, task_ids, session_id))
    before = asyncio.run(_fetch(name, "SELECT * FROM pomodoro_sessions"))

    _alembic(url, "upgrade", "head")
    tasks = asyncio.run(_fetch(name, "SELECT priority, estimated_pomodoros FROM tasks"))
    assert len(tasks) == 2
    assert all(t["priority"] == "medium" and t["estimated_pomodoros"] == 1 for t in tasks)  # AC21
    assert asyncio.run(_fetch(name, "SELECT * FROM pomodoro_sessions")) == before  # AC22

    _alembic(url, "downgrade", "-1")
    cols = asyncio.run(
        _fetch(
            name,
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'",
        )
    )
    names = {c["column_name"] for c in cols}
    assert "priority" not in names and "estimated_pomodoros" not in names  # AC23
    assert not asyncio.run(
        _fetch(name, "SELECT 1 FROM information_schema.tables WHERE table_name = 'active_timers'")
    )
    assert asyncio.run(_fetch(name, "SELECT * FROM pomodoro_sessions")) == before  # AC24
    assert len(asyncio.run(_fetch(name, "SELECT id FROM tasks"))) == 2


async def _make_user_task(db_session, **task_kwargs):
    user = User(email=f"{uuid.uuid4().hex}@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    task = Task(user_id=user.id, title="t", **task_kwargs)
    db_session.add(task)
    await db_session.flush()
    return user, task


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs",
    [{"priority": "urgent"}, {"estimated_pomodoros": 0}, {"estimated_pomodoros": 21}],
)
async def test_task_constraints_reject_out_of_range(db_session, kwargs) -> None:
    with pytest.raises(IntegrityError):
        await _make_user_task(db_session, **kwargs)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_task_defaults_and_bounds_accepted(db_session) -> None:
    _, task = await _make_user_task(db_session)
    await db_session.refresh(task)
    assert (task.priority, task.estimated_pomodoros) == ("medium", 1)
    await _make_user_task(db_session, priority="low", estimated_pomodoros=20)
    await db_session.rollback()


def _timer(user, task, phase="work") -> ActiveTimer:
    return ActiveTimer(
        user_id=user.id, task_id=task.id, phase=phase, started_at=_NOW, duration_seconds=1500
    )


@pytest.mark.asyncio
async def test_second_active_timer_for_one_user_rejected(db_session) -> None:
    user, task = await _make_user_task(db_session)
    db_session.add(_timer(user, task))
    await db_session.flush()
    db_session.add(_timer(user, task))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_active_timer_phase_outside_three_values_rejected(db_session) -> None:
    user, task = await _make_user_task(db_session)
    db_session.add(_timer(user, task, phase="nap"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
