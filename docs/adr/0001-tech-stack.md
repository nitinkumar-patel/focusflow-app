# 0001. Tech stack for FocusFlow

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** project owner
- **Re-evaluation date:** 2027-02-13 (6 months, or sooner if appetite/scope
  materially changes)

## Context

FocusFlow ([brief](../product/briefs/focusflow.md)) is a single-purpose SaaS
tool: users create tasks, run a Pomodoro timer against a task, and see
lightweight analytics on their focus time. The brief's Appetite is "a few
weeks, not a quarter," so the stack needs to be boring, well-understood, and
fast to stand up — not a platform bet.

The explicit end-user requirement is that the whole application be easy for
an end user to stand up on their own infrastructure: a Dockerized,
self-hosted solution (docker-compose, not a managed-platform deploy).

## Decision

- **Frontend:** Next.js (App Router), React, TypeScript. Styling: Tailwind
  CSS. Built with `output: "standalone"` for a minimal Docker image.
- **Backend:** FastAPI on Python 3.13. SQLAlchemy 2.0 (async, `asyncpg`
  driver) for persistence, Alembic for migrations, Pydantic v2 for
  request/response schemas (FastAPI's native validation layer). Served via
  Uvicorn.
- **Database:** PostgreSQL, Dockerized (`postgres:17-alpine`), with a named
  Docker volume for data persistence across container restarts.
- **Reverse proxy:** Nginx, Dockerized, as the single public entry point.
- **Auth:** Auth.js (NextAuth v5) running inside the Next.js app, email +
  password via a Credentials provider, JWT session strategy (no NextAuth
  database adapter). See **Auth architecture** below for how this fits with
  a separate FastAPI backend.
- **Packaging:** every component (`web`, `api`, `nginx`, `db`) ships as its
  own Docker image, orchestrated by a single root `docker-compose.yml` — the
  entire stack comes up with `docker compose up`.

## Auth architecture

FastAPI owns the `users` table and is the only component that touches
password hashes (Argon2id, via `argon2-cffi` — the current OWASP-recommended
default for new projects). Concretely:

1. FastAPI exposes an internal `POST /auth/verify` endpoint: given an email
   and password, it checks the hash and returns the user record (id, email)
   or 401. It is **not** reachable from the browser — see network topology
   below.
2. NextAuth's Credentials provider `authorize()` callback calls that
   endpoint server-side and, on success, returns the user object. NextAuth
   then issues and manages its own signed JWT session cookie — FastAPI never
   sees or validates a NextAuth token.
3. For every other FastAPI call (create task, start a Pomodoro session,
   fetch analytics), the Next.js server (Server Actions / Route Handlers)
   acts as a backend-for-frontend: it reads the authenticated user from the
   NextAuth session and calls FastAPI over the internal Docker network,
   attaching the user id and a shared internal-service secret
   (`INTERNAL_API_SECRET`, env-configured) that FastAPI checks on every
   request. The browser never talks to FastAPI directly.

This keeps exactly one component (FastAPI) as the source of truth for user
identity and password handling, while letting the Next.js side use the
ecosystem-standard session library instead of hand-rolling cookie/JWT
handling for the browser.

## Network topology

```
Internet → Nginx (only published port) → Next.js (web, internal)
                                              ↓ internal Docker network only
                                           FastAPI (api, internal)
                                              ↓ internal Docker network only
                                           PostgreSQL (db, internal)
```

Only Nginx publishes a port to the host. `web`, `api`, and `db` communicate
over the Docker Compose internal network and are not independently
reachable from outside the stack. This is the simplest topology that
satisfies "one command to self-host" without exposing the API or database
directly.

## Alternatives considered

- **Next.js full-stack only (Route Handlers + Prisma/Drizzle, no separate
  backend).** Rejected: the user explicitly asked for a FastAPI/Python
  backend. Also would have been the "boring" single-runtime choice absent
  that constraint.
- **NextAuth database adapter (sessions stored in Postgres via NextAuth's
  own tables) instead of JWT strategy.** Rejected for now: it would require
  NextAuth to own a slice of the same Postgres database that FastAPI also
  owns via SQLAlchemy/Alembic, splitting migration ownership across two
  toolchains for no MVP benefit. JWT-strategy sessions keep FastAPI as the
  sole owner of the `users` table and its migrations.
- **FastAPI issues its own JWT and Next.js just relays it to the browser
  (no NextAuth).** Rejected: more code to hand-roll (refresh, expiry,
  CSRF-safe cookie handling) for a single-maintainer MVP appetite; NextAuth
  gives us that for free at the cost of one extra internal HTTP call on
  login.
- **Deploy target: Vercel + managed Postgres (Neon) instead of
  self-hosted Docker.** Rejected: explicit requirement is an end-user
  Dockerized, self-hostable solution, not a platform deploy.
- **bcrypt/passlib for password hashing.** Considered; Argon2id chosen
  instead as the current OWASP-recommended default with no legacy
  constraint pulling us toward bcrypt.

## Consequences

- Two runtimes to build, test, and deploy (Node.js for `web`, Python for
  `api`) instead of one — accepted in exchange for the explicit FastAPI
  requirement.
- The Next.js server is a trust boundary: it holds `INTERNAL_API_SECRET`
  and is the only caller FastAPI trusts. That secret must never reach the
  browser bundle (server-only env var, never `NEXT_PUBLIC_*`).
- Local dev and CI need Docker (or docker-compose service equivalents) to
  run the full stack end-to-end; each app can still run standalone against
  a local Postgres for fast inner-loop iteration.
- Repository layout: `apps/web/` (Next.js), `apps/api/` (FastAPI),
  `apps/nginx/` (reverse-proxy config + Dockerfile), root
  `docker-compose.yml`. No `packages/` yet — `web` and `api` don't share
  code across the language boundary, so there's nothing to factor out
  until a real duplication appears.
