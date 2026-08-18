# Plan: Walking skeleton

- **Spec:** [`spec.md`](spec.md)
- **Status:** Executing <!-- Drafting | Approved | Executing | Done -->

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
the end-to-end smoke pass, the self-host guide, and a CI pipeline. The
riskiest part is the auth handshake between NextAuth and FastAPI (T4/T9) —
get that green with integration tests before building UI on top of it, so
a wiring bug shows up as a failing `httpx` test, not a confusing browser
redirect loop.

This plan folds in baseline security hardening (rate limiting, fail-closed
secrets, session-provenance rules, forwarded headers, a CI scanning
pipeline) directly into the walking skeleton rather than deferring it,
per spec Assumptions — a security-reviewer pass at spec stage found these
gaps in an auth system that's about to be self-hosted on the open
internet, and the cost of fixing them now (still doc-level, no code
written) is far lower than retrofitting them later.

Testing story: TDD for the pure-logic units (password hashing, the
Pomodoro cycle state machine, interval-duration resolution) and for every
FastAPI route, exercised at the integration surface against a real test
Postgres; visual/manual QA for every screen and for the final end-to-end
journey against the real `docker compose up` stack. Every task's `Tests:`
line cites the spec AC it verifies (spec `Testing Strategy` § coverage).

**Framework-currency note.** Before writing any Next.js App Router /
Server Action / NextAuth v5 code in T9-T13, the implementer confirms
current API shape against the live framework docs — not memorized
training data. Things known to have moved recently, all to confirm in T9:
(1) NextAuth v5's Credentials-provider API and its secret env var name
(`NEXTAUTH_SECRET` vs `AUTH_SECRET`); (2) whether the App Router's
route-interception file is still `middleware.ts` or has been renamed
`proxy.ts` (a Next.js 16 change); (3) NextAuth v5's reverse-proxy
configuration (`trustHost` / `AUTH_TRUST_HOST`) needed for T1's forwarded
headers to actually be honored. This plan uses "the route-interception
layer" in prose and resolves the actual filename in T9.

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
(`focusflow_test`, provisioned by `apps/api/tests/conftest.py` — see T1),
run via `docker compose exec api pytest` (the api image carries its dev
dependencies — see T1's Approach; there is no host-runnable path since
`db` has no published port). Together they cover every route in
`contracts/openapi/focusflow-api.yaml`, including the 401 case for a
missing/empty `X-Internal-Secret` and the 422 cases for malformed input
(asserting the *shape* of the 422 body never echoes submitted values).

**Manual verification:** the full signup → login → create task → run one
complete work interval → see it in the analytics chart journey, driven
against `docker compose up` **from a clean volume** (so migration-on-
startup is genuinely exercised) with no component mocked (T14); a
clean-clone self-host following only the written guide (T15); a rate-limit
burst probe against the running Nginx (T14).

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
- **`/healthz` doubles as the wiring smoke check, and migrations run
  before the API ever answers a request.** `apps/api`'s Docker entrypoint
  runs `alembic upgrade head` and only then execs `uvicorn` — not a
  separate manual step — so `GET /healthz` (200 "ok", also runs `SELECT
  1`) is only ever reachable once the schema exists. `apps/web` exposes
  its own `GET /healthz` Route Handler that calls the API's `/healthz`
  internally and returns 200 only if that succeeds; Nginx proxies
  everything (including `/healthz`) to `web`. One `curl` through Nginx
  after `docker compose up` **from a clean volume** then proves the
  schema is migrated and all three components and the database are wired
  correctly — this is what closes round-4's finding that nothing
  previously ran migrations inside the container. Traces to: AC10.
- **Test Postgres reuses the Compose `db` service, not a second service or
  `testcontainers`.** `apps/api/tests/conftest.py` provisions a second
  database, `focusflow_test`, on the same Postgres instance: creates it if
  absent, runs Alembic migrations against it, and truncates all tables
  between tests. Rejected alternative: `testcontainers` — a new runtime
  dependency for something the existing `db` service already does. Since
  `db` has no published port (spec Never-do), tests run **inside** the
  `api` container (`docker compose exec api pytest`), which needs its dev
  dependencies installed — T1's Dockerfile builds a `dev` stage/target
  that includes them, distinct from the lean runtime stage. Traces to: T1
  § Construction tests.
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
  hardcoded, with a comment citing AC5, in `apps/web/lib/pomodoro-
  durations.ts`, `apps/api`'s session-duration validator
  (`MAX_WORK_INTERVAL_SECONDS`), and (round-3 REVIEW correction — this
  entry previously named `pomodoro-cycle.ts`, which only sequences
  interval *kinds* and never held the duration values, and omitted this
  third copy entirely) `apps/web/app/(app)/tasks/actions.ts`'s own
  `MAX_WORK_INTERVAL_SECONDS`, added alongside `recordSessionAction`'s
  round-2 re-validation** — not shared via an env var or generated
  file. AC5 is the single canonical *source of truth* for the values;
  the spec's Ask-first boundary on changing them is what keeps all
  three copies from drifting silently (a change to any one without the
  others is a spec violation, not an implementation freedom). Traces
  to: AC5, T7's duration-ceiling check.
