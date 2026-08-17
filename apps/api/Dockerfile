FROM python:3.13-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml alembic.ini entrypoint.sh ./
COPY app ./app
COPY migrations ./migrations
RUN chmod +x entrypoint.sh

# dev: adds test/lint tooling — this is the image `docker compose exec
# api pytest` / `ruff check .` run against (see AGENTS.md).
FROM base AS dev
RUN pip install --no-cache-dir -e ".[dev]"
COPY tests ./tests
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# runtime: lean, no dev tooling. Not currently built by docker-compose.yml
# or CI (both target `dev`, so `docker compose exec api pytest` has a
# container to run against) — kept as the eventual lean-production target
# once this ships somewhere `dev`'s extra tooling shouldn't run.
FROM base AS runtime
RUN pip install --no-cache-dir .
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
