import pytest
from httpx import AsyncClient

from app import main


async def test_healthz_ok(client: AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_healthz_503_when_db_unreachable(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # /healthz intentionally checks the real deployment DB (module-level
    # `engine`), not the per-test injected session — this test covers
    # the 503 branch, which the happy-path test above can't reach.
    async def _unreachable() -> bool:
        return False

    monkeypatch.setattr(main, "check_db_connection", _unreachable)

    response = await client.get("/healthz")
    assert response.status_code == 503
    assert response.json() == {"detail": "database unreachable"}
