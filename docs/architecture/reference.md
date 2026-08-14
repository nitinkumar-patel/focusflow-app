# Reference architecture

> **Normative.** This document is FocusFlow's golden path — the stack, the
> internal building blocks, the component stereotypes, and the cross-cutting
> standards new work is expected to conform to. See
> [ADR-0001](../adr/0001-tech-stack.md) for the decision and its rationale;
> this document is the steering a feature's low-level design conforms to.

## Constraints

- **Technical constraints.** Frontend: Next.js (App Router), React,
  TypeScript, Tailwind CSS. Backend: FastAPI on **Python 3.13**. Database:
  **PostgreSQL** (Dockerized, `postgres:17-alpine`). Reverse proxy: Nginx.
  **Deployment platform: self-hosted Docker Compose** — every component
  (`web`, `api`, `nginx`, `db`) ships as its own image; the whole stack
  comes up with `docker compose up`. This is not a managed-platform
  deploy (no Vercel/managed Postgres) — the explicit requirement is that
  an end user can self-host with one command.
- **Organizational / process constraints.** Single-maintainer project.
  `work-loop` governs non-trivial changes; light mode by default, full
  mode on the standard risk triggers (see `AGENTS.md`).
- **Constraints you cannot change here.** The browser never talks to
  FastAPI or Postgres directly — only Nginx is published to the host, and
  only Next.js is allowed to call FastAPI (see Solution strategy). Any
  design that has the browser call `/api/*` on FastAPI directly is
  fighting this constraint, not working within it.

## Solution strategy

- **Architectural style.** Three-tier, containerized: Next.js is the
  public web app *and* the backend-for-frontend; FastAPI is an internal
  API server that owns all business data; PostgreSQL is the system of
  record. Nginx terminates the only published port and reverse-proxies to
  Next.js. State lives in Postgres; FastAPI and Next.js are stateless
  between requests (session state lives in the NextAuth JWT cookie).
- **Key technology decisions.**
  - **Next.js (App Router) + TypeScript** for the UI — Server Actions /
    Route Handlers act as the BFF layer that calls FastAPI. Built with
    `output: "standalone"` for a minimal Docker image.
  - **FastAPI + Python 3.13** for the API — owns `users`, `tasks`, and
    `pomodoro_sessions`. Every route is a FastAPI path operation function
    with a Pydantic v2 request/response model; that's the contract new
    endpoints conform to.
  - **SQLAlchemy 2.0 (async, `asyncpg`) + Alembic** for persistence and
    migrations. Every schema change is an Alembic migration committed
    alongside the model change — no hand-run DDL.
  - **Auth.js (NextAuth v5), Credentials provider, JWT session strategy**
    on the Next.js side; FastAPI's internal `POST /auth/verify` is the
    only component that checks a password hash. Full flow in
    [ADR-0001](../adr/0001-tech-stack.md#auth-architecture).
  - **Argon2id** (`argon2-cffi`) for password hashing.
- **Quality-goal strategy.** Priority quality for a single-maintainer MVP
  is *simplicity to run and reason about* over throughput or horizontal
  scale: one Postgres instance, no queue, no cache layer, synchronous
  request/response only. Security posture: minimize the trust boundary by
  keeping FastAPI and Postgres off the public network entirely (only
  Nginx is published).

## Building-block view / component catalogue

- **Component stereotypes.**
  - **A FastAPI *router module*** owns one resource (`auth`, `tasks`,
    `sessions`, `analytics`) — path operations, Pydantic schemas, and the
    SQLAlchemy queries for that resource live together in
    `apps/api/app/<resource>/`.
  - **A SQLAlchemy *model*** is the single definition of a persisted
    entity; Pydantic schemas are derived/mirrored from it, never the
    other way around.
  - **A Next.js *Server Action or Route Handler*** is the only place
    allowed to call FastAPI. Client components never fetch FastAPI
    directly (no `NEXT_PUBLIC_API_URL` to the browser).
- **Reusable building blocks.**
  - `apps/api/app/core/security.py` — password hashing/verification
    (Argon2id) and the internal-service-secret check. New auth-adjacent
    code reuses this rather than re-implementing hashing.
  - `apps/api/app/db/session.py` — the async SQLAlchemy session
    dependency every router injects.
  - `apps/web/lib/api-client.ts` — the single typed wrapper around
    `fetch` to FastAPI (base URL, internal secret header, error
    normalization). New server actions call through it rather than
    calling `fetch` ad hoc.
- **Composition rules.** Browser → Next.js (public) → FastAPI (internal
  network only) → PostgreSQL (internal network only). No component skips
  a layer. `packages/` is empty for now — `web` and `api` don't share
  code across the language boundary; introduce a shared package only when
  a real, non-hypothetical duplication shows up.

## Crosscutting concepts / standards

- **Error handling.** FastAPI: raise `HTTPException` with a structured
  `{"detail": "..."}` body; no bare 500s for expected failure modes
  (validation, not-found, unauthorized). Next.js: Server Actions catch
  FastAPI error responses and return a typed `{ok: false, error}` result
  to the calling component — no uncaught rejections reaching the UI.
- **Observability.** FastAPI logs structured JSON to stdout (captured by
  `docker compose logs`); each request log includes method, path, status,
  and duration. No external log aggregator for the MVP — `docker compose
  logs -f api` is the read-ground-truth command until that changes.
- **Security & data handling.** Authn via NextAuth JWT session
  (browser-facing) + internal shared secret (`INTERNAL_API_SECRET`,
  server-only env var) between Next.js and FastAPI. Passwords hashed with
  Argon2id, never logged or returned in any response. All user input
  validated at the FastAPI boundary via Pydantic models; Next.js
  Server Actions re-validate before calling FastAPI (defense in depth at
  the one boundary the browser can reach).
- **Configuration & environments.** Config via environment variables.
  Compose's root `.env` drives variable *interpolation* inside
  `docker-compose.yml` only — each service that needs the values at
  runtime declares its own `env_file: .env` (or `environment:`) entry.
  Secrets (`INTERNAL_API_SECRET`, the NextAuth secret, DB credentials)
  are never committed; `.env.example` at the repo root ships every
  secret **empty**, not a placeholder value — both `apps/api` and
  `apps/web` refuse to start on an unset/empty required secret rather
  than run with a guessable or absent one (see the walking-skeleton
  spec's AC19 for the concrete rule this generalizes from).
- **Testing standards.** FastAPI: `pytest` + `httpx.AsyncClient` for
  route-level tests against a test Postgres (or SQLite for pure unit
  tests of pure logic). Next.js: component/unit tests colocated with
  source. End-to-end / smoke: `docker compose up` then an HTTP probe
  against Nginx exercising the real happy path (sign up → create task →
  run a session → see it in analytics) — this is the work-loop infra
  preflight's smoke command once the skeleton defines it in `AGENTS.md`.
