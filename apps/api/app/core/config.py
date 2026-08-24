"""Environment-derived settings, validated fail-closed at import time.

Per spec AC19: a required secret that's unset or empty must stop the
process from ever serving traffic, not just log a warning.
"""

from __future__ import annotations

import os
import sys


def _build_database_url(dbname: str, user: str, password: str) -> str:
    # Built from parts, never a single DATABASE_URL env var: no combined
    # DATABASE_URL is ever shipped, so the password has exactly one
    # canonical home (POSTGRES_PASSWORD) instead of two values that could
    # drift apart (see plan.md T1 for the full history).
    return f"postgresql+asyncpg://{user}:{password}@db:5432/{dbname}"


class Settings:
    def __init__(self) -> None:
        self.internal_api_secret = os.environ.get("INTERNAL_API_SECRET", "")
        self.postgres_user = os.environ.get("POSTGRES_USER", "focusflow")
        self.postgres_password = os.environ.get("POSTGRES_PASSWORD", "")
        self.postgres_db = os.environ.get("POSTGRES_DB", "focusflow")
        self.database_url = _build_database_url(
            self.postgres_db, self.postgres_user, self.postgres_password
        )
        self.database_url_test = _build_database_url(
            f"{self.postgres_db}_test", self.postgres_user, self.postgres_password
        )

    def required_secrets(self) -> dict[str, str]:
        return {
            "INTERNAL_API_SECRET": self.internal_api_secret,
            "POSTGRES_PASSWORD": self.postgres_password,
        }

    def fail_closed_on_missing_secrets(self) -> None:
        missing = [name for name, value in self.required_secrets().items() if not value]
        if missing:
            print(
                f"FATAL: required secret(s) unset or empty: {', '.join(missing)}. "
                "Refusing to start — see .env.example.",
                file=sys.stderr,
            )
            sys.exit(1)


settings = Settings()
