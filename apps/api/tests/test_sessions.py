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


def _session_payload(started: datetime, seconds: int) -> dict[str, str | int]:
    ended = started + timedelta(seconds=seconds)
    return {
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "duration_seconds": seconds,
    }


async def test_record_session_against_own_task(client: AsyncClient) -> None:
    user_id = await _register_user(client, "session-owner@example.com")
    task_id = await _create_task(client, user_id, "Write the spec")

    started = datetime.now(UTC) - timedelta(seconds=1500)
    response = await client.post(
        f"/tasks/{task_id}/sessions",
        json=_session_payload(started, 1500),
        headers=_headers(user_id),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["task_id"] == str(task_id)
    assert body["duration_seconds"] == 1500


async def test_record_session_against_other_users_task_404(client: AsyncClient) -> None:
    alice_id = await _register_user(client, "alice-sessions@example.com")
    bob_id = await _register_user(client, "bob-sessions@example.com")
    alice_task_id = await _create_task(client, alice_id, "Alice's task")

    started = datetime.now(UTC) - timedelta(seconds=60)
    response = await client.post(
        f"/tasks/{alice_task_id}/sessions",
        json=_session_payload(started, 60),
        headers=_headers(bob_id),
    )
    assert response.status_code == 404


async def test_record_session_nonexistent_task_404(client: AsyncClient) -> None:
    user_id = await _register_user(client, "nonexistent-task@example.com")
    started = datetime.now(UTC) - timedelta(seconds=60)
    response = await client.post(
        f"/tasks/{uuid.uuid4()}/sessions",
        json=_session_payload(started, 60),
        headers=_headers(user_id),
    )
    assert response.status_code == 404


async def test_duration_mismatch_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "duration-mismatch@example.com")
    task_id = await _create_task(client, user_id, "Task")

    started = datetime.now(UTC) - timedelta(seconds=60)
    ended = started + timedelta(seconds=60)
    response = await client.post(
        f"/tasks/{task_id}/sessions",
        json={
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "duration_seconds": 3000,  # doesn't match the 60s window
        },
        headers=_headers(user_id),
    )
    assert response.status_code == 422


async def test_duration_exceeds_1500s_max_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "duration-exceeds-max@example.com")
    task_id = await _create_task(client, user_id, "Task")

    started = datetime.now(UTC) - timedelta(seconds=1600)
    response = await client.post(
        f"/tasks/{task_id}/sessions",
        json=_session_payload(started, 1600),
        headers=_headers(user_id),
    )
    assert response.status_code == 422


async def test_ended_at_in_future_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "future-session@example.com")
    task_id = await _create_task(client, user_id, "Task")

    started = datetime.now(UTC) + timedelta(seconds=500)
    response = await client.post(
        f"/tasks/{task_id}/sessions",
        json=_session_payload(started, 60),
        headers=_headers(user_id),
    )
    assert response.status_code == 422


async def test_rapid_duplicate_session_for_same_task_422(client: AsyncClient) -> None:
    user_id = await _register_user(client, "rapid-duplicate@example.com")
    task_id = await _create_task(client, user_id, "Task")

    started = datetime.now(UTC) - timedelta(seconds=60)
    first = await client.post(
        f"/tasks/{task_id}/sessions",
        json=_session_payload(started, 60),
        headers=_headers(user_id),
    )
    assert first.status_code == 201

    started_again = datetime.now(UTC) - timedelta(seconds=60)
    second = await client.post(
        f"/tasks/{task_id}/sessions",
        json=_session_payload(started_again, 60),
        headers=_headers(user_id),
    )
    assert second.status_code == 422
