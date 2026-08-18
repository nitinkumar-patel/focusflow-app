import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.core.config import settings

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


async def _create_task(client: AsyncClient, user_id: uuid.UUID, title: str) -> uuid.UUID:
    response = await client.post("/tasks", json={"title": title}, headers=_headers(user_id))
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


async def _record_session(
    client: AsyncClient, user_id: uuid.UUID, task_id: uuid.UUID, started: datetime, seconds: int
) -> None:
    ended = started + timedelta(seconds=seconds)
    response = await client.post(
        f"/tasks/{task_id}/sessions",
        json={
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_seconds": seconds,
        },
        headers=_headers(user_id),
    )
    assert response.status_code == 201


async def test_by_day_sums_seeded_sessions(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-by-day@example.com")
    task_id = await _create_task(client, user_id, "Deep work")

    now = datetime.now(UTC)
    started_at = now - timedelta(seconds=1500)
    await _record_session(client, user_id, task_id, started_at, 1500)

    response = await client.get("/analytics/focus-time", headers=_headers(user_id))
    assert response.status_code == 200
    body = response.json()
    # Bucketed by started_at's UTC calendar date, not now's — these
    # differ within the ~25 minutes around UTC midnight (flaky-test fix,
    # caught live: this run started at 2026-08-18T00:04 UTC, so a
    # session starting 25 minutes earlier fell on 2026-08-17).
    expected_str = started_at.date().isoformat()
    expected_bucket = next(b for b in body["by_day"] if b["date"] == expected_str)
    assert expected_bucket["minutes"] == 25.0


async def test_by_task_sums_seeded_sessions(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-by-task@example.com")
    task_id = await _create_task(client, user_id, "Deep work")

    now = datetime.now(UTC)
    await _record_session(client, user_id, task_id, now - timedelta(seconds=1500), 1500)

    response = await client.get("/analytics/focus-time", headers=_headers(user_id))
    assert response.status_code == 200
    body = response.json()
    assert len(body["by_task"]) == 1
    assert body["by_task"][0]["task_title"] == "Deep work"
    assert body["by_task"][0]["minutes"] == 25.0


async def test_by_task_is_not_windowed_by_days(client: AsyncClient) -> None:
    # by_task is all-time, unlike by_day's `days` window — AC9's empty
    # state is defined by "no recorded sessions" ever, not "none in the
    # last N days" (Design decisions / round-1 REVIEW finding).
    user_id = await _register_user(client, "analytics-old-session@example.com")
    task_id = await _create_task(client, user_id, "Old task")

    old_start = datetime.now(UTC) - timedelta(days=30)
    await _record_session(client, user_id, task_id, old_start, 1500)

    response = await client.get(
        "/analytics/focus-time", params={"days": 7}, headers=_headers(user_id)
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["by_task"]) == 1
    assert body["by_task"][0]["task_title"] == "Old task"
    assert body["by_task"][0]["minutes"] == 25.0
    # The old session falls outside the 7-day by_day window, so every
    # bucket stays zero even though by_task reports it.
    assert all(bucket["minutes"] == 0 for bucket in body["by_day"])


async def test_by_day_is_zero_filled_to_days_param(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-zero-fill@example.com")
    task_id = await _create_task(client, user_id, "Task")
    now = datetime.now(UTC)
    await _record_session(client, user_id, task_id, now - timedelta(seconds=60), 60)

    response = await client.get(
        "/analytics/focus-time", params={"days": 7}, headers=_headers(user_id)
    )
    body = response.json()
    assert len(body["by_day"]) == 7
    zero_days = [b for b in body["by_day"] if b["minutes"] == 0]
    assert len(zero_days) == 6


async def test_by_day_buckets_in_utc(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-utc-bucket@example.com")
    task_id = await _create_task(client, user_id, "Task")

    # Anchored to actual "now" minus exactly 24h — always the previous
    # UTC calendar date at the same wall-clock time, and always in the
    # past — rather than a fixed clock time. A hardcoded "23:30 UTC" can
    # land in the future depending on when the suite actually runs,
    # which would trip the session endpoint's own clock-skew guard (T7).
    now = datetime.now(UTC)
    today = now
    yesterday = now - timedelta(days=1)

    # Yesterday's session first, so it's not "recent" when today's is
    # submitted — otherwise T7's rapid-duplicate-for-same-task guard
    # would reject the second request.
    await _record_session(client, user_id, task_id, yesterday - timedelta(seconds=60), 60)
    await _record_session(client, user_id, task_id, today - timedelta(seconds=60), 60)

    response = await client.get(
        "/analytics/focus-time", params={"days": 7}, headers=_headers(user_id)
    )
    body = response.json()
    today_bucket = next(b for b in body["by_day"] if b["date"] == today.date().isoformat())
    yesterday_bucket = next(
        b for b in body["by_day"] if b["date"] == yesterday.date().isoformat()
    )
    assert today_bucket["minutes"] == 1.0
    assert yesterday_bucket["minutes"] == 1.0


async def test_days_param_bounds_the_window(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-days-bound@example.com")
    response = await client.get(
        "/analytics/focus-time", params={"days": 3}, headers=_headers(user_id)
    )
    assert response.status_code == 200
    assert len(response.json()["by_day"]) == 3


async def test_days_param_out_of_range_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "analytics-days-range@example.com")
    response = await client.get(
        "/analytics/focus-time", params={"days": 91}, headers=_headers(user_id)
    )
    assert response.status_code == 422


async def test_excludes_other_users_sessions(client: AsyncClient) -> None:
    alice_id = await _register_user(client, "alice-analytics@example.com")
    bob_id = await _register_user(client, "bob-analytics@example.com")
    alice_task = await _create_task(client, alice_id, "Alice's task")

    now = datetime.now(UTC)
    await _record_session(client, alice_id, alice_task, now - timedelta(seconds=1500), 1500)

    response = await client.get("/analytics/focus-time", headers=_headers(bob_id))
    body = response.json()
    assert body["by_task"] == []
    assert all(b["minutes"] == 0 for b in body["by_day"])


async def test_no_sessions_returns_zero_filled_by_day_and_empty_by_task(
    client: AsyncClient,
) -> None:
    user_id = await _register_user(client, "analytics-empty@example.com")
    response = await client.get(
        "/analytics/focus-time", params={"days": 7}, headers=_headers(user_id)
    )
    body = response.json()
    assert len(body["by_day"]) == 7
    assert all(b["minutes"] == 0 for b in body["by_day"])
    assert body["by_task"] == []