- **The `POMODORO_TEST_SHORT_INTERVALS` override is read server-side and
  passed down as props — never as a `NEXT_PUBLIC_*` var.** A non-prefixed
  env var is not inlined into the client bundle. The gate is *presence*,
  not a production/non-production distinction — this spec has no
  separate deployment tier, and `next build`'s `output: "standalone"`
  bakes `NODE_ENV=production` into the server bundle at build time, so a
  `NODE_ENV` runtime check cannot work here. **Delivery mechanics
  (round-4 finding; env-var mechanism corrected by round-2 REVIEW
  finding):** `docker-compose.yml` gives `web` and `api` each an
  explicit `environment:` list naming only the vars that service reads
  (not the shared `env_file: .env` this originally specified, which
  handed every service every secret — round-2 REVIEW Nit) — Compose's
  root `.env` only drives variable *interpolation* inside
  `docker-compose.yml` itself (the `${VAR}` references in each
  `environment:` entry), not container environment directly, so each
  service still needs its own `environment:` (or `env_file`) entry to
  actually receive the vars at runtime.
  `apps/web/app/(app)/tasks/page.tsx` reads the NextAuth session (making
  it dynamically rendered, never statically optimized at build time), so
  `process.env.POMODORO_TEST_SHORT_INTERVALS` is evaluated per-request
  inside the running container, not baked in at `docker build` time —
  setting the var in `.env` and running `docker compose up -d` (no
  rebuild needed) picks it up on the next request.
  `apps/web/lib/pomodoro-durations.ts` exports a pure
  `resolveDurations(overrideEnvValue: string | undefined):
  DurationsSeconds` (`{work, short_break, long_break}` in seconds — the
  AC5 defaults, `{work: 1500, short_break: 300, long_break: 900}`, unless
  `overrideEnvValue` is a non-empty string, in which case it returns the
  fixed QA override map `{work: 60, short_break: 15, long_break: 30}`
  (round-4 finding: the override map was previously undefined — pinned
  here so T6's stub has a concrete value to assert). It takes the raw
  string as a parameter rather than reading `process.env` directly, so it
  stays unit-testable without mocking the environment.
  `apps/web/app/(app)/tasks/page.tsx` (a Server Component — the *only*
  place that reads `process.env.POMODORO_TEST_SHORT_INTERVALS`) calls
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
- **`X-User-Id` is derived solely from the validated NextAuth session,
  inside each Server Action/Route Handler, never accepted as a
  parameter.** Every function that calls `apps/web/lib/api-client.ts`
  starts with `const session = await auth(); if (!session?.user?.id)
  return {ok: false, error: "unauthorized"};` and then passes
  `session.user.id` to the client — never a value received as a function
  argument, form field, or client-supplied prop. This is the *actual*
  authorization boundary; the route-interception redirect (AC12) is only
  a UX convenience that keeps a logged-out visitor from seeing a
  broken screen — Next.js middleware/proxy has had bypass CVEs
  (`x-middleware-subrequest`-class issues) and must never be the sole
  guard. Traces to: AC16.
- **FastAPI's validation-error responses never echo submitted field
  values.** FastAPI's default `RequestValidationError` handler returns
  Pydantic v2's raw error list, which includes an `input` key holding the
  offending value — for `/auth/register`'s and `/auth/verify`'s password
  field, that's the raw password reflected straight into a 422 response
  (round-4 and security-review both independently flagged this as a
  Blocker). `apps/api/app/main.py` installs a custom
  `@app.exception_handler(RequestValidationError)` that builds `{"detail":
  "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e
  in exc.errors())}` — using only `loc` and `msg`, never `input` or
  `ctx` — matching the contract's `Error {detail: string}` shape. Traces
  to: AC11, T4.
- **`/auth/verify` costs the same wall-clock work for an unknown email as
  a wrong password.** A naive "look up the user, 401 if not found" short-
  circuits before hashing when the email doesn't exist, which is a timing
  side-channel that discloses account existence — a second channel beyond
  the already-accepted `/auth/register` 409 enumeration (spec
  Assumptions), and this one wasn't a deliberate tradeoff, just an
  oversight. When the email isn't found, `apps/api/app/auth/router.py`
  calls `verify_password` against a fixed dummy Argon2id hash (a module-
  level constant, computed once at import time) before returning 401, so
  both paths always run one hash verification. Traces to: T4.
- **Secrets ship empty in `.env.example`, and both apps refuse to start
  on an unset or empty secret.** Rejected alternative (the previous
  design): a non-empty example value — round-4/security review flagged
  that an operator who forgets to regenerate it ends up running with a
  secret published in a public repo, with no signal anything is wrong.
  Round-5 review then flagged that a *placeholder-text* denylist is
  undefined once the value is empty rather than a placeholder string —
  dropped; the check is simply "unset or empty," nothing more.
  `apps/api/app/main.py` and `apps/web`'s startup path both check
  `INTERNAL_API_SECRET`, the NextAuth secret, and `POSTGRES_PASSWORD`
  for empty/unset and exit non-zero rather than start. Traces to: AC19,
  T1.
- **The seed script takes no default credentials.** Rejected alternative
  (the previous design): "fixed test constants" as a fallback — round-4/
  security review flagged this as a permanent hardcoded-credential
  backdoor (CWE-798) on any instance where the seed was ever run.
  `apps/api/app/seed.py` requires `SEED_USER_EMAIL` (exits non-zero if
  unset); if `SEED_USER_PASSWORD` is also unset, it generates one via
  `secrets.token_urlsafe(16)` and prints it once to stdout. It is
  idempotent by email (no-op if that email already exists) — it does
  **not** attempt to detect or refuse against unrelated pre-existing
  rows, since defining "a row this script didn't create" precisely would
  need a marker column with no other purpose; requiring explicit,
  non-defaulted credentials already closes the actual finding (a fixed,
  guessable, permanent account). Traces to: T4.
- **Nginx rate-limits the auth-adjacent and health paths, and forwards
  the headers Server Actions/NextAuth need.** `apps/nginx/nginx.conf`
  defines `limit_req_zone $binary_remote_addr zone=auth:10m rate=20r/m;`
  applied with `limit_req zone=auth burst=5 nodelay;` to `/signup`,
  `/login`, and `/api/auth/` (NextAuth's own routes) — 20/min with a
  burst of 5 is generous enough for a person clicking through the E2E
  journey by hand (T14) or retrying a typo'd password a few times, while
  still capping a scripted credential-stuffing burst; and a separate
  `zone=healthz:10m rate=60r/m;` with `burst=10 nodelay;` on `/healthz`.
  Every proxied location also sets `proxy_set_header Host $host;`,
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
  `proxy_set_header X-Forwarded-Proto $scheme;`, and
  `proxy_set_header X-Forwarded-Host $host;` — without these, Next.js
  sees `Host: web:3000` while the browser's `Origin` says
  `http://localhost`, failing every Server Action's CSRF check; the
  tempting "fix" under time pressure is a wildcard `allowedOrigins`,
  which the spec's Never-do forbids outright because it disables that
  protection for everyone, not just the proxy. Traces to: AC17, AC21, T1.
  **Rate-limit caveat (round-5 finding):** `limit_req_zone` keys on
  `$binary_remote_addr`, which is correct for a bare `docker compose up`
  deployment but becomes a *global* limit if an operator follows AC20's
  advice and puts their own TLS-terminating proxy in front — every
  request would then arrive from that proxy's single IP. Configuring
  `real_ip_header`/`set_real_ip_from` correctly requires knowing that
  proxy's address, which this spec can't know in advance; T15's guide
  states this limitation explicitly rather than guessing at a config
  that would be wrong for most operators. **AC21 verification
  (round-5 finding):** `curl`'s response headers can't show what Nginx
  forwarded *upstream*, so AC21 isn't verified by inspecting a response —
  it's verified structurally (T1: grep `nginx.conf` for the four
  `proxy_set_header` directives) and functionally (T14: a Server Action
  that only works when Origin/Host forwarding is correct — e.g. creating
  a task through the full stack — succeeding when driven through Nginx
  *is* the end-to-end proof; a wrong-header config would make every
  mutating Server Action fail).
- **A CI workflow exists but is verified structurally, not by execution.**
  This environment has no GitHub Actions runner to actually run a
  workflow against; `.github/workflows/ci.yml` (secret scan + `npm
  audit`/`pip-audit` + a container scan, e.g. `trivy`) is added and its
  YAML validated for structure (a parser can load it; the three
  expected `- uses:`/`- run:` steps are present) rather than claimed as
  "passing," which would be a claim this environment can't back up.
  Traces to: AC22, T16.

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
  the implementation to. Indexes on `tasks.user_id` and
  `pomodoro_sessions.task_id` back every one of those filters/joins
  (round-2 REVIEW finding) — added by amending T2's still-unreleased
  initial migration directly rather than a follow-up one; any Postgres
  volume created before this fix landed needs `docker compose down -v`
  before the next `docker compose up`, since `alembic upgrade head` is a
  no-op once a revision id is already stamped.

### Interfaces & contracts

- `apps/api/app/main.py` implements `GET /healthz` and the custom
  `RequestValidationError` handler (Design decisions).
- `apps/api/app/auth/router.py` implements `POST /auth/register`,
  `POST /auth/verify` from `contracts/openapi/focusflow-api.yaml`.
- `apps/api/app/tasks/router.py` implements `GET /tasks`, `POST /tasks`,
  `POST /tasks/{task_id}/sessions`.
- `apps/api/app/analytics/router.py` implements `GET /analytics/focus-time`.
- `apps/web/lib/api-client.ts` is the single wrapper every Server Action
  calls through — attaches `X-Internal-Secret` and (when available)
  `X-User-Id`, and normalizes FastAPI's `{"detail": ...}` errors into a
  typed result without ever including request headers in the normalized
  error. Traces to: `docs/architecture/reference.md` § Reusable building
  blocks; AC11 (secret half).

### Component / module decomposition

- `apps/api/app/core/security.py` — `hash_password`, `verify_password`
  (Argon2id), the module-level dummy hash for the timing-attack
  mitigation, and the `require_internal_secret` / `require_user_id`
  FastAPI dependencies every router uses.
- `apps/api/app/db/session.py` — the async SQLAlchemy session dependency.
- `apps/api/app/seed.py` — the no-default-credentials seed script (T4).
- `apps/web/lib/pomodoro-cycle.ts` — pure functions `firstInterval()` and
  `nextInterval(justCompleted)`, per Design (LLD) § State & control flow
  below. No React, no I/O, no env reads — a TDD unit from Testing
  Strategy.
- `apps/web/lib/pomodoro-durations.ts` — pure `resolveDurations(overrideEnvValue)`,
  also env-free (takes the env value as a parameter). The other TDD unit
  from Testing Strategy; called only from `app/(app)/tasks/page.tsx`.
- `apps/web/components/`: `SignUpForm`, `LoginForm`, `TaskList`,
  `TaskForm`, `PomodoroTimer` (consumes `pomodoro-cycle.ts` plus its
  `durationsSeconds` prop), `FocusTimeChart`, `LogoutButton`.
- **Server Action convention (round-5 clarification):** every route
  segment's Server Actions live in a sibling `actions.ts` (e.g.
  `app/(auth)/signup/actions.ts`, `app/(app)/tasks/actions.ts`,
  `app/(app)/analytics/actions.ts`) — never inlined in a component or a
  `page.tsx`. This is what makes AC16's grep check
  (`apps/web/app/**/actions.ts`) exhaustive rather than a spot-check.
- `apps/web/app/(auth)/signup`, `app/(auth)/login` — unauthenticated
  routes. `apps/web/app/(app)/layout.tsx` — shared authenticated shell
  (nav: "Tasks" / "Analytics", plus `LogoutButton`) wrapping
  `app/(app)/tasks` and `app/(app)/analytics`. `apps/web/app/page.tsx` —
  root-route redirect.

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
    Action that `POST`s a session (which also `revalidatePath`s both
    `/tasks` and `/analytics` — Design decisions). Stopping a work
    interval early clears the countdown without calling `nextInterval()`
    or recording anything (AC6, AC7).
- **Auth session:** NextAuth JWT strategy, `maxAge` set to 7 days
  (absolute — AC18; no idle-timeout mechanism in this spec, noted as a
  narrower control than a production auth system would carry).
  `authorize()` in `apps/web/lib/auth.ts` calls `POST /auth/verify`
  through the API client; on success the JWT carries the user id, which
  every subsequent Server Action reads via `auth()` and forwards as
  `X-User-Id` — never from a function parameter (Design decisions, AC16).
  The App Router's route-interception layer (`middleware.ts` or
  `proxy.ts` — T9 resolves the current name per the framework-currency
  note) redirects an unauthenticated request to `/tasks` or `/analytics`
  to `/login` (AC12) as a UX convenience; it is not the authorization
  boundary (AC16).
- **Logout:** `LogoutButton` (in `app/(app)/layout.tsx`'s nav) calls
  NextAuth's `signOut()`, which clears the session cookie; a subsequent
  request to `/tasks` then hits the route-interception redirect to
  `/login` (AC18).
- **Root route (`/`):** an unauthenticated visitor is redirected to
  `/signup`; an authenticated visitor is redirected to `/tasks`. This is
  what AC15's "reaches the sign-up screen" means concretely for a fresh
  clean-clone visit to `http://localhost` — there is no separate landing
  page in this spec (T10).

### Behavior & rules

- A task title must be non-empty and ≤200 chars (matches the OpenAPI
  schema); the Next.js form and the FastAPI model both enforce it
  (defense in depth per spec Boundaries); a bypassed-client request gets
  422 with the field-message-only body (Design decisions).
- `POST /tasks/{task_id}/sessions` 404s if `task_id` doesn't exist *or*
  belongs to a different user — the same response either way, so the API
  never confirms whether a given task id exists for another user (AC14).
- `POST /tasks/{task_id}/sessions` 422s if `duration_seconds` doesn't
  equal `ended_at - started_at` within a 2-second tolerance, or if
  `duration_seconds` exceeds the AC5 work-interval length in seconds
  (1500s = 25 × 60, hardcoded per Design decisions); it also 422s if
  `ended_at` is more than 60 seconds in the future relative to the
  server's clock (a small tolerance for client/server clock skew, not a
  meaningful window for backdating), and if the same task already has a
  session whose `ended_at` is within the last 60 seconds (rejects
  rapid-fire duplicate submissions — not a general rate limiter, just a
  guard against the specific replay shape a crafted client could
  attempt). These checks constrain a single session's shape and simple
  replay; they do not bound total sessions recorded over time — a
  correctly-authenticated user can always run more real Pomodoro cycles,
  which is not something to prevent.
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
  `days` entries, zero-filled. The aggregation query is expressed via
  SQLAlchemy Core/ORM constructs (or `text()` with bound parameters) —
  never an f-string or `%`-formatted query string, even for the
  date-bucketing expression (the one place in this spec's SQL surface
  where hand-building a fragment might otherwise be tempting).
