import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.core.config import settings

SECRET_HEADER = {"X-Internal-Secret": settings.internal_api_secret}


async def test_sessions_route_is_removed(client: AsyncClient) -> None:
    # AC19: sessions are recorded only by timer settlement. Cross-user
    # recording is covered by test_timer.py's start-404 case.
    register = await client.post(
        "/auth/register",
        json={"email": "no-sessions-route@example.com", "password": "correct horse battery staple"},
        headers=SECRET_HEADER,
    )
    user_id = register.json()["id"]
    headers = {**SECRET_HEADER, "X-User-Id": user_id}
    created = await client.post("/tasks", json={"title": "Task"}, headers=headers)
    task_id = created.json()["id"]
    started = datetime.now(UTC) - timedelta(seconds=60)
    payload = {
        "started_at": started.isoformat(),
        "ended_at": (started + timedelta(seconds=60)).isoformat(),
        "duration_seconds": 60,
    }
    for tid in (task_id, str(uuid.uuid4())):
        response = await client.post(f"/tasks/{tid}/sessions", json=payload, headers=headers)
        assert response.status_code in (404, 405)
