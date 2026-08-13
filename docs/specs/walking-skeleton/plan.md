# Plan: Walking skeleton

- **Spec:** [`spec.md`](spec.md)
- **Status:** Drafting <!-- Drafting | Approved | Executing | Done -->

> **Plan contract:** this is the implementation strategy. Unlike the spec, this
> document is allowed to change as you learn. When it changes substantially
> (a different approach, not just a re-ordering), note why in the changelog
> at the bottom.

## Approach

Build the four Dockerized components bottom-up: `api` (FastAPI + Postgres +
Alembic) first, since `web` depends on its contract; then the pieces of
`web` that don't need a UI (the Pomodoro cycle state machine, as a pure
TypeScript function); then NextAuth wiring; then the four screens
(sign-up, login, tasks + timer, analytics); then `nginx` + Compose wiring,
the end-to-end smoke pass, and the self-host guide. The riskiest part is
the auth handshake between NextAuth and FastAPI (T4/T9) — get that green
with integration tests before building UI on top of it, so a wiring bug
shows up as a failing `httpx` test, not a confusing browser redirect loop.

Testing story: TDD for the pure-logic units (password hashing, the
Pomodoro cycle state machine) and for every FastAPI route, exercised at
the integration surface against a real test Postgres; visual/manual QA for
every screen and for the final end-to-end journey against the real
`docker compose up` stack. Every task's `Tests:` line cites the spec AC it
verifies (spec `Testing Strategy` § coverage).

**Framework-currency note.** Before writing any Next.js App Router /
Server Action / NextAuth v5 code in T9-T13, the implementer confirms
current API shape against the live framework docs — not memorized
training data. Two specific things to check, named because they are known
to have moved recently: (1) NextAuth v5's Credentials-provider API and
its secret env var name (`NEXTAUTH_SECRET` vs `AUTH_SECRET`); (2) whether
the App Router's route-interception file is still `middleware.ts` or has
been renamed `proxy.ts` (a Next.js 16 change) in the Next.js version this
repo ends up on. This plan uses "the route-interception layer" in prose
and resolves the actual filename in T9.

## Constraints

- [ADR-0001](../../adr/0001-tech-stack.md) — stack, network topology
  (only Nginx publishes a port), and the NextAuth/FastAPI auth split.
- `docs/architecture/reference.md` — component stereotypes (a FastAPI
  *router module* owns one resource; a Next.js *Server Action* is the only
  caller of FastAPI) and crosscutting standards (error handling, testing
  standards) this plan's tasks conform to.
- `contracts/openapi/focusflow-api.yaml` — the FastAPI route contract every
  backend task implements against.

## Construction tests

**Integration tests:** `apps/api/tests/test_auth.py`,
`apps/api/tests/test_tasks.py`, `apps/api/tests/test_sessions.py`,
`apps/api/tests/test_analytics.py` — each spins up `httpx.AsyncClient`
against the real FastAPI app with a real test-Postgres database
(`focusflow_test`, provisioned by `apps/api/tests/conftest.py` — see T1).
Together they cover every route in
`contracts/openapi/focusflow-api.yaml`, including the 401 case for a
missing/empty `X-Internal-Secret` and the 422 cases for malformed input.

**Manual verification:** the full signup → login → create task → run one
complete work interval → see it in the analytics chart journey, driven
against `docker compose up` with no component mocked (T14); a clean-clone
self-host following only the written guide (T15).

## Design (LLD)

### Design decisions

- **Sessions represent only completed work intervals.** The Pomodoro cycle
  (work/short-break/long-break) is entirely client-side state in `web`;
  `api` never sees a break. Rejected alternative: modeling breaks as
  sessions with a `kind` field — adds a column and a filter everywhere
  analytics reads sessions, for data nobody asked to see. Traces to: AC7 ·
  `contracts/openapi/focusflow-api.yaml` `PomodoroSession`.
- **No charting dependency.** The analytics bar chart is 7 bars; built as
  inline SVG in a small React component
  (`apps/web/components/FocusTimeChart.tsx`) rather than adding `recharts`
  or similar. Traces to: AC8.
- **`/healthz` doubles as the wiring smoke check.** `apps/api` exposes
  `GET /healthz` (200 "ok", also runs `SELECT 1` against Postgres — see
  `contracts/openapi/focusflow-api.yaml`). `apps/web` exposes its own
  `GET /healthz` Route Handler that calls the API's `/healthz` internally
  and returns 200 only if that succeeds; Nginx proxies everything
  (including `/healthz`) to `web`. One `curl` through Nginx after `docker
  compose up` then proves all three components and the database are
  wired correctly. Traces to: AC10.
- **Test Postgres reuses the Compose `db` service, not a second service or
  `testcontainers`.** `apps/api/tests/conftest.py` provisions a second
  database, `focusflow_test`, on the same Postgres instance: creates it if
  absent, runs Alembic migrations against it, and truncates all tables
  between tests. Rejected alternative: `testcontainers` — a new runtime
  dependency for something the existing `db` service already does.
  Traces to: T1 § Construction tests.
- **Server Actions call `revalidatePath()` on every route the mutation
  affects.** Next.js App Router's Router Cache would otherwise serve a
  stale `/tasks` or `/analytics` after a `POST`. Creating a task
  revalidates `/tasks`; recording a session revalidates both `/tasks`
  (where the timer lives) and `/analytics` (where the chart lives) — the
  mutation happens on one route and the stale data would otherwise be on
  another. This is the standard form-Server-Action pattern
  (`<form action={serverAction}>`, `revalidatePath()` inside the action).
  **Implementer note:** confirm the current API against live Next.js docs
  before implementing T11/T12/T13 (see Approach's framework-currency
  note). Traces to: AC4, AC8.