- `by_task` is all-time — the `days` window applies only to `by_day`
  (round-2 REVIEW finding). AC9's empty state means "no recorded
  sessions ever", so the empty-state decision in
  `apps/web/app/(app)/analytics/page.tsx` keys off `by_task`, not
  `by_day`; windowing `by_task` too would incorrectly show the
  empty-state for a user whose only sessions predate the window.
- `POST /auth/register`'s 409-on-duplicate-email is a deliberate,
  accepted account-enumeration disclosure for this spec's plain-auth
  scope (see spec Assumptions); `/auth/verify`'s response time is *not*
  a second disclosure channel — see the timing-attack mitigation in
  Design decisions. Both paths remain subject to AC17's general rate
  limit.

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
- Navigating from `/tasks` to `/analytics` (or anywhere else) mid-run has
  the same effect as a refresh: the client-side navigation unmounts
  `PomodoroTimer`, clearing its interval with nothing recorded. Same
  acceptable-loss reasoning as the line above — not a separate gap
  (round-1 REVIEW finding).
- `require_internal_secret` rejects (401) when `INTERNAL_API_SECRET` is
  unset or empty on either side — an empty-to-empty comparison must not
  silently authorize (T4 test). Both apps refuse to **start** at all on
  an unset/empty required secret (Design decisions, AC19) — this is
  stricter than the per-request 401 and catches the failure at boot
  instead of on first request.
- Rate-limited requests (AC17): Nginx returns 429 directly; `web`/`api`
  never see the excess requests, so no application-level handling is
  needed for the limited paths themselves.

### Quality attributes (NFRs)

None with a numeric pass/fail bar beyond what's now folded into the
Acceptance Criteria as hardening ACs (AC17 rate-limit threshold, AC18
session lifetime). No broader performance or accessibility target — the
walking skeleton's bar is "the real wiring works end to end, safely
enough to self-host." A future spec that hardens the product further
(full WAF-class protection, accessibility audit, load targets) is where
a richer NFR set belongs.

### Dependencies & integration

No new **product-facing/runtime** dependencies beyond what ADR-0001
already named (spec Boundaries § Ask first, pre-approved list). Dev/test-
only additions: `pytest`, `httpx`, `pytest-asyncio`, `ruff` on the `api`
side; `vitest`, `@testing-library/react`, `@testing-library/dom`,
`@vitejs/plugin-react`, and a DOM test environment (`jsdom` or
`happy-dom`) on the `web` side — `create-next-app` does **not** wire up a
test runner by default, so T1 installs and configures these explicitly
(`vitest.config.ts` with `plugins: [react()]` and `environment: 'jsdom'`,
`"test": "vitest run"` in `package.json`, per `AGENTS.md`'s declared test
command). CI-only additions (T16): a secret-scanning GitHub Action, an
SCA action per ecosystem, a container-scan action (e.g. `trivy`) — these
never ship to a deployed instance. No `testcontainers` (see Design
decisions above — the existing `db` Compose service is reused for tests
instead).

**EXECUTE-time addendum (T4):** `pydantic[email]` (the `email` extras
variant of the already-ADR-0001-named `pydantic`, pulling in
`email-validator` + `dnspython`) replaced the bare `pydantic` runtime
dependency — `EmailStr` needs the extras package installed, discovered
via a container crash on `RegisterRequest`'s `email: EmailStr` field.
Recorded here per spec Boundaries § Ask first, round-1 REVIEW finding.

## Tasks

### T1: Repo scaffolding — Compose, api/web skeletons, nginx, test DB, secrets bootstrap, rate limiting

**Depends on:** none

**Tests:** no stub (goal-based). AC10, AC17, AC19, AC21.

**Approach:**
- Root `docker-compose.yml`: services `db` (`postgres:17-alpine`, named
  volume, internal network only, healthcheck), `api` (build
  `apps/api/Dockerfile` — `dev` target with dev deps, `depends_on: db:
  condition: service_healthy`, explicit `environment:` list naming only
  `INTERNAL_API_SECRET`/`POSTGRES_*` (round-2 REVIEW fix — not the
  shared `env_file: .env` this line originally specified), internal
  network only, entrypoint runs `alembic upgrade head` then execs
  `uvicorn`), `web` (build `apps/web/Dockerfile`, its own explicit
  `environment:` list — `AUTH_SECRET`/`INTERNAL_API_SECRET`/
  `API_BASE_URL`/`POMODORO_TEST_SHORT_INTERVALS` — internal network
  only),
  `nginx` (build `apps/nginx/Dockerfile`, publishes `80:80` — the *only*
  published port in the whole file, per spec Never-do).
- `apps/api/`: FastAPI app factory in `app/main.py` with `GET /healthz`
  returning `{"status": "ok"}` after `SELECT 1` (503 on DB failure), the
  custom `RequestValidationError` handler (Design decisions), and a
  startup check that exits non-zero if `INTERNAL_API_SECRET` or
  `POSTGRES_PASSWORD` is unset or empty; `Dockerfile` (Python 3.13-slim
  base, multi-stage `dev`/`runtime` targets — `ruff`/`pytest`/`httpx`/
  `pytest-asyncio` land only in `dev`, so both lint and test run via
  `docker compose exec api ruff check .` / `docker compose exec api
  pytest`, never a bare host command — `uvicorn` entrypoint via a small
  shell wrapper that runs the migration first); `pyproject.toml` with
  `ruff` configured (`AGENTS.md`'s declared lint command, corrected in
  this revision to the container form) and `pytest`/`httpx`/
  `pytest-asyncio` in the `dev` extra.
- `apps/api/tests/conftest.py`: session-scoped fixture that creates
  `focusflow_test` on the `db` service if absent, runs Alembic migrations
  against it, and truncates tables between tests (Design decisions).
