"""Settings.fail_closed_on_missing_secrets(), isolated from Compose wiring.

AC19 claims *either app*, started with a required secret unset or
empty, refuses to start. The only prior evidence (T1's manual check:
an unedited .env.example makes the whole stack fail) is confounded —
an empty POSTGRES_PASSWORD stops the `db` container's own entrypoint
before apps/api's fail-closed check ever runs, so that observation
would hold even if this check were deleted (round-6 REVIEW finding).
"""

from __future__ import annotations

import pytest

from app.core.config import Settings


def test_fail_closed_when_internal_api_secret_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_PASSWORD", "set")
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    with pytest.raises(SystemExit):
        Settings().fail_closed_on_missing_secrets()


def test_fail_closed_when_internal_api_secret_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTGRES_PASSWORD", "set")
    monkeypatch.setenv("INTERNAL_API_SECRET", "")
    with pytest.raises(SystemExit):
        Settings().fail_closed_on_missing_secrets()


def test_fail_closed_when_postgres_password_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "set")
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    with pytest.raises(SystemExit):
        Settings().fail_closed_on_missing_secrets()


def test_starts_when_both_secrets_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "set")
    monkeypatch.setenv("POSTGRES_PASSWORD", "set")
    Settings().fail_closed_on_missing_secrets()  # must not raise
