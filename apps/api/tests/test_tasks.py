import uuid

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
