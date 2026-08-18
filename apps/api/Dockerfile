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
# /app is root-owned and world-readable but not writable by the
# non-root runtime user below (a recursive chown would have handed
# that user write access to its own code); /tmp is world-writable by
# default, so ruff/pytest caches go there instead. Set here, not in
# pyproject.toml (round-8 REVIEW fix: that file also governs a host-side
# `ruff check .`/`pytest`, where hardcoding a shared /tmp path is an
# unrelated multi-user race — this constraint is specific to this
# image's filesystem layout, so it belongs in the image that has it).
ENV RUFF_CACHE_DIR=/tmp/.ruff_cache
ENV PYTEST_ADDOPTS="-o cache_dir=/tmp/.pytest_cache"
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
