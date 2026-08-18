FROM python:3.13-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml alembic.ini entrypoint.sh ./
COPY app ./app
COPY migrations ./migrations
RUN chmod +x entrypoint.sh

# dev: adds test/lint tooling — this is the image `docker compose exec
# api pytest` / `ruff check .` run against (see AGENTS.md), and the
# only stage this repo builds anywhere (docker-compose.yml, CI). A
# separate lean "runtime" stage existed here through round 4 REVIEW but
# was never built by anything — removed rather than kept as unbuilt,
# unscanned dead code (round-6 REVIEW finding); reintroduce it if this
# ever ships somewhere `dev`'s extra tooling shouldn't run.
FROM base AS dev
RUN pip install --no-cache-dir -e ".[dev]"
COPY tests ./tests
# Non-root (round-6 REVIEW finding): every app container ran as root,
# so any RCE/path-write bug in FastAPI would land as root in the
# container. -r for a system account with no login shell. No chown —
# the process only ever reads app code (COPY's default perms are
# already world-readable) and never writes under /app at runtime; a
# recursive chown would have handed appuser write access to its own
# code, letting a post-RCE attacker persist a change across the
# restart: unless-stopped policy below (round-7 REVIEW finding).
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