- **The AC5 interval lengths (25/5/15 minutes) are independently
  hardcoded, with a comment citing AC5, in both
  `apps/web/lib/pomodoro-cycle.ts` and `apps/api`'s session-duration
  validator** — not shared via an env var or generated file. AC5 is the
  single canonical *source of truth* for the values; the spec's
  Ask-first boundary on changing them is what keeps the two copies from
  drifting silently (a change to either without the other is a spec
  violation, not an implementation freedom). Traces to: AC5, T7's
  duration-ceiling check.
- **The `POMODORO_TEST_SHORT_INTERVALS` override is read server-side and
  passed down as props — never as a `NEXT_PUBLIC_*` var.** A non-prefixed
  env var is not inlined into the client bundle. The gate is *presence*,
  not a production/non-production distinction — this spec has no
  separate deployment tier (every deployment is the self-hosted stack
  T1 builds, and `next build`'s `output: "standalone"` bakes
  `NODE_ENV=production` into the server bundle at build time, so a
  `NODE_ENV` runtime check cannot work here). `.env.example` ships the
  var unset; an operator (or T14's QA pass) opts in by setting it in
  their own `.env`.
  `apps/web/lib/pomodoro-durations.ts` exports a pure
  `resolveDurations(overrideEnvValue: string | undefined):
  DurationsSeconds` (`{work, short_break, long_break}` in seconds — the
  AC5 defaults unless `overrideEnvValue` is a non-empty string, taking
  the raw string as a parameter rather than reading `process.env`
  directly, so it stays unit-testable without mocking the environment).
  `apps/web/app/tasks/page.tsx` (a Server Component — the *only* place
  that reads `process.env.POMODORO_TEST_SHORT_INTERVALS`) calls
  `resolveDurations()` and passes the resulting `durationsSeconds` map
  down as a prop to `<PomodoroTimer durationsSeconds={...} />`.
  `PomodoroTimer` (a Client Component) never touches `process.env`
  itself — it only ever sees the already-resolved numbers, so there is
  no code path in the client bundle that could read the raw override
  string even by accident. `pomodoro-cycle.ts` stays pure and fully
  env-free: `nextInterval()` decides only the interval **kind** sequence
  (work/short_break/long_break); `PomodoroTimer` looks up the actual
  countdown length for that kind in the `durationsSeconds` prop it was
  given. Traces to: AC5, T14's QA pass.

### Data & schema

- `users(id uuid pk, email text unique not null, password_hash text not
  null, created_at timestamptz not null default now())`
- `tasks(id uuid pk, user_id uuid fk->users.id not null, title text not
  null, created_at timestamptz not null default now())`
- `pomodoro_sessions(id uuid pk, task_id uuid fk->tasks.id not null,
  started_at timestamptz not null, ended_at timestamptz not null,
  duration_seconds int not null check (duration_seconds > 0))`

  Deriving "focus minutes per user" joins through `tasks.user_id`, so
  `pomodoro_sessions` doesn't duplicate a `user_id` column — traces to:
  `contracts/openapi/focusflow-api.yaml` `FocusTimeByDay`/`FocusTimeByTask`.

  All three tables and the initial Alembic migration land in T2. `email`'s
  uniqueness constraint backs AC1's implicit "no duplicate accounts" and
  the 409 in `contracts/openapi/focusflow-api.yaml`. Every query that
  reads `tasks` or `pomodoro_sessions` filters by the caller's `user_id`
  (via the `tasks.user_id` join for sessions) — this is what AC14 holds
  the implementation to.

### Interfaces & contracts

- `apps/api/app/main.py` implements `GET /healthz`.
- `apps/api/app/auth/router.py` implements `POST /auth/register`,
  `POST /auth/verify` from `contracts/openapi/focusflow-api.yaml`.
- `apps/api/app/tasks/router.py` implements `GET /tasks`, `POST /tasks`,
  `POST /tasks/{task_id}/sessions`.
- `apps/api/app/analytics/router.py` implements `GET /analytics/focus-time`.
- `apps/web/lib/api-client.ts` is the single wrapper every Server Action
  calls through — attaches `X-Internal-Secret` and (when available)
  `X-User-Id`, and normalizes FastAPI's `{"detail": ...}` errors into a
  typed result. Traces to: `docs/architecture/reference.md` § Reusable
  building blocks.

### Component / module decomposition

- `apps/api/app/core/security.py` — `hash_password`, `verify_password`
  (Argon2id), and the `require_internal_secret` / `require_user_id`
  FastAPI dependencies every router uses.
- `apps/api/app/db/session.py` — the async SQLAlchemy session dependency.
- `apps/api/app/seed.py` — idempotent script creating one known test user,
  for manual QA (T4).
- `apps/web/lib/pomodoro-cycle.ts` — pure functions `firstInterval()` and
  `nextInterval(justCompleted)`, per Design (LLD) § State & control flow
  below. No React, no I/O, no env reads — a TDD unit from Testing
  Strategy.
- `apps/web/lib/pomodoro-durations.ts` — pure `resolveDurations(overrideEnvValue)`,
  also env-free (takes the env value as a parameter). The other TDD unit
  from Testing Strategy; called only from `app/tasks/page.tsx`.
- `apps/web/components/`: `SignUpForm`, `LoginForm`, `TaskList`,
  `TaskForm`, `PomodoroTimer` (consumes `pomodoro-cycle.ts` plus its
  `durationsSeconds` prop), `FocusTimeChart`.
- `apps/web/app/(auth)/signup`, `app/(auth)/login`, `app/tasks`,
  `app/analytics` — the four routes/screens.

### State & control flow

- **Pomodoro cycle (pure function contract):**
  - `type IntervalKind = "work" | "short_break" | "long_break"`.
  - `firstInterval(): {kind: "work"}` — the run's starting point (kind
    only; duration is resolved by the caller from `durationsSeconds`, see
    Design decisions).
  - `nextInterval(justCompleted: {kind: IntervalKind,
    completedWorkIntervals: number}): {kind: IntervalKind}` —
    `completedWorkIntervals` is the *total* count of work intervals
    completed so far, including the one that just completed if
    `justCompleted.kind === "work"`; it must be ≥ 1 whenever
    `justCompleted.kind === "work"` (`PomodoroTimer` always increments
    before calling — the function throws on `completedWorkIntervals < 1`
    with `kind: "work"` rather than silently misclassifying interval 0 as
    a completed one). Rule: if `justCompleted.kind === "work"`, the next
    interval is `"long_break"` when `completedWorkIntervals % 4 === 0`,
    else `"short_break"`; for any other `justCompleted.kind` (a break
    just ended), the next interval is always `"work"`. This two-argument
    shape (kind + count) — not `completedWorkIntervals` alone — is what
    makes the work→break→work cycle representable; a count-only
    signature can't distinguish "just finished work interval 1" from
    "just finished the break after work interval 1," both of which have
    `completedWorkIntervals === 1`.
  - `PomodoroTimer` holds `completedWorkIntervals` in component state; on
    each interval's natural completion it calls `nextInterval()`,
    incrementing `completedWorkIntervals` first when the completed
    interval was `"work"`, then looks up the next interval's countdown
    length from its `durationsSeconds` prop by `kind`. Only when the
    interval that just completed was `"work"` does it call the Server
    Action that `POST`s a session (which also `revalidatePath("/tasks")`
    and `revalidatePath("/analytics")` — Design decisions). Stopping a
    work interval early clears the countdown without calling
    `nextInterval()` or recording anything (AC6, AC7).
