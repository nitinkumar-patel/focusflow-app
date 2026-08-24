import logging
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.core.config import settings

HEADERS = {"X-Internal-Secret": settings.internal_api_secret}


async def test_register_creates_user(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "alice@example.com", "password": "correct horse battery staple"},
        headers=HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert "id" in body
    assert "password" not in body
    assert "password_hash" not in body


async def test_register_duplicate_email_409(client: AsyncClient) -> None:
    payload = {"email": "bob@example.com", "password": "correct horse battery staple"}
    first = await client.post("/auth/register", json=payload, headers=HEADERS)
    assert first.status_code == 201
    second = await client.post("/auth/register", json=payload, headers=HEADERS)
    assert second.status_code == 409


async def test_register_short_password_422_body_has_no_input_echo(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "carol@example.com", "password": "short1"},
        headers=HEADERS,
    )
    assert response.status_code == 422
    raw = response.text
    assert "short1" not in raw
    assert '"input"' not in raw
    assert isinstance(response.json()["detail"], str)


async def test_register_over_max_password_422(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "dave@example.com", "password": "x" * 129},
        headers=HEADERS,
    )
    assert response.status_code == 422


async def test_verify_correct_password_200(client: AsyncClient) -> None:
    payload = {"email": "erin@example.com", "password": "correct horse battery staple"}
    await client.post("/auth/register", json=payload, headers=HEADERS)
    response = await client.post("/auth/verify", json=payload, headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["email"] == "erin@example.com"


async def test_verify_wrong_password_401(client: AsyncClient) -> None:
    payload = {"email": "frank@example.com", "password": "correct horse battery staple"}
    await client.post("/auth/register", json=payload, headers=HEADERS)
    response = await client.post(
        "/auth/verify",
        json={"email": "frank@example.com", "password": "wrong password"},
        headers=HEADERS,
    )
    assert response.status_code == 401


async def test_verify_unknown_email_still_calls_verify_password(client: AsyncClient) -> None:
    with patch("app.auth.router.verify_password", return_value=False) as mock_verify:
        response = await client.post(
            "/auth/verify",
            json={"email": "nobody@example.com", "password": "anything"},
            headers=HEADERS,
        )
    assert response.status_code == 401
    mock_verify.assert_called_once()


async def test_missing_internal_secret_401(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "grace@example.com", "password": "correct horse battery staple"},
    )
    assert response.status_code == 401
    # round-17 REVIEW finding: apps/web's logFailure discriminates a
    # broken web<->api deployment from a routine 401 entirely on this
    # exact detail string (apps/web/lib/api-client.ts). Pinning it here
    # only catches an api-side rename landing without an update to this
    # test — it can't catch the two sides drifting apart together (e.g.
    # this string renamed here *and* in api-client.ts to a different,
    # still-matching value); the canonical cross-service contract is
    # contracts/openapi/focusflow-api.yaml's Unauthorized response.
    assert response.json()["detail"] == "invalid internal secret"


async def test_empty_internal_secret_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "heidi@example.com", "password": "correct horse battery staple"},
        headers={"X-Internal-Secret": ""},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid internal secret"


async def test_wrong_internal_secret_401(client: AsyncClient) -> None:
    # round-17 REVIEW finding: require_internal_secret's hmac.compare_digest
    # mismatch branch (as opposed to missing/empty) had no test at all.
    response = await client.post(
        "/auth/register",
        json={"email": "ivan@example.com", "password": "correct horse battery staple"},
        headers={"X-Internal-Secret": "not the real secret"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid internal secret"


async def test_no_password_in_logs_or_responses(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    password = "correct horse battery staple-unique-marker"
    responses_text = []

    r1 = await client.post(
        "/auth/register",
        json={"email": "ivan@example.com", "password": password},
        headers=HEADERS,
    )
    responses_text.append(r1.text)

    r2 = await client.post(
        "/auth/register",
        json={"email": "ivan@example.com", "password": password},
        headers=HEADERS,
    )
    responses_text.append(r2.text)

    r3 = await client.post(
        "/auth/verify",
        json={"email": "ivan@example.com", "password": password},
        headers=HEADERS,
    )
    responses_text.append(r3.text)

    # A distinct marker (round-6 REVIEW finding): asserting the *other*
    # request's password is absent from this 422 body is vacuously true
    # regardless of whether the 422 handler echoes its own input — this
    # value must actually appear in the request to test anything.
    short_password_marker = "shrtmk"
    r4 = await client.post(
        "/auth/register",
        json={"email": "judy@example.com", "password": short_password_marker},
        headers=HEADERS,
    )
    assert short_password_marker not in r4.text
    responses_text.append(r4.text)

    for text in responses_text:
        assert password not in text
        assert "$argon2" not in text

    log_text = caplog.text
    assert password not in log_text
    assert "$argon2" not in log_text
