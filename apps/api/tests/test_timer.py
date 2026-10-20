"""Timer routes and settlement (spec AC5-AC18, AC45-AC48). Phases elapse by
seeding back-dated active_timers rows or by passing an explicit `now`."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ActiveTimer, PomodoroSession, Task
from app.timer.settlement import settle_timer

SECRET_HEADER = {"X-Internal-Secret": settings.internal_api_secret}
W, SB, LB = 1500, 300, 900


def _headers(user_id: uuid.UUID) -> dict[str, str]:
    return {**SECRET_HEADER, "X-User-Id": str(user_id)}


async def _register_user(client: AsyncClient, email: str) -> uuid.UUID:
    response = await client.post(
        "/auth/register",
        json={"email": email, "password": "correct horse battery staple"},
        headers=SECRET_HEADER,
    )
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


async def _create_task(client: AsyncClient, user_id: uuid.UUID, title: str = "T") -> uuid.UUID:
    response = await client.post("/tasks", json={"title": title}, headers=_headers(user_id))
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


async def _setup(client: AsyncClient, email: str = "timer@example.com"):
    user_id = await _register_user(client, email)
    return user_id, await _create_task(client, user_id)


async def _start(client: AsyncClient, user_id: uuid.UUID, task_id: uuid.UUID):
    body = {"task_id": str(task_id)}
    return await client.post("/timer/start", json=body, headers=_headers(user_id))


async def _seed_timer(
    db: AsyncSession, user_id, task_id, phase: str, started_at: datetime, duration: int
) -> None:
    db.add(
        ActiveTimer(
            user_id=user_id,
            task_id=task_id,
            phase=phase,
            started_at=started_at,
            duration_seconds=duration,
        )
    )
    await db.commit()


async def _seed_sessions(db: AsyncSession, task_id, count: int) -> None:
    base = datetime.now(UTC) - timedelta(days=2)
    for i in range(count):
        s = base + timedelta(hours=i)
        db.add(
            PomodoroSession(
                task_id=task_id,
                started_at=s,
                ended_at=s + timedelta(seconds=W),
                duration_seconds=W,
            )
        )
    await db.commit()


async def _sessions(db: AsyncSession) -> list[PomodoroSession]:
    db.expire_all()
    result = await db.execute(select(PomodoroSession).order_by(PomodoroSession.started_at))
    return list(result.scalars().all())


async def _timers(db: AsyncSession) -> list[ActiveTimer]:
    db.expire_all()
    return list((await db.execute(select(ActiveTimer))).scalars().all())


def _ago(seconds: int) -> datetime:
    return datetime.now(UTC) - timedelta(seconds=seconds)


# --- start --------------------------------------------------------------


async def test_start_creates_work_timer_ac5(client: AsyncClient) -> None:
    user_id, task_id = await _setup(client)
    response = await _start(client, user_id, task_id)
    assert response.status_code == 201
    body = response.json()
    assert body["phase"] == "work"
    assert body["duration_seconds"] == W
    assert body["task_id"] == str(task_id)
    assert body["cycle_position"] == 1


async def test_start_conflicts_during_work_ac6(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    other = await _create_task(client, user_id, "other")
    await _start(client, user_id, task_id)
    response = await _start(client, user_id, other)
    assert response.status_code == 409
    timers = await _timers(db_session)
    assert len(timers) == 1 and timers[0].task_id == task_id


async def test_start_conflicts_during_break_ac6(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "short_break", _ago(10), SB)
    response = await _start(client, user_id, task_id)
    assert response.status_code == 409
    timers = await _timers(db_session)
    assert [t.phase for t in timers] == ["short_break"]


async def test_start_against_elapsed_work_is_409_and_keeps_settlement_ac6(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 10), W)
    response = await _start(client, user_id, task_id)
    assert response.status_code == 409
    timers = await _timers(db_session)
    assert len(timers) == 1 and timers[0].phase == "short_break"
    assert len(await _sessions(db_session)) == 1


async def test_concurrent_starts_one_wins_ac7(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    body = {"task_id": str(task_id)}
    results = await asyncio.gather(
        *[client.post("/timer/start", json=body, headers=_headers(user_id)) for _ in range(2)]
    )
    assert sorted(r.status_code for r in results) == [201, 409]
    assert len(await _timers(db_session)) == 1


async def test_start_nonexistent_or_foreign_task_404_ac8(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, _ = await _setup(client)
    other_id = await _register_user(client, "other-timer@example.com")
    foreign = await _create_task(client, other_id, "theirs")
    for task in (uuid.uuid4(), foreign):
        response = await _start(client, user_id, task)
        assert response.status_code == 404
    assert await _timers(db_session) == []


async def test_start_after_elapsed_break_ac45(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "short_break", _ago(SB + 5), SB)
    response = await _start(client, user_id, task_id)
    assert response.status_code == 201
    assert response.json()["phase"] == "work"


# --- read ---------------------------------------------------------------


async def test_get_timer_body_ac9(client: AsyncClient, db_session: AsyncSession) -> None:
    user_id, task_id = await _setup(client)
    await _seed_sessions(db_session, task_id, 5)
    started = _ago(100)
    await _seed_timer(db_session, user_id, task_id, "work", started, W)
    response = await client.get("/timer", headers=_headers(user_id))
    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == str(task_id)
    assert body["phase"] == "work"
    assert datetime.fromisoformat(body["started_at"]) == started
    assert datetime.fromisoformat(body["ends_at"]) == started + timedelta(seconds=W)
    assert 1395 <= body["remaining_seconds"] <= 1400
    assert datetime.fromisoformat(body["server_time"]).tzinfo is not None
    assert body["cycle_position"] == (5 % 4) + 1


async def test_get_timer_cycle_position_in_break_ac9(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_sessions(db_session, task_id, 4)
    await _seed_timer(db_session, user_id, task_id, "long_break", _ago(10), LB)
    body = (await client.get("/timer", headers=_headers(user_id))).json()
    assert body["cycle_position"] == 4


async def test_get_timer_null_ac10(client: AsyncClient) -> None:
    user_id, _ = await _setup(client)
    response = await client.get("/timer", headers=_headers(user_id))
    assert response.status_code == 200
    assert response.json() is None


async def test_get_settles_elapsed_work_ac11_ac47(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    started = _ago(W + 20)
    await _seed_timer(db_session, user_id, task_id, "work", started, W)
    response = await client.get("/timer", headers=_headers(user_id))
    body = response.json()
    assert body["phase"] == "short_break"
    assert body["duration_seconds"] == SB
    assert datetime.fromisoformat(body["started_at"]) == started + timedelta(seconds=W)
    sessions = await _sessions(db_session)
    assert len(sessions) == 1
    assert sessions[0].started_at == started
    assert sessions[0].ended_at == started + timedelta(seconds=W)
    assert sessions[0].duration_seconds == W


async def test_start_and_stop_settle_elapsed_work_ac11(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 20), W)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 204
    assert len(await _sessions(db_session)) == 1


async def test_repeated_and_concurrent_reads_record_once_ac12(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 20), W)
    results = await asyncio.gather(
        *[client.get("/timer", headers=_headers(user_id)) for _ in range(5)]
    )
    assert all(r.status_code == 200 for r in results)
    await client.get("/timer", headers=_headers(user_id))
    assert len(await _sessions(db_session)) == 1


async def test_break_kind_follows_session_count_ac13(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    kinds = []
    for _ in range(4):
        await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 20), W)
        body = (await client.get("/timer", headers=_headers(user_id))).json()
        kinds.append((body["phase"], body["duration_seconds"]))
        await db_session.execute(ActiveTimer.__table__.delete())
        await db_session.commit()
    assert kinds == [("short_break", SB)] * 3 + [("long_break", LB)]


async def test_elapsed_break_removes_timer_ac14(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "short_break", _ago(SB + 5), SB)
    assert (await client.get("/timer", headers=_headers(user_id))).json() is None
    assert await _timers(db_session) == []
    assert await _sessions(db_session) == []


# --- stop ---------------------------------------------------------------


async def test_stop_during_work_records_nothing_ac15(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(100), W)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 204
    assert await _timers(db_session) == []
    assert await _sessions(db_session) == []


async def test_stop_after_elapsed_work_records_and_removes_ac16(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 20), W)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 204
    assert await _timers(db_session) == []
    assert len(await _sessions(db_session)) == 1


async def test_stop_during_break_ac17(client: AsyncClient, db_session: AsyncSession) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "short_break", _ago(10), SB)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 204
    assert await _timers(db_session) == []


async def test_stop_without_timer_404_ac18(client: AsyncClient) -> None:
    user_id, _ = await _setup(client)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 404


async def test_stop_after_elapsed_break_404_ac46(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "short_break", _ago(SB + 5), SB)
    assert (await client.post("/timer/stop", headers=_headers(user_id))).status_code == 404


# --- settlement with explicit now (AC48) ---------------------------------


async def test_long_absence_records_only_elapsed_sessions_ac48(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    started = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    await _seed_timer(db_session, user_id, task_id, "work", started, W)
    remaining = await settle_timer(db_session, user_id, started + timedelta(days=3))
    await db_session.commit()
    assert remaining is None
    sessions = await _sessions(db_session)
    assert len(sessions) == 1
    assert sessions[0].started_at == started
    assert sessions[0].ended_at == started + timedelta(seconds=W)
    assert await _timers(db_session) == []


async def test_settlement_stops_in_the_break_it_lands_in(
    db_session: AsyncSession, client: AsyncClient
) -> None:
    user_id, task_id = await _setup(client)
    started = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    await _seed_timer(db_session, user_id, task_id, "work", started, W)
    timer = await settle_timer(db_session, user_id, started + timedelta(seconds=W + 10))
    await db_session.commit()
    assert timer is not None and timer.phase == "short_break"
    assert timer.started_at == started + timedelta(seconds=W)
    count = (await db_session.execute(select(func.count()).select_from(Task))).scalar_one()
    assert count == 1


# --- authentication ------------------------------------------------------


async def test_timer_routes_reject_missing_or_bad_secret(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    uid = str(user_id)
    for headers in ({"X-User-Id": uid}, {"X-Internal-Secret": "wrong", "X-User-Id": uid}):
        assert (await client.get("/timer", headers=headers)).status_code == 401
        assert (await client.post("/timer/stop", headers=headers)).status_code == 401
        r = await client.post("/timer/start", json={"task_id": str(task_id)}, headers=headers)
        assert r.status_code == 401
    assert await _timers(db_session) == []


async def test_timer_routes_reject_unknown_user_without_writes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id, task_id = await _setup(client)
    await _seed_timer(db_session, user_id, task_id, "work", _ago(W + 20), W)
    ghost = _headers(uuid.uuid4())
    assert (await client.get("/timer", headers=ghost)).status_code == 401
    assert (await client.post("/timer/stop", headers=ghost)).status_code == 401
    r = await client.post("/timer/start", json={"task_id": str(task_id)}, headers=ghost)
    assert r.status_code == 401
    assert await _sessions(db_session) == []
    assert [t.phase for t in await _timers(db_session)] == ["work"]