- **Auth session:** NextAuth JWT strategy; `authorize()` in
  `apps/web/lib/auth.ts` calls `POST /auth/verify` through the API client;
  on success the JWT carries the user id, which every subsequent Server
  Action reads and forwards as `X-User-Id`. The App Router's
  route-interception layer (`middleware.ts` or `proxy.ts` — T9 resolves
  the current name per the framework-currency note) redirects an
  unauthenticated request to `/tasks` or `/analytics` to `/login` (AC12).
- **Root route (`/`):** an unauthenticated visitor is redirected to
  `/signup`; an authenticated visitor is redirected to `/tasks`. This is
  what AC15's "reaches the sign-up screen" means concretely for a fresh
  clean-clone visit to `http://localhost` — there is no separate landing
  page in this spec (T10).

### Behavior & rules

- A task title must be non-empty and ≤200 chars (matches the OpenAPI
  schema); the Next.js form and the FastAPI model both enforce it
  (defense in depth per spec Boundaries); a bypassed-client request gets
  422.
- `POST /tasks/{task_id}/sessions` 404s if `task_id` doesn't exist *or*
  belongs to a different user — the same response either way, so the API
  never confirms whether a given task id exists for another user (AC14).
- `POST /tasks/{task_id}/sessions` 422s if `duration_seconds` doesn't
  equal `ended_at - started_at` within a 2-second tolerance, or if
  `duration_seconds` exceeds the AC5 work-interval length in seconds
  (1500s = 25 × 60, hardcoded per Design decisions) — prevents a crafted
  request from inflating analytics.
- Interval lengths and cadence: see spec AC5 (canonical); both runtimes
  hardcode the values per Design decisions. `POMODORO_TEST_SHORT_INTERVALS`,
  when an operator sets it in `.env`, overrides the *durations* (not the
  kind sequence) client-side for manual QA — absent by default, used by
  T14 to avoid a real 25-minute wait. It has no effect on `apps/api`'s
  session-duration validation, which stays at the AC5 ceiling regardless
  (a shortened manual-QA session is still a real, valid session — just a
  short one).
- `by_day` in `GET /analytics/focus-time` buckets by UTC calendar date
  (see `contracts/openapi/focusflow-api.yaml`) and always returns exactly
  `days` entries, zero-filled.
- `POST /auth/register`'s 409-on-duplicate-email is a deliberate,
  accepted account-enumeration disclosure for this spec's plain-auth
  scope (see spec Assumptions); not rate-limited.

### Failure, edge cases & resilience

- FastAPI down or unreachable from a Server Action: the API client
  returns a typed failure; the calling screen shows an inline "couldn't
  reach the server, try again" message rather than an uncaught error.
- Duplicate email at `/auth/register`: 409, surfaced as an inline form
  error, not a generic failure banner (account-enumeration tradeoff noted
  above and in spec Assumptions).
- Browser closed/refreshed mid-work-interval: nothing was recorded (no
  partial-session credit by design — see spec Boundaries), and on
  reload the timer resets to idle. Acceptable for the walking skeleton;
  resuming an in-flight interval is out of scope.