- `apps/web/`: `create-next-app` (App Router, TypeScript, Tailwind, ESLint
  wired to `npm run lint` per `AGENTS.md`); `next.config.ts` with
  `output: "standalone"`; `Dockerfile` (multi-stage, Node LTS); a `GET
  /healthz` Route Handler (`app/healthz/route.ts`) that calls
  `${API_BASE_URL}/healthz`; a startup check (a small script run before
  `next start` in the Dockerfile's `CMD`) that exits non-zero if the
  NextAuth secret is unset or empty. `vitest` +
  `@testing-library/react` + `@testing-library/dom` + `@vitejs/plugin-react`
  + a DOM test environment, configured (`vitest.config.ts` with
  `plugins: [react()]`, `environment: 'jsdom'`; `"test": "vitest run"` in
  `package.json`) — `create-next-app` doesn't wire this up itself
  (Dependencies & integration).
- `apps/nginx/nginx.conf` + `Dockerfile` (`nginx:alpine` base):
  `proxy_pass` to `web:3000`; the forwarded-header set (`Host`,
  `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`) on every
  location; the two `limit_req_zone`s and their `limit_req` directives on
  `/signup`, `/login`, `/api/auth/`, and `/healthz` (Design decisions).
- `.env.example` at repo root, **every secret shipped empty**
  (`INTERNAL_API_SECRET=`, the NextAuth secret var `=`) with a comment
  pointing at `openssl rand -hex 32`; also `POSTGRES_*` (no combined
  `DATABASE_URL` var — a `.env` file's own values aren't recursively
  interpolated within that same file, so a line like
  `DATABASE_URL=postgresql://...${POSTGRES_PASSWORD}...` inside `.env`
  would ship the literal string `${POSTGRES_PASSWORD}`, not the actual
  password, regardless of whether the consuming compose service uses
  `env_file:` or an explicit `environment:` list — `.env`'s values only
  ever get *read into* `docker-compose.yml`'s own `${VAR}`
  interpolation, never expanded against each other. So
  `apps/api/app/core/config.py` builds `database_url` from the separate
  `POSTGRES_*` parts instead — round-2 REVIEW correction, this line
  previously listed a `DATABASE_URL` var that was never actually
  shipped; round-3 REVIEW correction, the original explanation
  over-attributed the constraint to `env_file:` specifically, which no
  longer even applies since round-2 switched both services to explicit
  `environment:` lists),
  `API_BASE_URL` (the internal `http://api:8000` address `api-client.ts`
  targets), `POMODORO_TEST_SHORT_INTERVALS=` (also empty by default).
  `.env`, `.env.*` (with `!.env.example`), `node_modules/`, and `.next/`
  added to `.gitignore` (already done in this revision).

**Done when:** from a clean clone, `git check-ignore -q .env` succeeds
(the file would be ignored if it existed); starting the stack straight
from a copied, un-edited `.env.example` (`cp .env.example .env && docker
compose up -d --build`) **fails to serve traffic** — `api` and/or `web`
exit non-zero rather than accepting requests (AC19); after generating
real secrets and re-running, `docker compose up -d --build && curl -f
http://localhost/healthz` returns 200 **and** the database contains the
migrated tables (`docker compose exec db psql -U "$POSTGRES_USER" -d
focusflow -c '\dt'` lists `users`, `tasks`, `pomodoro_sessions`);
`docker compose ps --format '{{.Service}} {{.Ports}}'` shows a
host-published port only for `nginx`; a scripted burst of 25 requests to
`http://localhost/login` within a minute shows at least one 429 response
(AC17); `grep -c 'proxy_set_header' apps/nginx/nginx.conf` reports at
least 4 per proxied location (AC21 structural check — the functional
proof that the headers actually work is T14's, once a real Server
Action exists to drive through the proxy); `apps/api/tests/conftest.py`'s
fixture successfully provisions `focusflow_test` (verified via
`docker compose exec api pytest --collect-only`); a Next.js production
build (`npm run build`) followed by `test -d apps/web/.next/static && !
grep -rq "$INTERNAL_API_SECRET" apps/web/.next/static` (with a real,
non-empty value set) confirms the directory exists and the secret never
reaches the client bundle (spec Never-do); `docker compose exec api
pytest` and `npm test` (in `apps/web`) both run (zero or one trivial
test) without a runner/config error; `docker compose exec api ruff
check .` and `npm run lint` (in `apps/web`) both exit clean on the
scaffolded skeleton.

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
`alembic downgrade base` then `upgrade head` is idempotent; restarting
the `api` container against an already-migrated `db` (T1's entrypoint
re-running `alembic upgrade head`) is a fast no-op, not an error.

### T3: Password hashing

**Depends on:** T1

**Tests:** TDD (stub materialized in work-loop PLAN per
`references/tdd-stubs.md`).
- `apps/api/tests/test_security.py::test_hash_then_verify_succeeds`
- `apps/api/tests/test_security.py::test_verify_wrong_password_fails`
- `apps/api/tests/test_security.py::test_hash_is_not_plaintext`
- `apps/api/tests/test_security.py::test_hash_uses_argon2id` (asserts
  the digest starts with `$argon2id$` — pins the algorithm choice so a
  later "performance" swap to a fast hash can't pass silently)
- `apps/api/tests/test_security.py::test_same_password_different_hashes`
  (per-password salt — two hashes of the same input must differ)

**Approach:**
- `apps/api/app/core/security.py`: `hash_password(raw: str) -> str`,
  `verify_password(raw: str, hashed: str) -> bool` using `argon2-cffi`; a
  module-level `_DUMMY_HASH` constant (a precomputed Argon2id hash of an
  arbitrary fixed string) for T4's timing-attack mitigation.

**Done when:** the five tests above are green.

### T4: Auth endpoints — register, verify, internal-secret dependency, seed script

**Depends on:** T2, T3

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC1, AC2, AC11 (API half, including the 422 case).
- `apps/api/tests/test_auth.py::test_register_creates_user` (AC1)
- `apps/api/tests/test_auth.py::test_register_duplicate_email_409` (AC1)
- `apps/api/tests/test_auth.py::test_register_short_password_422_body_has_no_input_echo`
  (AC1, AC11 — asserts the 422 body's `detail` is a string containing no
  substring of the submitted password and no `"input"` key anywhere in
  the JSON)
- `apps/api/tests/test_auth.py::test_register_over_max_password_422`
  (AC1 — a 129+ char password is rejected)
- `apps/api/tests/test_auth.py::test_verify_correct_password_200` (AC2)
- `apps/api/tests/test_auth.py::test_verify_wrong_password_401` (AC2)
- `apps/api/tests/test_auth.py::test_verify_unknown_email_still_calls_verify_password`
  (timing-attack mitigation — spies/mocks `verify_password` and asserts
  it's called even when the email doesn't exist, not a wall-clock timing
  measurement)
- `apps/api/tests/test_auth.py::test_missing_internal_secret_401`
- `apps/api/tests/test_auth.py::test_empty_internal_secret_rejected`
  (Failure & edge cases: empty-to-empty must not authorize)
- `apps/api/tests/test_auth.py::test_no_password_in_logs_or_responses`
  (AC11, API half — captures `caplog` plus every response body from
  register/verify/duplicate-email/the-422-case and asserts the raw
  password and the `$argon2` prefix never appear)
- `apps/api/tests/test_seed.py::test_seed_requires_email_env_var` (exits
  non-zero when `SEED_USER_EMAIL` is unset)
- `apps/api/tests/test_seed.py::test_seed_generates_password_when_unset`
  (prints a generated password once; doesn't hardcode one)
- `apps/api/tests/test_seed.py::test_seed_is_idempotent_by_email`

**Approach:**
- `apps/api/app/core/security.py`: add `require_internal_secret`
  FastAPI dependency (constant-time compare against
  `INTERNAL_API_SECRET`; rejects when either side is unset/empty).
- `apps/api/app/auth/router.py`: `POST /auth/register`,
  `POST /auth/verify` per `contracts/openapi/focusflow-api.yaml`; verify
  runs `verify_password` against `_DUMMY_HASH` when the email is unknown
  before returning 401 (Design decisions).
- `apps/api/app/seed.py`: no-default-credentials seed script per Design
  decisions.

**Done when:** the thirteen tests above are green against `focusflow_test`.

### T5: Tasks endpoints

**Depends on:** T2, T4

**Tests:** TDD (stub materialized in work-loop PLAN), integration
surface. AC3 (list shape), AC4, AC14, AC16 (API-side scoping half).
- `apps/api/tests/test_tasks.py::test_create_task` (AC4)
- `apps/api/tests/test_tasks.py::test_list_returns_only_this_users_tasks` (AC14, AC16)
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
- `...::resolveDurations with a non-empty override returns {work: 60, short_break: 15, long_break: 30}`
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
- `apps/api/tests/test_sessions.py::test_ended_at_in_future_422` (Behavior & rules)
- `apps/api/tests/test_sessions.py::test_rapid_duplicate_session_for_same_task_422` (Behavior & rules)

**Approach:**
- `apps/api/app/tasks/router.py`: add `POST
  /tasks/{task_id}/sessions`, ownership check and the full set of
  duration/timestamp validations per Design (LLD) § Behavior & rules.

**Done when:** the seven tests above are green.

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
  zero-fill, rounding to one decimal, expressed via SQLAlchemy
  constructs (Behavior & rules — no raw SQL string formatting), per
  `contracts/openapi/focusflow-api.yaml`.

**Done when:** the eight tests above are green against seeded fixture
sessions.

### T9: NextAuth wiring + shared authenticated layout

**Depends on:** T1, T4

**Tests:** no stub (manual QA — auth flow behavior is proven by the E2E
journey in T14, not a unit test of NextAuth internals). AC2, AC11
(secret half), AC12, AC18 (session config half).

**Approach:**
- Framework-currency note resolved by reading the installed packages'
  own type definitions and Next.js's bundled docs (`node_modules/next/dist/docs`,
  `node_modules/@auth/core/*.d.ts`) rather than trained-in knowledge:
  (1) NextAuth v5 (`next-auth@beta`, `5.0.0-beta.32`) infers its secret
  from `AUTH_SECRET` (primary) or the legacy `NEXTAUTH_SECRET` alias —
  `.env.example` and `check-secrets.mjs` use `AUTH_SECRET`; (2)
  self-hosted behind our own Nginx isn't an auto-trusted platform, so
  `trustHost: true` is set explicitly in `NextAuth({...})`; (3) Next.js
  16 confirmed the route-interception file is `proxy.ts` (`middleware.ts`
  is deprecated), exporting a default function plus an optional
  `config.matcher`.
- `apps/web/lib/api-client.ts`: typed `fetch` wrapper (attaches
  `X-Internal-Secret` / `X-User-Id`, normalizes errors); never logs or
  includes in a thrown error the raw request body of any call that
  carries a password, nor the request headers (which carry
  `INTERNAL_API_SECRET`) — AC11, secret half.
- `apps/web/lib/auth.ts`: NextAuth v5 config, Credentials provider whose
  `authorize()` calls `POST /auth/verify` via the API client; error path
  never logs or rethrows the raw password it received; JWT session
  strategy with `maxAge` set to 7 days (Design decisions, AC18).
- `apps/web/proxy.ts`: redirect unauthenticated requests to `/tasks`,
  `/analytics` toward `/login` (AC12).
- `apps/web/app/(app)/layout.tsx`: shared authenticated shell — nav
  ("Tasks" / "Analytics" links) plus `LogoutButton` (calls `signOut()`,
  AC18).

**Done when:** `npm run build` typechecks clean; a manually-driven login
against the T4 seeded test user establishes a session, confirmed via
`GET /api/auth/session` returning the user — **not** "reaches `/tasks`,"
since no page exists under `app/(app)/` until T11 (round-5 fix: the
previous Done-when here was unverifiable at this point in the task
order) (AC2); a manual unauthenticated request to `/tasks` redirects to
`/login` — this only needs the route-interception match, not a page, so
it's genuinely testable now (AC12); `grep -q "60 \* 60 \* 24 \* 7"
apps/web/lib/auth.ts` (or the equivalent literal seconds, `604800`)
confirms the configured 7-day session lifetime (AC18, config half — the
"Log out" button's *interaction* is verified in T11, once a page exists
for the shared layout to wrap); a goal-based grep of `api-client.ts` and
`auth.ts` for any `console.*`/thrown-error/template-string that
interpolates `password` or a request-header value finds none (AC11).

### T10: Sign-up / login screens

**Depends on:** T9

**Tests:** manual QA plus one goal-based check. AC1, AC2, AC11 (web
half), AC13, AC15 (root-route half).
- Goal-based: `! grep -rnE 'console\.[a-z]+\([^)]*password|\$\{[^}]*password' "apps/web/app/(auth)" apps/web/components apps/web/lib`
  (no match — round-5 fix: widened from just `app/(auth)` to also cover
  `components/` and `lib/`, since `SignUpForm`/`LoginForm` live in
  `components/` per the decomposition and the password actually passes
  through `lib/api-client.ts` and `lib/auth.ts`) — the concrete AC11
  web-half check.
- **AC16 does not apply to this task** (EXECUTE-time correction): T10's
  `actions.ts` files (`app/(auth)/signup`, `app/(auth)/login`) are
  pre-auth — there is no session yet to check, since these actions are
  what *establish* one. AC16 governs Server Actions that read or mutate
  an *existing* user's data; signup/login create or authenticate an
  account, which isn't that. The round-5 fix's `grep -rL 'await auth()'
  apps/web/app --include='actions.ts'` check was too broad — run
  repo-wide it would incorrectly fail on these two files. T11 introduces
  the corrected, properly-scoped version of this check
  (`apps/web/app/(app)/**/actions.ts` only, where AC16 actually
  applies) once a real user-data-touching action exists to check.

**Approach:**
- `apps/web/app/(auth)/signup/page.tsx` + `SignUpForm` component,
  `apps/web/app/(auth)/signup/actions.ts`, Server Action calling `POST
  /auth/register`, then signs in.
- `apps/web/app/(auth)/login/page.tsx` + `LoginForm`, calling NextAuth's
  `signIn("credentials", ...)`.
- `apps/web/app/page.tsx`: root route redirects an unauthenticated
  visitor to `/signup`, an authenticated visitor to `/tasks` (Design
  (LLD) § State & control flow — Root route).
- Each screen has exactly one primary, verb-labelled action ("Sign up",
  "Log in") — AC13.

**Done when:** both goal-based checks pass; manually driving sign-up
with a fresh email establishes a session (confirmed via `GET
/api/auth/session`, not by reaching `/tasks` — same round-5 fix as T9,
since `/tasks` doesn't render until T11) (AC1); driving login with a
wrong password shows an inline error and does not navigate away (AC2);
both screens each render exactly one primary action control (AC13); a
fresh unauthenticated visit to `/` reaches `/signup` (AC15, root-route
half — the rest of AC15 is T15's clean-clone pass).

### T11: Task list + create-task UI

**Depends on:** T5, T9

**Tests:** manual QA plus one goal-based check. AC2 (interaction
completion), AC3, AC4, AC13, AC16, AC18 (logout interaction half).
- Goal-based: `test -z "$(grep -rL 'await auth()' 'apps/web/app/(app)' --include='actions.ts')"`
  (corrected scope, EXECUTE-time fix: T10's original version of this
  check ran repo-wide, which would have incorrectly failed on the
  pre-auth `app/(auth)/*/actions.ts` files — AC16 only governs Server
  Actions touching an *existing* user's data, which starts here, not at
  signup/login. `grep -L` alone exits 1 on "no non-matching files
  found," the pass case — inverted from a shell `&&`/exit-code check,
  so `test -z "$(...)"` makes empty output the pass condition regardless
  of grep's own exit code) — the concrete AC16 check that every
  `(app)`-scoped `actions.ts` file reads the session.

**Approach:**
- `apps/web/app/(app)/tasks/page.tsx` (Server Component), `TaskList`,
  `TaskForm` components, `apps/web/app/(app)/tasks/actions.ts` (Server
  Action convention, Component decomposition): reads `auth()` for the
  session, never accepts a user id parameter (AC16), calls `GET /tasks`
  / `POST /tasks` through the API client, `revalidatePath("/tasks")` on
  success.
- A nav `Link` to `/analytics` in the shared `(app)` layout (T9) so
  AC8's "without a manual page refresh" is actually exercisable from the
  running app rather than requiring the QA driver to type a URL.
- The screen's one primary action is "Add task" (AC13); each task row's
  "Start focus session" control is a per-row contextual action, not the
  screen's primary action (AC13).

**Done when:** the T9/T10 login sequence, replayed now that this page
exists, actually lands here and renders the task list (AC1, AC2 —
closing the loop T9/T10 deferred to this task); manually creating a
task shows it in the list without a full page reload (AC4); an empty
list shows the empty-state (AC3); the screen has exactly one primary,
verb-labelled action control ("Add task") plus per-row contextual
controls that don't count against that limit (AC13); the `Link` to
`/analytics` navigates client-side (visible in the browser's Network
panel as no full document request); the goal-based check above confirms
`apps/web/app/(app)/tasks/actions.ts` reads the session before any
API-client call (AC16); clicking "Log out" (rendered by the shared
`(app)` layout now that a page exists to render it) then requesting
`/tasks` again redirects to `/login` (AC18, interaction half — T9
verified only the `maxAge` config).

### T12: Pomodoro timer UI

**Depends on:** T6, T7, T11

**Tests:** manual QA plus one component test with fake timers. AC5, AC6, AC7, AC13.
- `apps/web/components/PomodoroTimer.test.tsx::runs work -> short break -> work automatically and calls the record-session action only after work intervals`
  (vitest fake timers; mocks the record-session Server Action; asserts
  the rendered interval-kind sequence over two full cycles and that the
  mock is called exactly once per completed work interval and zero
  times across break transitions — AC5, AC6, AC7)

**Approach:**
- `apps/web/app/(app)/tasks/page.tsx`: call
  `resolveDurations(process.env.POMODORO_TEST_SHORT_INTERVALS)` and pass
  the result to `<PomodoroTimer durationsSeconds={...} />` (Design
  decisions — the durations are resolved here, once `PomodoroTimer`
  exists to consume them).
- `apps/web/components/PomodoroTimer.tsx`: countdown UI driven by
  `pomodoro-cycle.ts`'s kind sequencing plus the `durationsSeconds` prop;
  on natural completion of a work interval, calls a Server Action
  (`auth()`-gated per AC16) that `POST`s to `/tasks/{task_id}/sessions`
  and `revalidatePath`s both `/tasks` and `/analytics`; on manual stop,
  discards without recording. Renders a per-task "Start focus session" /
  "Stop" control — contextual per AC13, not the screen's primary action.

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
- `apps/web/app/(app)/analytics/page.tsx`: fetches `GET
  /analytics/focus-time` (revalidated per Design decisions; Server
  Action reads `auth()` per AC16), renders the chart plus the per-task
  minutes list, or an empty-state when `by_task` is empty (AC9).
  Read-only screen — no primary action control (AC13).

**Done when:** starting from `/tasks` (with at least one recorded
session), clicking the `Link` to `/analytics` added in T11 (client-side
navigation, no full page load) shows a non-empty bar for today and the
task in the per-task list with the correct minutes, without a manual
page refresh (AC8); viewing it with zero recorded sessions shows the
empty-state (AC9); the screen renders no primary action control (AC13).

### T14: End-to-end Compose smoke

**Depends on:** T10, T12, T13

**Tests:** no stub (visual / manual QA — the spec's core E2E proof).
AC1, AC2, AC4, AC6, AC8, AC10, AC11 (running-artifact half), AC12, AC15
(root-route half), AC17, AC21 (functional half — see Design decisions'
AC21-verification note).

**Approach:**
- From a clean volume (`docker compose down -v` if a prior volume
  exists), `docker compose up -d --build`; confirm `curl -f
  http://localhost/healthz` is 200 and the tables exist (T1's Done-when
  check, re-run here against the fresh state); manually drive: visit
  `/` and confirm it reaches `/signup` (AC15, root-route half) → sign up
  → land on `/tasks` → create a task **through Nginx (`http://localhost`,
  never `web`'s dev port directly)** → start a Pomodoro run (with
  `POMODORO_TEST_SHORT_INTERVALS` set in `.env`, per spec Boundaries, so
  the pass doesn't require a real 25-minute wait) → let one work
  interval complete → click through to `/analytics` → confirm the chart
  and per-task list reflect it; the task-creation Server Action
  succeeding through Nginx *is* AC21's functional proof — it fails
  immediately if the forwarded-header config is wrong (Design
  decisions); separately, confirm an unauthenticated request to
  `/tasks` redirects to `/login` (AC12); the AC21 wildcard-origins/
  trustHost check — **canonically the `.github/workflows/ci.yml`
  `verify-invariants` job (round-7 REVIEW correction: this line and
  that job used to carry the same command in two places, which is how
  it drifted out of sync across rounds 2 and 3 below; codified into CI
  in round 6, so this step now just re-runs that job's command rather
  than maintaining a second copy)** — confirms no wildcard workaround
  was added (AC21). History: **round-2 REVIEW finding**: the original
  version scanned only `lib/auth.ts` for `allowedOrigins`, where that
  Next.js Server Actions setting (`experimental.serverActions.allowedOrigins`
  in `next.config.ts`) can never appear, making the check vacuously
  pass regardless of whether a wildcard was ever added; **round-3
  correction**: the round-2 fix still didn't match `trustHost`,
  spec.md's other named field, leaving a `trustHost: "*"` workaround
  undetected — now checked as an alternation; capture `docker compose
  logs web api` and grep it for the test password and both secrets as
  the running-artifact half of AC11; run a scripted burst of requests at
  `/login` and confirm a 429 appears once the configured threshold is
  crossed (AC17, confirming T1's isolated check also holds once the
  whole app is wired together).
- Record the observed output (curl status, screenshots or terminal
  transcript of each step) in the PR description per work-loop's
  Finish checklist.

**Done when:** the journey above completes against the real containers
with no component mocked, the task-creation Server Action succeeds when
driven through Nginx, the wildcard-origins grep confirms no workaround
was added, the log grep finds no password or secret, the rate-limit
burst produces a 429, and the observed output is recorded.

### T15: Self-host guide + changelog entry

**Depends on:** T14

**Tests:** manual QA. AC15, AC20.
- Manual: from a *separate* clean clone (or `git clean -xdf` on a
  scratch copy), follow only `docs/guides/how-to/self-host-with-docker-compose.md`
  verbatim, with no undocumented steps, and confirm the sign-up screen
  loads.

**Approach:**
- `docs/guides/how-to/self-host-with-docker-compose.md` (Diátaxis
  how-to): clone → `cp .env.example .env` → generate secrets
  (`openssl rand -hex 32` for `INTERNAL_API_SECRET`, the NextAuth
  secret, **and `POSTGRES_PASSWORD`** — all three ship empty per AC19)
  → `docker compose up -d --build` → open `http://localhost`; an
  explicit, unmissable note that the stack terminates plaintext HTTP on
  port 80 and that a TLS-terminating proxy is required before exposing
  it beyond `localhost` (AC20); a second note that the built-in Nginx
  rate limits (AC17) key on the connecting IP, so placing another proxy
  in front makes them effectively global across all visitors unless the
  operator configures `real_ip_header`/`set_real_ip_from` in
  `apps/nginx/nginx.conf` for their own proxy's address (Design
  decisions' rate-limit caveat).
- `docs/product/changelog.md`: add a `## [0.1.0] - <ship date>` entry
  (Keep a Changelog format) summarizing the user-visible surface this
  spec ships, with "walking-skeleton" named in the entry body.

**Done when:** the clean-clone manual check above passes and the TLS
note is present in the guide (AC15, AC20); the changelog entry exists
and is dated the same day as the PR.

### T16: CI pipeline — secret scan, SCA, container scan

**Depends on:** T1

**Tests:** no stub (goal-based — structural validation only, see
Design decisions on why this environment can't verify a passing run).
- Goal-based: the workflow YAML parses; it declares `on: push` and
  `on: pull_request` (AC22 requires "every push/PR" — a
  `workflow_dispatch`-only trigger would pass a weaker check); and greps
  for the three expected step markers (a secret-scan action, `npm
  audit`/`pip-audit` invocations, a container-scan action) each find at
  least one match.

**Approach:**
- `.github/workflows/ci.yml`: triggers on `push` and `pull_request`; a
  job (or jobs) running a secret scanner (e.g. `gitleaks`/`trufflehog`
  action) over the diff, `npm audit --audit-level=high` for `apps/web`,
  `pip-audit` for `apps/api`, and a container-image scan (e.g. `trivy`)
  over the built `api`/`web`/`nginx` images.

**Done when:** the goal-based structural check (including the trigger
assertion) passes; the workflow file is committed and would run on the
next push/PR (execution itself is not verified in this environment —
noted honestly per Design decisions, not claimed as tested).

## Rollout

- **Delivery:** big bang — this is the first spec in the repo; there is
  no prior version to roll out gradually against. Rollback is `docker
  compose down` plus discarding the branch; no data migration to reverse
  (first migration, no prod data yet).
- **Infrastructure:** none beyond what T1 stands up — four Docker Compose
  services, no external cloud infra (self-hosted per ADR-0001).
  Deployment sequencing note: `db` must be healthy before `api` runs
  migrations (Compose `depends_on: condition: service_healthy` on `db`,
  plus `api`'s own entrypoint running `alembic upgrade head` before
  `uvicorn` starts), and `api` must be reachable before `web`'s
  `/healthz` can succeed — T1's Compose file encodes both.
- **External-system integration:** none.
- **Deployment sequencing:** within a single `docker compose up`, no
  further sequencing beyond the health-check/migration ordering above.

## Risks

- **Auth handshake (NextAuth ↔ FastAPI) is the one genuinely new pattern
  in this codebase** — get T4 and T9 both green with their own tests
  before building any screen on top of them (Approach already sequences
  this).
- **Alembic + Docker Compose first-run ordering** can flake if `api`
  starts before `db` is truly ready to accept connections, not just
  "container started." Mitigated by a Compose healthcheck on `db` (T1)
  plus the entrypoint's own `alembic upgrade head` step (idempotent, so a
  slow-starting `db` just delays rather than corrupts).
- **Manual QA tasks (T9-T15) carry no automated regression protection.**
  Acceptable for a first walking skeleton at "a few weeks" appetite; if a
  regression here becomes costly, a follow-up spec should add Playwright
  E2E coverage — noted, not built now, to keep this spec's scope bounded.
- **NextAuth v5, its reverse-proxy configuration, and the App Router's
  route-interception file name may all have moved since training data
  was current.** Mitigated by the framework-currency note in Approach
  and T9's Approach — verify against live docs before implementing.
- **The security-hardening additions (T1, T4, T9, T16) meaningfully grew
  this spec's scope beyond a minimal walking skeleton.** Accepted
  deliberately (spec Assumptions) because this is the first exposure of
  a real auth system to the open internet; if the added surface turns
  out to meaningfully threaten the "a few weeks" appetite during
  EXECUTE, that's a signal to re-plan, not to silently drop a hardening
  AC.

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
  presence-only gate. Extracted interval-duration resolution into a new
  testable pure unit, `apps/web/lib/pomodoro-durations.ts`
  (`resolveDurations`), added to T6. Added a root-route redirect (`/` →
  `/signup` or `/tasks`) so AC15's "reaches the sign-up screen" has a
  defined target — T10. Corrected a false claim that `create-next-app`
  wires up `vitest`; added it, plus `@testing-library/react` and a DOM
  test environment, to T1 explicitly and to the spec's pre-approved
  dev-dependency list. Widened AC11's web-half grep to `api-client.ts`
  and `auth.ts` (T9/T10), added AC13 to T13's Tests/Done-when, extended
  AC13's contextual-action carve-out to cover the timer's "Stop"
  control, moved `durationsSeconds` resolution from T11 (before its
  consumer existed) to T12, added a nav `Link` from `/tasks` to
  `/analytics` (T11), corrected T14's `Tests:` line, and moved the
  `POMODORO_TEST_SHORT_INTERVALS` bundle-leak check to T12.
- 2026-08-14: revised after spec-mode adversarial review round 4 (5
  Blockers, 6 Concerns, 4 Nits) and a spec-stage security review (6
  Blockers, 6 Concerns, 4 Nits) run in parallel, both converging
  independently on the same critical finding — folded in wholesale per
  explicit user direction rather than deferred to a follow-up spec.
  Major changes: (1) a custom FastAPI `RequestValidationError` handler
  so a 422 never echoes a submitted password (both reviews caught this
  independently — the framework default does); (2) migrations now run
  from the `api` container's own entrypoint, closing a gap where a clean
  `docker compose up` produced a stack with no schema; (3) `.env`,
  `node_modules/`, and `.next/` added to `.gitignore`, and
  `.env.example` now ships every secret empty with a fail-closed startup
  check on both apps (previously a non-empty placeholder with no
  enforcement); (4) the seed script no longer has a hardcoded-credential
  fallback; (5) the api Docker image now actually installs its test
  dependencies, and the canonical test command is `docker compose exec
  api pytest` (`db` has no host port, so a bare host-run `pytest` never
  worked — `AGENTS.md` corrected in the same pass); (6) the QA-override
  duration map is now pinned to a concrete value so T6's stub is
  writable; (7) added AC16 (session/authorization provenance — `X-User-Id`
  must come only from the validated session, and route interception is
  UX only, not the authorization boundary), AC17 (Nginx rate limiting on
  auth-adjacent paths), AC18 (bounded session lifetime + logout), AC19
  (fail-closed secrets), AC20 (TLS warning in the self-host guide), AC21
  (Nginx forwarded headers + no wildcard CORS), and AC22 (a CI scanning
  pipeline — new T16); (8) added a timing-attack mitigation to
  `/auth/verify` and session-timestamp/replay validation to T7; (9)
  introduced a shared `(app)` route group with a nav + logout layout
  (T9), consolidating what was a scattered `/tasks`/`/analytics` set of
  standalone pages; (10) fixed several remaining round-3 loose ends:
  `env_file` wiring for the presence-only gate to actually reach a
  container, `/tasks`'s dynamic-rendering requirement, T9/T10 Done-whens
  that asserted against routes not yet built, a vague AC11 grep with no
  runnable command, and a contract gap (`/auth/verify` had no 422,
  password had no `maxLength`).
- 2026-08-14: revised after a confirmatory review of the round-4/
  security-hardening rewrite (5 Blockers, 8 Concerns, 3 Nits) — the
  hardening pass itself introduced new inconsistencies, mostly around
  task ordering and verification-artifact ownership rather than design
  flaws. Fixed: AC13 now explicitly excludes the shared layout's nav/
  logout chrome, since AC18 requires that chrome on every authenticated
  screen and AC13 would otherwise be unsatisfiable; T9's and T10's
  Done-whens no longer claim to reach `/tasks` (that page doesn't exist
  until T11 in task order — they now check session establishment via
  NextAuth's own session endpoint instead), with the deferred
  verification (rendering, and the "Log out" *interaction* specifically)
  moved to T11; AC16's grep command was inverted (`grep -L` alone exits
  1 on the pass case) — rewritten as a `test -z "$(...)"` form, and a
  `actions.ts` file convention was named explicitly (Component
  decomposition) so the check has a defined scope; AC21 now has an
  honest two-part verification (T1: structural grep of `nginx.conf`; T14:
  functional proof via a Server Action that only works with correct
  forwarded headers, plus a wildcard-origins absence grep) instead of a
  `curl` command that couldn't actually see upstream-forwarded headers;
  AC18's `maxAge` now has a concrete grep check in T9; AC19 dropped the
  undefined "still-equal-to-a-placeholder" branch now that secrets ship
  empty rather than as placeholders, and gained `POSTGRES_PASSWORD` to
  its enumeration; AC17 now states its own thresholds and path list
  (including `/api/auth/*`, the actual NextAuth credential-check route)
  as canonical, matching AC5's precedent, instead of pointing at
  plan.md; AC1 states the 128-char password ceiling and T4 gained a test
  for it; the AC11 web-half grep widened to `apps/web/components` and
  `apps/web/lib` (the password actually passes through
  `SignUpForm`/`LoginForm` and `api-client.ts`/`auth.ts`, not just
  `app/(auth)`); T16's structural check now also asserts the workflow
  triggers on `push`/`pull_request`; `docs/architecture/reference.md`'s
  Configuration & environments bullet and `AGENTS.md`'s `pytest`/`ruff`/
  seed commands were corrected to match the container-only test/lint
  invocation and the new seed script's required env vars (all in this
  same revision); and a rate-limit-behind-a-front-proxy caveat was added
  to T15's guide, since `limit_req_zone`'s per-IP key becomes a global
  limit once AC20's recommended TLS proxy sits in front. This is the
  fifth review pass on this spec (four adversarial rounds plus one
  security review); remaining risk from here is expected to surface
  through GATES during EXECUTE (a broken shell command fails loudly)
  rather than through further prose review.
- 2026-08-17: EXECUTE-time fix (T7/T10/T11, wave 5) — this is exactly
  the "surface through GATES, not more prose review" case the previous
  entry predicted. T10's AC16 goal-based check (`grep -rL 'await
  auth()' apps/web/app --include='actions.ts'`, repo-wide) would have
  incorrectly failed on `app/(auth)/signup/actions.ts` and
  `app/(auth)/login/actions.ts` — those are pre-auth flows with no
  session yet to check; AC16 governs Server Actions touching an
  *existing* user's data. Moved ownership of the check to T11, scoped
  to `apps/web/app/(app)/**/actions.ts` only, where it's actually
  meaningful (spec.md's Testing Strategy updated to match). Framework
  notes from implementing T9-T11 against the real installed packages:
  NextAuth v5's redirect `Location` header uses the container's own
  hostname when driven through the raw `/api/auth/callback/credentials`
  endpoint directly (as T9's curl-based verification did), but resolves
  correctly to the public host when driven through the actual React
  Server Action form-submission path a real signup/login uses (as
  T10/T11's verification confirmed) — the T9 anomaly was an artifact of
  bypassing the real code path, not a live bug.
- 2026-08-17: revised after implementation-mode adversarial review round
  1 (5 Blockers, 8 Concerns, 6 Nits), run once all 16 tasks were built
  and verified against the live Compose stack. Fixed a real bug —
  `PomodoroTimer` counted `setInterval` ticks instead of tracking an
  absolute deadline, so a throttled background tab would silently
  under-run a work interval while still recording it as a full 25
  minutes. Also: `getTasks()`/`getFocusTime()` no longer collapse a
  failed fetch into an empty result (both render an explicit error
  state now); `signUpAction`/`createTaskAction` re-validate
  password/title server-side; `by_task` in `GET /analytics/focus-time`
  is no longer windowed by `days` (see Behavior & rules); the logout
  action moved out of an inline component prop into
  `app/(app)/actions.ts` so AC16's grep check stays exhaustive; two
  `scalar_one_or_none()` calls on non-unique-safe queries were fixed to
  avoid a 500 under concurrent requests; CI's container scan now builds
  `apps/api` with `--target dev`, matching what `docker-compose.yml`
  deploys; added indexes on `tasks.user_id` and
  `pomodoro_sessions.task_id` (see Data & schema); recorded the
  `pydantic[email]` dependency addition (see Dependencies &
  integration). `docs/specs/walking-skeleton/qa-log.md` now carries a
  persisted transcript of a clean-volume T14 run and the T15
  clean-clone check.
- 2026-08-17: revised after implementation-mode adversarial review round
  2 (3 Blockers, 5 Concerns, 9 Nits) — findings against the round-1 fix
  commit itself. The most notable: AC21's wildcard-`allowedOrigins`
  check scanned `apps/web/lib/auth.ts`, where that Next.js Server
  Actions setting can never appear (it's a `next.config.ts` option) —
  the check was vacuous, always passing regardless of outcome. Fixed to
  scan `next.config.ts` too (see the T14 Approach entry above).
  `recordSessionAction` gained the same server-side re-validation
  `signUpAction`/`createTaskAction` got in round 1 (taskId shape,
  parseable timestamps, duration bound) — it's the one mutating action
  round 1 missed. `logoutAction`'s `await auth()` call was vestigial
  (discarded the result) — now branches on it for real. `by_task`'s
  all-time scope is now stated in the OpenAPI contract, not just a code
  comment. `qa-log.md` gained sections covering the round-1-introduced
  error states (previously untested) and AC13's primary-action-count
  observation per screen.
- 2026-08-17: revised after implementation-mode adversarial review round
  3 (2 Blockers, 4 Concerns, 4 Nits) — findings against the round-2 fix
  commit. `recordSessionAction`'s round-2 re-validation had no test/QA
  drive, and the vitest fixture's `taskId="task-1"` would itself have
  failed the new UUID check were the action not mocked — fixture
  changed to a real UUID shape, reject paths driven live (see T14
  Approach and `qa-log.md`). `spec.md`'s Testing Strategy amended to
  name curl-replicated Server Actions as the actual verification
  mechanism (no browser available in this environment) rather than
  implying a browser drive always happens. The AC21 wildcard check
  still missed `trustHost` (spec.md's other named field) — widened to
  an alternation. This file's own `env_file: .env` references (three of
  them) were stale after round 2 switched both services to explicit
  `environment:` lists — corrected. The AC5 duplicate-constant
  enumeration above named the wrong file (`pomodoro-cycle.ts` instead
  of `pomodoro-durations.ts`) and missed the third copy round 2 added
  to `tasks/actions.ts` — both fixed.
- 2026-08-17: revised after implementation-mode adversarial review round
  4 (2 Blockers, 1 Concern, 0 Nits carried forward — see below) —
  findings against the round-3 fix commit. The round-3
  `safeErrorMessage()` fix shipped with a real classification bug: it
  inferred "safe to show" from whether `apiFetch`'s result carried an
  HTTP `status`, which wrongly treated `"server misconfigured"` (no
  status, since the failure happens before any request is sent) as
  safe — the exact string the fix was meant to hide. Replaced the
  inference with an explicit `safe: boolean` on `ApiResult`'s failure
  branch, set correctly at each of `apiFetch`'s three failure returns;
  threaded the same flag through `CreateTaskFormState` and
  `RecordSessionResult` so `TaskForm` and `PomodoroTimer` — the two
  mutating-action render sites `safeErrorMessage` hadn't reached yet —
  now apply the same suppression `/tasks` and `/analytics` do. Added
  `apps/web/lib/api-client.test.ts`, since the whole `safe`/unsafe
  split had shipped with zero test coverage twice in a row.
  Self-caught during live verification (blanking `API_BASE_URL` and
  confirming `"server misconfigured"` no longer surfaces): `signUpAction`
  had the identical unconditional-echo bug and wasn't named by the
  round-4 finding — fixed the same way. That same live check also
  surfaced a subtler leak the render-time filter couldn't close:
  `useActionState` serializes whatever a bound action returns into the
  page's hydration payload (visible in page source, in the hidden
  `$ACTION_N:1` previous-state field) so it can pass it back in on the
  next submission — meaning `createTaskAction` and `signUpAction`'s raw
  unsafe string was reaching the client regardless of what `TaskForm`/
  `SignUpForm` chose to render. Moved the `safeErrorMessage()` call
  inside both actions instead, so only the already-filtered string is
  ever part of the returned state; `RecordSessionResult`
  (`recordSessionAction`, invoked directly rather than via
  `useActionState`) keeps the render-time filter, since a directly
  invoked action's result crosses the network exactly once, in that
  request's own response, not embedded in subsequent page loads.
- 2026-08-17: revised after implementation-mode adversarial review round
  5 (0 Blockers, 3 Concerns) — findings against the round-4 fix commit.
  The "render-time filter is fine for the directly invoked action"
  reasoning from round 4 was half right: it correctly meant the raw
  string never persists into a later page's source, but it's still
  visible in that one failed request's own Network-tab response body —
  a real, if narrower, exposure than the `useActionState` case, and one
  the same commit's own principle ("an unsafe raw string must never be
  part of the returned state at all") already ruled out. Moved
  `safeErrorMessage()` inside `recordSessionAction` too, for
  consistency with `createTaskAction`/`signUpAction`; `RecordSessionResult`
  dropped its `safe` field (filtering happens before return, same as
  the other two actions) and `PomodoroTimer.tsx` simplified back to
  rendering `result.error` directly — `PomodoroTimer.test.tsx`'s
  existing mock (`{ok:false, error:"duplicate session"}`, no `safe`
  field) needed no change, since that's exactly the shape
  `recordSessionAction` returns now. Also fixed the identical
  UTC-midnight flake pattern one test below the round-4 fix
  (`test_by_day_buckets_in_utc`, same root cause: bucket lookups keyed
  on `now`'s date instead of the actually-recorded `started_at`'s
  date).
- 2026-08-18: adversarial-reviewer converged to Clean after round 6 (0
  Blockers, 0 Concerns, 0 Nits against the round-5 fix commit). Full
  mode's mandatory specialist reviewers then ran for the first time
  against the whole implementation (not a prior round's fix diff):
  `quality-engineer` (testability/observability/reliability lens) and
  `security-reviewer` (threat-model lens), in parallel.

  **quality-engineer** (3 Blockers, 10 Concerns, 3 Nits) found the
  class of bug the whole `safeErrorMessage` saga had been fixing —
  swallowed/misclassified errors — was itself unlogged: every
  `apiFetch` failure and `check_db_connection`'s exception vanished
  with no line in `docker compose logs`, contradicting
  `reference.md`'s own Observability standard. Added `console.error`
  at `apiFetch`'s three failure sites, `/healthz`'s route handler, and
  a Python `logger.exception` in `check_db_connection`. Added an
  `AbortSignal.timeout` to `apiFetch` and the web `/healthz` route so a
  stalled `api` fails fast instead of hanging for `fetch`'s default
  timeout. `apiFetch` itself — the function whose classification broke
  three review rounds running — had zero test coverage (only the
  pure `safeErrorMessage` dispatcher was tested); added
  `apps/web/lib/api-client.test.ts` cases stubbing `global.fetch` for
  each failure branch. Made `safeErrorMessage`'s `safe` parameter
  required instead of optional — the optional form defaulted to
  *showing* the message when omitted, the same fail-open shape as the
  bug it exists to prevent. `apps/web/app/healthz/route.ts` was the one
  path that bypassed the whole `ApiResult`/`safe` mechanism entirely,
  returning `"API_BASE_URL unset"`/`"api unreachable"` directly to an
  unauthenticated public endpoint — fixed to return only `{"status":
  "error"}` with the cause logged server-side. Added a
  `validateSessionInput`-equivalent test suite
  (`apps/web/app/(app)/tasks/actions.test.ts`,
  `apps/web/app/(auth)/signup/actions.test.ts`) for the Server Action
  re-validation added across rounds 1/2/5, previously evidenced only by
  a dated manual curl transcript. `PomodoroTimer.test.tsx` now asserts
  the actual payload forwarded to `recordSessionAction` (taskId,
  duration, and that `ended - started == duration`), not just call
  counts. Fixed a real edge case in `PomodoroTimer.tsx`: the
  `startedAt ?? new Date()` fallback (unreachable in practice, since
  `startedAt`/`deadline` are always set together) would have built a
  payload `apps/api` is guaranteed to reject had it ever fired —
  replaced with a value derived from `deadline`, which also made the
  `startedAt` state variable itself dead and removable.
  `apps/api/tests/test_seed.py`'s password-generation test asserted
  `"password" in out.lower()`, which matches the log line's own label
  and would pass even if `_seed()` reverted to a hardcoded password
  (the exact CWE-798 regression it exists to catch) — rewrote to parse
  the actual generated token and verify it against the stored hash.
  Added `apps/api/tests/test_config.py`, an isolated unit test for
  `Settings.fail_closed_on_missing_secrets()` (AC19) and
  `apps/web/scripts/check-secrets.test.ts` for its web-side
  counterpart — the only prior evidence was a confounded whole-stack
  observation, since an empty `POSTGRES_PASSWORD` stops `db` before
  either app's own check runs. Added `require_user_id`'s missing
  malformed-header and unknown-user-id test cases. Codified the three
  goal-based invariant greps (AC11 web-half, AC16, AC21) as a new
  `verify-invariants` CI job — they previously existed only as commands
  in `plan.md`, run once by hand, with nothing to catch a regression.
  Fixed a redundant/vacuous assertion in `test_auth.py`'s
  no-password-leak test (asserted the *other* request's marker password
  was absent from a 422 body that never contained it). Deleted
  `apps/api/Dockerfile`'s `runtime` stage (documented in round 4 as an
  "eventual lean-production target," never built by anything) rather
  than keep it as dead code. Added `restart: unless-stopped` and a
  stdlib-only `healthcheck:` to `api`/`web` in `docker-compose.yml`,
  and made `nginx` wait on `web`'s health rather than a bare
  `depends_on` — a self-hosted deliverable (AC15) needs a component
  that crashes or a rebooted host to actually come back.

  **security-reviewer** (1 Blocker, 8 Concerns, 6 Nits) found a real
  vulnerability in the exact deployment topology AC20's guide
  recommends: Nginx unconditionally forwarded `X-Forwarded-Proto:
  $scheme`, and since this Nginx has no TLS listener `$scheme` is
  always `http` — so an outer TLS-terminating proxy's correct `https`
  value was overwritten before NextAuth ever saw it, and Auth.js (which
  keys `useSecureCookies` off the forwarded proto) issued session
  cookies without `Secure`. Verified live (probing `web:3000` directly
  with a forged `X-Forwarded-Proto: https` header showed the cookie
  gaining `Secure`/`__Host-`; the same request through Nginx did not).
  Fixed with a `map $http_x_forwarded_proto $forwarded_proto` block
  that trusts an incoming value rather than clobbering it, matching the
  topology the guide already assumes elsewhere (this Nginx becomes
  internal-only once an outer proxy is added, same premise as the
  existing `real_ip` rate-limit caveat); documented in the guide.
  Fixed cheaply: every app container ran as root (added a non-root
  `USER` to both Dockerfiles); no baseline response headers and
  `Server`/`X-Powered-By` version disclosure (`server_tokens off`,
  `add_header` for nosniff/frame-options/referrer-policy, Next's
  `poweredByHeader: false`); `.env` ships world-readable with no
  explanation of what each secret buys an attacker (`chmod 600` +
  explanation added to the guide); CI's `GITHUB_TOKEN` had no
  `permissions:` floor (added `contents: read` at the workflow level);
  the web Docker builder's `COPY . .` could bake a local `.env.local`
  into the image (`.dockerignore` fix); FastAPI's `/docs`/`/openapi.json`
  carried no `require_internal_secret` dependency, unlike every real
  route (disabled via `docs_url=None` etc.); the rate-limit-behind-a-proxy
  guide caveat didn't cover Docker Desktop's own NAT collapsing every
  client to one IP even with no extra proxy (documented alongside the
  existing caveat); logout cannot revoke an already-issued 7-day JWT
  (documented in the guide's TLS section, next to the warning that
  makes it matter).

  **Explicitly deferred** (real findings, but production-hardening
  scope beyond this walking skeleton's appetite — "a few weeks, not a
  quarter" — rather than gaps in the skeleton's own stated ACs):
  least-privileged Postgres role (the app connects as the DB superuser;
  `security-reviewer` Concern #4); pagination/quotas on `GET /tasks`
  and task creation (security-reviewer Concern #5); an `nginx`
  default-server catch-all block backing `trustHost: true`'s Host-header
  assumption (security-reviewer Concern #8 — the reviewer could not
  demonstrate this live and called it a stale-premise finding, not a
  live one); `AUTH_URL` pinned to the public origin, to stop internal
  container hostnames appearing in NextAuth redirect URLs
  (security-reviewer Nit #10 — narrow, and the reviewer confirmed the
  real Server-Action-driven login path doesn't hit it); structured
  per-user auth-event logging and bounded Docker log retention
  (security-reviewer Nit #15 — `apiFetch`'s new failure logging covers
  the client side; a real audit trail is a bigger feature). None of
  these block AC1-AC22; each would need its own follow-up spec.

  **Live rebuild surfaced one more real bug**, unrelated to either
  reviewer's findings: adding a non-root `USER` + a container
  `healthcheck:` to `apps/web` (a quality-engineer fix) made the
  container report unhealthy — Next.js's standalone `server.js` binds
  to `process.env.HOSTNAME`, which Docker sets to the container's short
  id, not an address, so the server accepted connections addressed to
  that specific container IP (reachable from other containers via the
  `web` service DNS name) but not `127.0.0.1`/`localhost` from inside
  the same container, which is what the new healthcheck used. Fixed
  with `ENV HOSTNAME=0.0.0.0` in `apps/web/Dockerfile`.
- 2026-08-18: revised after round 7 — the adversarial-reviewer (0
  Blockers, 0 Concerns, 0 Nits — Clean) plus fix-verification passes
  from both specialist reviewers on round 6's diff, run in parallel.

  All three reviewers independently converged on the same finding:
  **`verify-invariants`'s three checks failed open on a missing or
  renamed path** — `! grep` and `grep -L`/`grep -q` piping can't tell
  "no match" (the check's real pass condition) apart from "path doesn't
  exist" (grep's exit 2), so a route-group rename would have silently
  disarmed AC11/AC16/AC21's CI gate instead of failing it, demonstrated
  live by all three. Fixed by asserting each target path/corpus exists
  before grepping, and (AC16 specifically) by deriving the scanned file
  set from `"use server"` rather than a fixed `actions.ts` glob, so an
  inline directive elsewhere in `app/(app)/` can't go unchecked.

  **security-reviewer found the X-Forwarded-Proto fix itself had a
  bypass**: the `map` block's exact `https` match missed a comma-list
  value (`http, https`), which any proxy that *appends* to the header
  instead of replacing it produces — reopening the original Blocker
  with no signal to the operator. Verified live before and after: the
  comma-list form previously produced a non-`Secure` cookie; the fixed
  regex (matching the last, nearest-proxy element) now correctly
  produces `Secure`/`__Host-`. Also flagged that the non-root fix's
  recursive `chown -R appuser:appuser /app` handed the runtime user
  write access to its own code — a post-RCE attacker could persist a
  change across the new `restart: unless-stopped` policy. Removed the
  chown entirely from both Dockerfiles (COPY's default perms are
  already world-readable; the processes never write under `/app` at
  runtime) — which broke `ruff`/`pytest`'s cache directories, fixed by
  pointing both at `/tmp` (world-writable by default) via
  `pyproject.toml`'s `cache-dir`/`cache_dir` keys.

  **quality-engineer's re-review** confirmed all three of its original
  Blockers fixed correctly, and found: `apiFetch`'s success-path
  `response.json()` could still throw uncaught on a 2xx response with a
  non-JSON body (the one failure branch the round-6 fix didn't cover);
  the new Server Action tests exercised the validation-reject paths but
  never the `!session` auth-guard branch or that `userId` (not a
  client-supplied value) was what actually got forwarded to `apiFetch`;
  `PomodoroTimer.test.tsx`'s new payload assertion checked
  `ended - started == duration`, both derived from the same `deadline`
  in production, so it couldn't fail even with the bug it was meant to
  catch; 4xx responses (a wrong password, a duplicate signup) were
  logged at `error` level, indistinguishable from a real 5xx when
  scanning logs. All fixed. `check_db_connection`'s log-formatting nit
  (Python `logging` not routed through uvicorn's handler config) and
  the `runtime` Docker stage's permanent absence were left as noted,
  accepted follow-ups rather than fixed in this round.

  Also added: a `test-api`/`test-web` CI job pair (adversarial-reviewer
  finding — the test suites added across rounds 1-6 were framed as "a
  regression here fails a gate," but no CI job actually ran pytest,
  vitest, lint, or tsc); `start_period: 30s` on both healthchecks and a
  liveness-only (not deep-probing `api`) healthcheck for `web`, since
  the deep-probe version plus `nginx`'s new hard gate on `web`'s health
  meant a transient `api` outage took the entire front door down
  instead of degrading to `/healthz`'s real 503.

  Verified: api (ruff, 48 pytest) and web (lint, tsc, 44 vitest, build)
  all clean; full stack rebuilt from scratch — all four containers
  healthy, non-root confirmed without the removed chown, the
  comma-list X-Forwarded-Proto bypass closed, full signup→task→
  analytics journey and the AC17 rate-limit burst both still pass.
