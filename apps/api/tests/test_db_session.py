import logging

import pytest

from app.db import session


async def test_check_db_connection_logs_on_failure(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    # round-16 REVIEW finding: the round-6 logger.exception(...) call had
    # no test that exercised it — test_healthz_503_when_db_unreachable
    # (test_health.py) monkeypatches check_db_connection itself, so the
    # real function's except branch (and its log line) never ran under
    # any gate. This drives check_db_connection() directly against a
    # broken engine. round-17 REVIEW fix: moved out of test_health.py —
    # it exercises app.db.session directly, not the /healthz endpoint,
    # and was the only test in that file that never touched it.
    # round-17 REVIEW nit: the real failure surfaces from
    # AsyncConnection.__aenter__ (the connection attempt), not from the
    # synchronous engine.connect() call itself — `connect()` just builds
    # the context manager. Raise from __aenter__ to match that shape.
    class _BrokenConnection:
        async def __aenter__(self) -> None:
            raise ConnectionRefusedError("db unreachable")

        async def __aexit__(self, *exc_info: object) -> None:
            return None

    class _BrokenEngine:
        def connect(self) -> _BrokenConnection:
            return _BrokenConnection()

    monkeypatch.setattr(session, "engine", _BrokenEngine())
    caplog.set_level(logging.ERROR, logger="app.db.session")

    result = await session.check_db_connection()

    assert result is False
    assert any(
        record.name == "app.db.session" and record.levelname == "ERROR"
        for record in caplog.records
    )