- `require_internal_secret` rejects (401) when `INTERNAL_API_SECRET` is
  unset or empty on either side — an empty-to-empty comparison must not
  silently authorize (T4 test).

### Quality attributes (NFRs)

None with a pass/fail bar in this spec — the walking skeleton's bar is
"the real wiring works end to end," not a performance or accessibility
target. (A future spec that hardens the product is where an NFR with a
number belongs.)

### Dependencies & integration

No new **product-facing/runtime** dependencies beyond what ADR-0001
already named (spec Boundaries § Ask first, pre-approved list). Dev/test-
only additions: `pytest`, `httpx`, `pytest-asyncio`, `ruff` on the `api`
side; `vitest`, `@testing-library/react`, and a DOM test environment
(`jsdom` or `happy-dom`) on the `web` side — `create-next-app` does
**not** wire up a test runner by default, so T1 installs and configures
these explicitly (`vitest.config.ts`, `"test": "vitest run"` in
`package.json`, per `AGENTS.md`'s declared test command). No
`testcontainers` (see Design decisions above — the existing `db` Compose
service is reused for tests instead).

## Tasks

### T1: Repo scaffolding — Compose, api skeleton, web skeleton, nginx, test DB, secrets bootstrap

**Depends on:** none

**Tests:** no stub (goal-based). AC10.

**Approach:**
- Root `docker-compose.yml`: services `db` (`postgres:17-alpine`, named
  volume, internal network only, healthcheck), `api` (build
  `apps/api/Dockerfile`, `depends_on: db: condition: service_healthy`,
  internal network only), `web` (build `apps/web/Dockerfile`, internal
  network only), `nginx` (build `apps/nginx/Dockerfile`, publishes
  `80:80` — the *only* published port in the whole file, per spec
  Never-do).
- `apps/api/`: FastAPI app factory in `app/main.py` with `GET /healthz`
  returning `{"status": "ok"}` after `SELECT 1` (503 on DB failure);
  `Dockerfile` (Python 3.13-slim base, `uvicorn` entrypoint);
  `pyproject.toml` with `ruff` configured as the lint tool
  (`AGENTS.md`'s declared lint command).
- `apps/api/tests/conftest.py`: session-scoped fixture that creates
  `focusflow_test` on the `db` service if absent, runs Alembic migrations
  against it, and truncates tables between tests (Design decisions).
- `apps/web/`: `create-next-app` (App Router, TypeScript, Tailwind, ESLint
  wired to `npm run lint` per `AGENTS.md`); `next.config.ts` with
  `output: "standalone"`; `Dockerfile` (multi-stage, Node LTS); a `GET
  /healthz` Route Handler (`app/healthz/route.ts`) that calls
  `${API_BASE_URL}/healthz`. `vitest` + `@testing-library/react` + a DOM
  test environment, configured (`vitest.config.ts`, `"test": "vitest
  run"` in `package.json`) — `create-next-app` doesn't wire this up
  itself (Dependencies & integration).
- `apps/nginx/nginx.conf` + `Dockerfile` (`nginx:alpine` base),
  proxy_pass to `web:3000`.
- `.env.example` at repo root: `INTERNAL_API_SECRET`, `NEXTAUTH_SECRET`
  (name to be confirmed against NextAuth v5 docs in T9 — may be
  `AUTH_SECRET`), `NEXTAUTH_URL`/`AUTH_URL` (also to confirm),
  `POSTGRES_*`, `DATABASE_URL`, `API_BASE_URL` (the internal `http://api:8000`
  address `api-client.ts` targets), `POMODORO_TEST_SHORT_INTERVALS`.
  Document the bootstrap step (`cp .env.example .env`, then generate
  secrets with `openssl rand -hex 32` for `INTERNAL_API_SECRET` and the
  NextAuth secret) — folds into T15's guide as the canonical write-up; a
  short comment in `.env.example` covers it for now.

**Done when:** from a clean clone, after the `.env` bootstrap step above,
`docker compose up -d --build && curl -f http://localhost/healthz`
returns 200; `docker compose ps --format '{{.Service}} {{.Ports}}'` shows
a host-published port only for the `nginx` service (spec Never-do);
`apps/api/tests/conftest.py`'s fixture successfully provisions
`focusflow_test`; a Next.js production build (`npm run build`) followed
by `test -d apps/web/.next/static && ! grep -rq "$INTERNAL_API_SECRET"
apps/web/.next/static` (with a real, non-empty value set) confirms the
directory exists and the secret never reaches the client bundle (spec
Never-do); `ruff check apps/api` and `npm run lint` (in `apps/web`) both
exit clean on the scaffolded skeleton.

### T2: Database models + Alembic migration

**Depends on:** T1

**Tests:** no stub (goal-based).

**Approach:**
- `apps/api/app/models.py`: SQLAlchemy 2.0 declarative models for
  `User`, `Task`, `PomodoroSession` per Design (LLD) § Data & schema.
- `apps/api/app/db/session.py`: async engine + session-factory dependency.
- `alembic init`, first migration creating all three tables.

**Done when:** `alembic upgrade head` succeeds against both the dev
`focusflow` and test `focusflow_test` databases from a clean volume;
`alembic downgrade base` then `upgrade head` is idempotent.

### T3: Password hashing

**Depends on:** T1

**Tests:** TDD (stub materialized in work-loop PLAN per
`references/tdd-stubs.md`).
- `apps/api/tests/test_security.py::test_hash_then_verify_succeeds`
- `apps/api/tests/test_security.py::test_verify_wrong_password_fails`
- `apps/api/tests/test_security.py::test_hash_is_not_plaintext`

**Approach:**
- `apps/api/app/core/security.py`: `hash_password(raw: str) -> str`,
  `verify_password(raw: str, hashed: str) -> bool` using `argon2-cffi`.

**Done when:** the three tests above are green.

### T4: Auth endpoints — register, verify, internal-secret dependency, seed script

**Depends on:** T2, T3

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC1, AC2, AC11 (API half).
- `apps/api/tests/test_auth.py::test_register_creates_user` (AC1)
- `apps/api/tests/test_auth.py::test_register_duplicate_email_409` (AC1)
- `apps/api/tests/test_auth.py::test_register_short_password_422` (AC1)
- `apps/api/tests/test_auth.py::test_verify_correct_password_200` (AC2)
- `apps/api/tests/test_auth.py::test_verify_wrong_password_401` (AC2)
- `apps/api/tests/test_auth.py::test_missing_internal_secret_401`
- `apps/api/tests/test_auth.py::test_empty_internal_secret_rejected`
  (Failure & edge cases: empty-to-empty must not authorize)
- `apps/api/tests/test_auth.py::test_no_password_in_logs_or_responses`
  (AC11, API half — captures `caplog` plus every response body from
  register/verify/duplicate-email and asserts the raw password and the
  `$argon2` prefix never appear)

**Approach:**
- `apps/api/app/core/security.py`: add `require_internal_secret`
  FastAPI dependency (constant-time compare against
  `INTERNAL_API_SECRET`; rejects when either side is unset/empty).
- `apps/api/app/auth/router.py`: `POST /auth/register`,
  `POST /auth/verify` per `contracts/openapi/focusflow-api.yaml`.
- `apps/api/app/seed.py`: idempotent script creating one known test user
  (email/password from env or fixed test constants), invoked via
  `docker compose exec api python -m app.seed` (`AGENTS.md` § Commands).

**Done when:** the eight tests above are green against `focusflow_test`.

### T5: Tasks endpoints

**Depends on:** T2, T4

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC3 (list shape), AC4, AC14.
- `apps/api/tests/test_tasks.py::test_create_task` (AC4)
- `apps/api/tests/test_tasks.py::test_list_returns_only_this_users_tasks` (AC14)
- `apps/api/tests/test_tasks.py::test_new_user_gets_empty_task_list` (AC3 list shape)
- `apps/api/tests/test_tasks.py::test_empty_title_422` (AC4)
- `apps/api/tests/test_tasks.py::test_missing_user_id_401`

**Approach:**
- `apps/api/app/core/security.py`: add `require_user_id` dependency
  (reads `X-User-Id`, 401 if absent or unknown).
- `apps/api/app/tasks/router.py`: `GET /tasks`, `POST /tasks`, scoped to
  the caller's `user_id` on every query.

**Done when:** the five tests above are green.

### T6: Pomodoro cycle state machine + interval-duration resolution

**Depends on:** T1

**Tests:** TDD (stub materialized in work-loop PLAN). AC5.
- `apps/web/lib/pomodoro-cycle.test.ts::firstInterval returns a work interval`
- `...::nextInterval after 1 completed work interval returns a short break`
- `...::nextInterval after a short break returns a work interval`
- `...::nextInterval after 4 completed work intervals returns a long break`
- `...::nextInterval after a long break returns a work interval`
- `...::nextInterval after 8 completed work intervals also returns a long break`
- `...::nextInterval throws when kind is "work" and completedWorkIntervals is 0`
- `apps/web/lib/pomodoro-durations.test.ts::resolveDurations with no override returns {work: 1500, short_break: 300, long_break: 900}`
- `...::resolveDurations with an override value returns the shortened durations`
- `...::resolveDurations with an empty-string override returns the defaults`

**Approach:**
- `apps/web/lib/pomodoro-cycle.ts`: `IntervalKind` type, `firstInterval()`
  and `nextInterval()` per Design (LLD) § State & control flow — kind
  sequencing only, no durations.
- `apps/web/lib/pomodoro-durations.ts`: `resolveDurations(overrideEnvValue)`
  per Design (LLD) § Design decisions.

**Done when:** the ten tests above are green (`vitest run`).

### T7: Sessions endpoint

**Depends on:** T2, T5

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC6.
- `apps/api/tests/test_sessions.py::test_record_session_against_own_task` (AC6)
- `apps/api/tests/test_sessions.py::test_record_session_against_other_users_task_404` (AC14)
- `apps/api/tests/test_sessions.py::test_record_session_nonexistent_task_404`
- `apps/api/tests/test_sessions.py::test_duration_mismatch_422` (Behavior & rules)
- `apps/api/tests/test_sessions.py::test_duration_exceeds_1500s_max_422` (Behavior & rules)

**Approach:**
- `apps/api/app/tasks/router.py`: add `POST
  /tasks/{task_id}/sessions`, ownership check and duration validation
  per Design (LLD) § Behavior & rules.

**Done when:** the five tests above are green.

### T8: Analytics endpoint

**Depends on:** T7

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC8, AC9, AC14.
- `apps/api/tests/test_analytics.py::test_by_day_sums_seeded_sessions` (AC8)
- `apps/api/tests/test_analytics.py::test_by_task_sums_seeded_sessions` (AC8)
- `apps/api/tests/test_analytics.py::test_by_day_is_zero_filled_to_days_param` (Behavior & rules)
- `apps/api/tests/test_analytics.py::test_by_day_buckets_in_utc` (Behavior & rules —
  one seeded session at 23:30 UTC and one at 00:30 UTC land in different
  day buckets)
- `apps/api/tests/test_analytics.py::test_days_param_bounds_the_window`
- `apps/api/tests/test_analytics.py::test_days_param_out_of_range_422`
- `apps/api/tests/test_analytics.py::test_excludes_other_users_sessions` (AC14)
- `apps/api/tests/test_analytics.py::test_no_sessions_returns_zero_filled_by_day_and_empty_by_task` (AC9 —
  asserts by_day has `days` zero-value entries *and* by_task is `[]`)

**Approach:**
- `apps/api/app/analytics/router.py`: `GET /analytics/focus-time`,
  grouped aggregation query scoped to the caller, UTC day-bucketing,
  zero-fill, rounding to one decimal, per
  `contracts/openapi/focusflow-api.yaml`.

**Done when:** the eight tests above are green against seeded fixture
sessions.

### T9: NextAuth wiring

**Depends on:** T1, T4

**Tests:** no stub (manual QA — auth flow behavior is proven by the E2E
journey in T14, not a unit test of NextAuth internals). AC2, AC11 (web
half, api-client/auth.ts scope), AC12.

**Approach:**
- Resolve the framework-currency note (Approach): confirm NextAuth v5's
  Credentials-provider API shape and secret env var name, and whether
  this repo's Next.js version uses `middleware.ts` or `proxy.ts` for
  route interception, against live docs. Update `.env.example`'s
  NextAuth-related var names from T1 if they were placeholders.
- `apps/web/lib/api-client.ts`: typed `fetch` wrapper (attaches
  `X-Internal-Secret` / `X-User-Id`, normalizes errors); never logs or
  includes in a thrown error the raw request body of any call that
  carries a password (`/auth/register`, `/auth/verify`) — AC11, web
  half.
- `apps/web/lib/auth.ts`: `authorize()`'s error path never logs or
  rethrows the raw password it received — AC11, web half.
- `apps/web/lib/auth.ts`: NextAuth v5 config, Credentials provider whose
  `authorize()` calls `POST /auth/verify` via the API client; JWT
  session strategy.
- The resolved route-interception file: redirect unauthenticated
  requests to `/tasks`, `/analytics` toward `/login` (AC12).

**Done when:** `npm run build` typechecks clean; a manually-driven login
against the T4 seeded test user reaches `/tasks` (AC2); a manual
unauthenticated request to `/tasks` redirects to `/login` (AC12).

### T10: Sign-up / login screens

**Depends on:** T9

**Tests:** manual QA plus one goal-based check. AC1, AC2, AC11 (web
half), AC13, AC15 (root-route half).
- Goal-based: grep `apps/web/app/(auth)/signup`, `apps/web/app/(auth)/login`,
  `apps/web/lib/api-client.ts`, and `apps/web/lib/auth.ts` for any
  `console.*`, thrown-error, or template-string that interpolates the
  `password` field — none should exist (errors reference the field name,
  never its value). AC11, web half.

**Approach:**
- `apps/web/app/(auth)/signup/page.tsx` + `SignUpForm` component,
  Server Action calling `POST /auth/register`, then signs in.
- `apps/web/app/(auth)/login/page.tsx` + `LoginForm`, calling NextAuth's
  `signIn("credentials", ...)`.
- `apps/web/app/page.tsx`: root route redirects an unauthenticated
  visitor to `/signup`, an authenticated visitor to `/tasks` (Design
  (LLD) § State & control flow — Root route).
- Each screen has exactly one primary, verb-labelled action ("Sign up",
  "Log in") — AC13.

**Done when:** the goal-based grep check passes; manually driving
sign-up with a fresh email reaches `/tasks` logged in (AC1); driving
login with a wrong password shows an inline error and does not navigate
away (AC2); both screens each render exactly one primary action control
(AC13); a fresh unauthenticated visit to `/` reaches `/signup` (AC15,
root-route half — the rest of AC15 is T15's clean-clone pass).

### T11: Task list + create-task UI

**Depends on:** T5, T9

**Tests:** no stub (manual QA). AC3, AC4, AC13.

**Approach:**
- `apps/web/app/tasks/page.tsx` (Server Component), `TaskList`,
  `TaskForm` components; Server Actions calling `GET /tasks` / `POST
  /tasks` through the API client, `revalidatePath("/tasks")` on success.
  (`resolveDurations()` is called here too, but only once `PomodoroTimer`
  exists to consume it — see T12, which depends on this task.)
- A nav `Link` to `/analytics` (client-side navigation, no full page
  load) so AC8's "without a manual page refresh" is actually exercisable
  from the running app rather than requiring the QA driver to type a URL.
- The screen's one primary action is "Add task" (AC13); each task row's
  "Start focus session" control is a per-row contextual action, not the
  screen's primary action (AC13).

**Done when:** manually creating a task shows it in the list without a
full page reload (AC4); an empty list shows the empty-state (AC3); the
screen has exactly one primary, verb-labelled action control ("Add
task") plus per-row contextual controls that don't count against that
limit (AC13); the `Link` to `/analytics` navigates client-side (visible
in the browser's Network panel as no full document request).

### T12: Pomodoro timer UI

**Depends on:** T6, T7, T11

**Tests:** manual QA plus one component test with fake timers. AC5, AC6, AC7, AC13.
- `apps/web/components/PomodoroTimer.test.tsx::runs work -> short break -> work automatically and calls the record-session action only after work intervals`
  (vitest fake timers; mocks the record-session Server Action; asserts
  the rendered interval-kind sequence over two full cycles and that the
  mock is called exactly once per completed work interval and zero
  times across break transitions — AC5, AC6, AC7)

**Approach:**
- `apps/web/app/tasks/page.tsx`: call `resolveDurations(process.env.POMODORO_TEST_SHORT_INTERVALS)`
  and pass the result to `<PomodoroTimer durationsSeconds={...} />`
  (Design decisions — the durations are resolved here, once
  `PomodoroTimer` exists to consume them).
- `apps/web/components/PomodoroTimer.tsx`: countdown UI driven by
  `pomodoro-cycle.ts`'s kind sequencing plus the `durationsSeconds` prop;
  on natural completion of a work interval, calls a Server Action that
  `POST`s to `/tasks/{task_id}/sessions` and `revalidatePath`s both
  `/tasks` and `/analytics`; on manual stop, discards without recording.
  Renders a per-task "Start focus session" / "Stop" control — contextual
  per AC13, not the screen's primary action.

**Done when:** the component test above is green; manually running one
full work interval to completion followed by `docker compose exec db
psql -U "$POSTGRES_USER" -d focusflow -c "select count(*) from
pomodoro_sessions"` shows the count incremented by 1; stopping early
leaves the count unchanged; the `/tasks` screen still has exactly one
primary action control while a run is in progress (AC13); a Next.js
production build (`npm run build`) followed by `test -d
apps/web/.next/static && ! grep -rq "POMODORO_TEST_SHORT_INTERVALS"
apps/web/.next/static` (with the var set) confirms the raw override
string never reaches the client bundle — only the derived numbers in
`durationsSeconds`, which are expected there (spec Never-do).

### T13: Analytics UI

**Depends on:** T8, T9

**Tests:** no stub (manual QA). AC8, AC9, AC13.

**Approach:**
- `apps/web/components/FocusTimeChart.tsx` (inline SVG, no charting
  dependency, per Design (LLD) § Design decisions).
- `apps/web/app/analytics/page.tsx`: fetches `GET
  /analytics/focus-time` (revalidated per Design decisions), renders
  the chart plus the per-task minutes list, or an empty-state when
  `by_task` is empty (AC9). Read-only screen — no primary action control
  (AC13).

**Done when:** starting from `/tasks` (with at least one recorded
session), clicking the `Link` to `/analytics` added in T11 (client-side
navigation, no full page load) shows a non-empty bar for today and the
task in the per-task list with the correct minutes, without a manual
page refresh (AC8); viewing it with zero recorded sessions shows the
empty-state (AC9); the screen renders no primary action control (AC13).

### T14: End-to-end Compose smoke

**Depends on:** T10, T12, T13

**Tests:** no stub (visual / manual QA — the spec's core E2E proof).
AC1, AC2, AC4, AC6, AC8, AC10, AC11 (running-artifact half), AC12.

**Approach:**
- `docker compose up -d --build` from a clean state (after the `.env`
  bootstrap); confirm `curl -f http://localhost/healthz` is 200;
  manually drive: visit `/` and confirm it reaches `/signup` (AC15,
  root-route half) → sign up → land on `/tasks` → create a task → start
  a Pomodoro run (with `POMODORO_TEST_SHORT_INTERVALS` set in `.env`,
  per spec Boundaries, so the pass doesn't require a real 25-minute
  wait) → let one work interval complete → click through to
  `/analytics` → confirm the chart and per-task list reflect it;
  separately, confirm an unauthenticated request to `/tasks` redirects
  to `/login` (AC12); capture `docker compose logs web` and grep it for
  the test password as the running-artifact half of AC11.
- Record the observed output (curl status, screenshots or terminal
  transcript of each step) in the PR description per work-loop's
  Finish checklist.

**Done when:** the journey above completes against the real containers
with no component mocked, the log grep finds no password, and the
observed output is recorded.

### T15: Self-host guide + changelog entry

**Depends on:** T14

**Tests:** manual QA. AC15.
- Manual: from a *separate* clean clone (or `git clean -xdf` on a
  scratch copy), follow only `docs/guides/how-to/self-host-with-docker-compose.md`
  verbatim, with no undocumented steps, and confirm the sign-up screen
  loads.

**Approach:**
- `docs/guides/how-to/self-host-with-docker-compose.md` (Diátaxis
  how-to): clone → `cp .env.example .env` → generate secrets → `docker
  compose up -d --build` → open `http://localhost`.
- `docs/product/changelog.md`: add a `## [walking-skeleton][0.1.0] —
  <ship date>` entry summarizing the user-visible surface this spec
  ships (per `docs/CONVENTIONS.md`'s same-PR changelog rule).

**Done when:** the clean-clone manual check above passes (AC15); the
changelog entry exists and is dated the same day as the PR.

## Rollout

- **Delivery:** big bang — this is the first spec in the repo; there is
  no prior version to roll out gradually against. Rollback is `docker
  compose down` plus discarding the branch; no data migration to reverse
  (first migration, no prod data yet).
- **Infrastructure:** none beyond what T1 stands up — four Docker Compose
  services, no external cloud infra (self-hosted per ADR-0001).
  Deployment sequencing note: `db` must be healthy before `api` runs
  migrations (Compose `depends_on: condition: service_healthy` on `db`),
  and `api` must be reachable before `web`'s `/healthz` can succeed —
  T1's Compose file encodes both.
- **External-system integration:** none.
- **Deployment sequencing:** within a single `docker compose up`, no
  further sequencing beyond the health-check ordering above.

## Risks

- **Auth handshake (NextAuth ↔ FastAPI) is the one genuinely new pattern
  in this codebase** — get T4 and T9 both green with their own tests
  before building any screen on top of them (Approach already sequences
  this).
- **Alembic + Docker Compose first-run ordering** can flake if `api`
  starts before `db` is truly ready to accept connections, not just
  "container started." Mitigated by a Compose healthcheck on `db` (T1).
- **Manual QA tasks (T9-T15) carry no automated regression protection.**
  Acceptable for a first walking skeleton at "a few weeks" appetite; if a
  regression here becomes costly, a follow-up spec should add Playwright
  E2E coverage — noted, not built now, to keep this spec's scope bounded.
- **NextAuth v5 and the App Router's route-interception file name may
  both have moved since training data was current.** Mitigated by the
  framework-currency note in Approach and T9's Approach — verify against
  live docs before implementing.

## Changelog

- 2026-08-13: initial plan.
- 2026-08-13: revised after spec-mode adversarial review round 1 (8
  Blockers, 17 Concerns, 5 Nits): redesigned `nextInterval()`'s signature
  so the work→break→work cycle is representable; added AC9 (analytics
  empty-state), AC12 (unauthenticated redirect), AC13 (screen primary
  actions); relabeled the FastAPI route tests to "TDD, integration
  surface"; added the test-Postgres fixture design (T1), the
  `duration_seconds` validation rule (T7), UTC/zero-fill rules for
  `by_day` (T8), the seed script (T4), the `.env` bootstrap and
  `INTERNAL_API_SECRET`-leak check (T1), and T15 (self-host guide +
  changelog).
- 2026-08-13: revised after spec-mode adversarial review round 2 (5
  Blockers, 11 Concerns, 8 Nits): fixed the `POMODORO_TEST_SHORT_INTERVALS`
  override, which could not reach the client bundle as originally
  specified — moved duration resolution server-side, passed as props,
  kept `pomodoro-cycle.ts` to kind-sequencing only; restated AC13 as "at
  most one primary action, contextual per-row actions don't count" so
  `/tasks` and `/analytics` are both satisfiable; corrected Testing
  Strategy's AC-to-surface mapping (AC7 and AC12 are not FastAPI-testable
  — moved to the T12 component test and manual QA respectively); added
  AC14 (cross-user isolation) and AC15 (clean-clone self-host) and
  retagged the tests that already implicitly verified them; added
  `/healthz` and the `days`-param 422 to the OpenAPI contract, and a real
  `x-spec` vendor extension key (the header comment alone didn't satisfy
  `docs/CONVENTIONS.md`'s traceability requirement); hardcoded the AC5
  interval constants on both runtimes instead of inventing a shared env
  var; added `revalidatePath("/analytics")` alongside `/tasks` on session
  recording; fixed the secret-leak grep to guard on the output directory
  existing; added `ruff` to the dependency list and T1; removed a
  version-stamped history bullet from spec.md's Assumptions (duplicated
  this changelog — the spec body must stay present-tense/as-built);
  flagged the NextAuth v5 secret-name and `middleware.ts`/`proxy.ts`
  rename as framework-currency checks for T9.
- 2026-08-13: revised after spec-mode adversarial review round 3 (5
  Blockers, 6 Concerns, 3 Nits): fixed a real bug in round 2's own fix —
  gating the QA override on `NODE_ENV !== "production"` cannot work
  because `next build`'s `output: "standalone"` bakes
  `NODE_ENV=production` into the server bundle, and this stack's only
  deployment tier *is* that production build; replaced with a
  presence-only gate (unset by default, operator opts in via `.env`) and
  no environment check. Extracted interval-duration resolution into a
  new testable pure unit, `apps/web/lib/pomodoro-durations.ts`
  (`resolveDurations`), added to T6, since the previous design left the
  actual 25/5/15-minute values with no verification artifact. Added a
  root-route redirect (`/` → `/signup` or `/tasks`) so AC15's "reaches
  the sign-up screen" has a defined target — T10. Corrected a false
  claim that `create-next-app` wires up `vitest`; added it, plus
  `@testing-library/react` and a DOM test environment, to T1 explicitly
  and to the spec's pre-approved dev-dependency list. Widened AC11's
  web-half grep to `api-client.ts` and `auth.ts` (T9/T10), added AC13 to
  T13's Tests/Done-when (the analytics screen's "no primary action"
  clause was previously unchecked), extended AC13's contextual-action
  carve-out to cover the timer's "Stop" control, moved
  `durationsSeconds` resolution from T11 (before its consumer existed)
  to T12, added a nav `Link` from `/tasks` to `/analytics` (T11) so
  AC8's "without a manual page refresh" is actually exercised rather
  than vacuously true from a typed URL, corrected T14's `Tests:` line to
  list every AC the E2E journey actually covers, and moved the
  `POMODORO_TEST_SHORT_INTERVALS` bundle-leak check to T12 (where the
  mechanism is built) instead of T1 (where nothing read it yet).
