import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ActiveTimer, PomodoroSession, Task

SECRET_HEADER = {"X-Internal-Secret": settings.internal_api_secret}


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


async def test_create_task(client: AsyncClient) -> None:
    user_id = await _register_user(client, "task-creator@example.com")
    response = await client.post(
        "/tasks", json={"title": "Write the spec"}, headers=_headers(user_id)
    )
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Write the spec"
    assert "id" in body


async def test_list_returns_only_this_users_tasks(client: AsyncClient) -> None:
    alice_id = await _register_user(client, "alice-tasks@example.com")
    bob_id = await _register_user(client, "bob-tasks@example.com")

    await client.post("/tasks", json={"title": "Alice's task"}, headers=_headers(alice_id))
    await client.post("/tasks", json={"title": "Bob's task"}, headers=_headers(bob_id))

    alice_list = await client.get("/tasks", headers=_headers(alice_id))
    assert alice_list.status_code == 200
    titles = [t["title"] for t in alice_list.json()]
    assert titles == ["Alice's task"]


async def test_new_user_gets_empty_task_list(client: AsyncClient) -> None:
    user_id = await _register_user(client, "fresh-user@example.com")
    response = await client.get("/tasks", headers=_headers(user_id))
    assert response.status_code == 200
    assert response.json() == []


async def test_empty_title_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "empty-title@example.com")
    response = await client.post("/tasks", json={"title": ""}, headers=_headers(user_id))
    assert response.status_code == 422


async def test_missing_user_id_401(client: AsyncClient) -> None:
    response = await client.get("/tasks", headers=SECRET_HEADER)
    assert response.status_code == 401


async def test_malformed_user_id_401(client: AsyncClient) -> None:
    # require_user_id's UUID-parse branch (round-6 REVIEW finding: only
    # the absent-header case was covered — a refactor that returned the
    # raw header value without parsing it kept every other test green).
    response = await client.get(
        "/tasks", headers={**SECRET_HEADER, "X-User-Id": "not-a-uuid"}
    )
    assert response.status_code == 401


async def test_unknown_user_id_401(client: AsyncClient) -> None:
    # require_user_id's existence-lookup branch — a well-formed UUID
    # that names no row must still 401, not be accepted as a forged
    # identity (spec AC16).
    response = await client.get(
        "/tasks", headers={**SECRET_HEADER, "X-User-Id": str(uuid.uuid4())}
    )
    assert response.status_code == 401


# --- priority, estimate, completed count, order -------------------------


async def _seed_sessions(db: AsyncSession, task_id: uuid.UUID, count: int) -> None:
    base = datetime.now(UTC) - timedelta(days=2)
    for i in range(count):
        start = base + timedelta(hours=i)
        db.add(
            PomodoroSession(
                task_id=task_id,
                started_at=start,
                ended_at=start + timedelta(seconds=1500),
                duration_seconds=1500,
            )
        )
    await db.commit()


async def test_create_defaults_ac1(client: AsyncClient) -> None:
    user_id = await _register_user(client, "defaults@example.com")
    response = await client.post("/tasks", json={"title": "A"}, headers=_headers(user_id))
    assert response.status_code == 201
    body = response.json()
    assert body["priority"] == "medium"
    assert body["estimated_pomodoros"] == 1


async def test_create_stores_given_values_ac1(client: AsyncClient) -> None:
    user_id = await _register_user(client, "stored@example.com")
    response = await client.post(
        "/tasks",
        json={"title": "A", "priority": "high", "estimated_pomodoros": 20},
        headers=_headers(user_id),
    )
    assert response.status_code == 201
    assert response.json()["priority"] == "high"
    assert response.json()["estimated_pomodoros"] == 20
    listed = (await client.get("/tasks", headers=_headers(user_id))).json()
    assert listed[0]["priority"] == "high"
    assert listed[0]["estimated_pomodoros"] == 20


@pytest.mark.parametrize(
    "extra",
    [
        {"priority": "urgent"},
        {"priority": "HIGH"},
        {"priority": 1},
        {"estimated_pomodoros": 0},
        {"estimated_pomodoros": 21},
        {"estimated_pomodoros": -1},
        {"estimated_pomodoros": "3"},
        {"estimated_pomodoros": 2.5},
        {"estimated_pomodoros": None},
    ],
)
async def test_create_rejects_invalid_values_ac2(
    client: AsyncClient, extra: dict[str, object]
) -> None:
    user_id = await _register_user(client, "invalid@example.com")
    response = await client.post(
        "/tasks", json={"title": "A", **extra}, headers=_headers(user_id)
    )
    assert response.status_code == 422
    assert (await client.get("/tasks", headers=_headers(user_id))).json() == []


async def test_list_completed_counts_ac3(client: AsyncClient, db_session: AsyncSession) -> None:
    user_id = await _register_user(client, "counts@example.com")
    other_id = await _register_user(client, "counts-other@example.com")
    ids = {}
    for title in ("three", "none", "one"):
        r = await client.post("/tasks", json={"title": title}, headers=_headers(user_id))
        ids[title] = uuid.UUID(r.json()["id"])
    other = await client.post("/tasks", json={"title": "o"}, headers=_headers(other_id))
    await _seed_sessions(db_session, ids["three"], 3)
    await _seed_sessions(db_session, ids["one"], 1)
    await _seed_sessions(db_session, uuid.UUID(other.json()["id"]), 5)

    body = (await client.get("/tasks", headers=_headers(user_id))).json()
    counts = {t["title"]: t["completed_pomodoros"] for t in body}
    assert counts == {"three": 3, "none": 0, "one": 1}


async def test_list_settles_elapsed_work_ac11(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _register_user(client, "settle-list@example.com")
    r = await client.post("/tasks", json={"title": "A"}, headers=_headers(user_id))
    task_id = uuid.UUID(r.json()["id"])
    db_session.add(
        ActiveTimer(
            user_id=user_id,
            task_id=task_id,
            phase="work",
            started_at=datetime.now(UTC) - timedelta(seconds=1520),
            duration_seconds=1500,
        )
    )
    await db_session.commit()

    body = (await client.get("/tasks", headers=_headers(user_id))).json()
    assert body[0]["completed_pomodoros"] == 1

    db_session.expire_all()
    timer = (await db_session.execute(select(ActiveTimer))).scalar_one()
    assert timer.phase == "short_break"
    sessions = (await db_session.execute(select(PomodoroSession))).scalars().all()
    assert len(sessions) == 1


async def test_list_order_priority_then_newest_ac4(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _register_user(client, "order@example.com")
    base = datetime.now(UTC) - timedelta(days=1)
    spec = [
        ("low-old", "low", 0),
        ("high-old", "high", 1),
        ("med-old", "medium", 2),
        ("low-new", "low", 3),
        ("high-new", "high", 4),
        ("med-new", "medium", 5),
    ]
    for title, priority, hours in spec:
        db_session.add(
            Task(
                user_id=user_id,
                title=title,
                priority=priority,
                created_at=base + timedelta(hours=hours),
            )
        )
    await db_session.commit()

    body = (await client.get("/tasks", headers=_headers(user_id))).json()
    assert [t["title"] for t in body] == [
        "high-new",
        "high-old",
        "med-new",
        "med-old",
        "low-new",
        "low-old",
    ]
