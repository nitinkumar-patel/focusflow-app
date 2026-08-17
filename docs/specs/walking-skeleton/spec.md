# Spec: Walking skeleton

- **Status:** Implementing <!-- Draft | Approved | Implementing | Shipped | Archived -->
- **Owner:** project owner <!-- single-maintainer project; see docs/product/briefs/focusflow.md -->
- **Plan:** [`plan.md`](plan.md)
- **Constrained by:** ADR-0001
- **Brief:** docs/product/briefs/focusflow.md
- **Discovery:** none
- **Contract:** contracts/openapi/focusflow-api.yaml
- **Shape:** mixed

> **Spec contract:** this document defines what "done" means. The implementing
> PR must match this spec, or update it. Verification must be derivable from it.

## Objective

A person who wants to use the Pomodoro Technique to work on their tasks can
sign up for FocusFlow, log in, create a task, and run a full Pomodoro cycle
against it (cadence: see AC5). When a work interval finishes naturally,
FocusFlow records it as focus time against the task it ran on. Afterward the
person can see how that time adds up — a small bar chart of focus minutes per
day for the last 7 days, and a per-task breakdown — without leaving the app.
This is the walking skeleton: the thinnest slice that exercises every real
component in the stack (browser → Next.js → FastAPI → PostgreSQL, behind
Nginx, all Dockerized per [ADR-0001](../../adr/0001-tech-stack.md)) end to
end, not a mock of any of them, and that a stranger can stand up on their own
machine from nothing but the repo (AC15) — ADR-0001's whole premise. Because
this walking skeleton is also the first real exposure of an auth system to
the public internet (self-hosted, no platform-level protections to lean on),
it carries the baseline hardening a live login system needs — not just the
happy path (AC16-AC22). No aesthetic-direction document is grounded for this
repo yet (see Assumptions); AC13 stands in for a taste critique as this
spec's design-intent bar.

## Boundaries

### Always do

- Keep the browser talking only to Next.js. Every FastAPI call originates
  from a Next.js Server Action or Route Handler, per ADR-0001's network
  topology — never a client component `fetch`ing `apps/api` directly.
- Validate input at both boundaries the request crosses: Pydantic models at
  the FastAPI edge, and re-validate in the Next.js Server Action before
  calling FastAPI (defense in depth at the one boundary the browser can
  reach), per `docs/architecture/reference.md` § Security & data handling.
- Write an Alembic migration in the same change as any model change to
  `users`, `tasks`, or `pomodoro_sessions`.
- Honor a `POMODORO_TEST_SHORT_INTERVALS` environment override (read
  server-side and passed as props into the timer UI — never exposed as a
  `NEXT_PUBLIC_*` var, since the interval lengths are not meant to be
  visible/tunable from the browser) that shortens the AC5 interval
  lengths for manual QA. There is no separate non-production deployment
  tier in this spec — every deployment is the self-hosted stack — so the
  safety control is presence, not environment: `.env.example` ships the
  var unset, an operator must deliberately set it in their own `.env` to
  opt in, and it has no effect at all when absent or empty. See AC5 and
  the plan's Behavior & rules.
- Derive `X-User-Id` (the header `apps/web` forwards to `apps/api`)
  solely from the caller's validated NextAuth session, inside the Server
  Action or Route Handler that's about to call the API — never accept it
  as a parameter from client-supplied data. See AC16.
- Fail closed on an unset or empty secret (`INTERNAL_API_SECRET`, the
  NextAuth secret, `POSTGRES_PASSWORD`) — refuse to start rather than
  serve traffic with an absent secret. See AC19.

### Ask first

- Any change to the `/auth/*` contract shape (fields, status codes) in
  `contracts/openapi/focusflow-api.yaml` — auth is a security boundary.
- Introducing a UI charting dependency, or any new **product-facing /
  runtime** top-level dependency not already named in ADR-0001 or the
  plan. Dev/test-only dependencies the plan names (`pytest`, `httpx`,
  `pytest-asyncio`, `ruff`, `vitest`, `@testing-library/react`,
  `@testing-library/dom`, `@vitejs/plugin-react`, a DOM test environment
  for `vitest`) are pre-approved for this spec and don't require asking
  again. A CI-only dependency (a scanning action, a linter action) is
  also pre-approved — it never ships to users.
- Changing the default interval lengths or the long-break cadence stated
  in AC5, or the rate-limit thresholds stated in AC17.

### Never do

- Expose FastAPI or PostgreSQL on a host-published port. Only Nginx
  publishes a port, per ADR-0001 § Network topology — no exception for
  "just for local debugging."
- Add a new top-level repository directory (`apps/`, `packages/`, etc.
  stay as-is — this includes `.github/`, already named in
  `docs/architecture/overview.md`'s canonical layout, so a CI workflow
  file does not count as a new top-level directory) or a new deployable
  component beyond `web`, `api`, `nginx`, `db` without an RFC, per
  `AGENTS.md` § Check before acting.
- Log or return a password (plaintext or hashed) in any response — this
  includes a validation-error body, not just the "happy path" responses
  — error message, or log line, on either `apps/api` or `apps/web`. See
  AC11.
- Log or return `INTERNAL_API_SECRET`, the NextAuth secret, or any
  request header, in any response, error, or log line, on either
  `apps/api` or `apps/web`.
- Expose `INTERNAL_API_SECRET`, `POMODORO_TEST_SHORT_INTERVALS`, or any
  `NEXT_PUBLIC_*` alias of either, to the browser bundle.
- Ship a seed or test account with a fixed, hardcoded password. The seed
  script requires credentials via environment variables with no
  defaults, or generates and prints a random password once. See AC19's
  neighborhood in the plan's Behavior & rules.
- Configure a wildcard (`*`) allowed-origins list for Server Actions or
  NextAuth to work around a proxy header problem — fix the proxy headers
  instead. See AC21.
- Persist break intervals as sessions. Only a completed *work* interval is
  focus time; `contracts/openapi/focusflow-api.yaml`'s `PomodoroSession`
  has no `kind` field because it only ever represents "work" — see AC7.

## Testing Strategy

- **Pomodoro cycle state machine (work → short break → work → … → long
  break):** TDD (AC5). It's a compressible invariant — given the interval
  kind that just completed and how many work intervals have completed so
  far, the next interval's **kind** is a pure function of that pair
  (interval *lengths* are resolved separately, from a server-supplied
  durations map — see the next bullet). Table tests in
  `apps/web/lib/pomodoro-cycle.test.ts`.
- **Default and overridden interval lengths (25/5/15 minutes, and the
  `POMODORO_TEST_SHORT_INTERVALS` override):** TDD (AC5) — a pure
  `resolveDurations(overrideEnvValue)` helper, table-tested for the
  default map and the override map, in
  `apps/web/lib/pomodoro-durations.test.ts`.
- **Password hashing and verification (Argon2id):** TDD — pure
  input/output contract (hash a password, verify a password against a
  hash, wrong password fails, algorithm identifier and per-password salt
  are asserted directly so a future "faster hash" swap can't pass
  silently).
- **FastAPI account/task/session/analytics routes** (AC1, AC2, AC6, AC9,
  AC14, AC16, and the empty-list shape underlying AC3): TDD, exercised at
  the **integration** surface — `httpx.AsyncClient` against the real
  FastAPI app with a real (test) Postgres, asserting status codes and
  response shapes match `contracts/openapi/focusflow-api.yaml`.
  Internal-secret enforcement (a request missing, wrong, or with an
  empty `X-Internal-Secret` is rejected) is covered in the same test
  files.
- **No password on the FastAPI boundary, including validation-error
  bodies** (AC11, API half): goal-based — a check inside the auth
  integration test file that greps captured log output and every
  response body from register/verify/duplicate-email **and the
  short-password 422 case** for the raw password and the `$argon2` hash
  prefix, asserting neither appears.
- **No password on the Next.js boundary** (AC11, web half): goal-based —
  T10 asserts the sign-up/login Server Action's error-handling path never
  interpolates the raw password into a thrown error or a `console.*`
  call; T14 additionally greps a captured `docker compose logs web`
  transcript from the real E2E pass as a running-artifact check.
- **No secret (`INTERNAL_API_SECRET`, NextAuth secret) on either
  boundary:** goal-based — the same log/response grep, widened to the
  secret values, exercised in T9 and T14.
- **`/auth/verify` costs the same wall-clock work whether the email is
  known or not** (timing side-channel): goal-based — a test asserting
  `verify_password` (or an equivalent spy point) is invoked even when
  the email doesn't exist, not a flaky wall-clock timing measurement.
- **Task-list empty-state and task creation without reload** (AC3, AC4):
  visual / manual QA, exercised in T11.
- **Breaks are never recorded as sessions** (AC7): covered by T12's
  component test (fake timers, mocked record-session action) asserting
  zero calls across break transitions — not the FastAPI surface, since
  the API has no way to distinguish a break-derived request from a
  work-derived one; the rule is enforced entirely client-side by
  construction (AC7's implementation has no `kind` field to check).
- **Unauthenticated visitor redirected to `/login`, and every mutating
  Server Action independently verifies the session** (AC12, AC16):
  visual / manual QA for the redirect (T9/T14); a goal-based grep for
  the independent-verification rule, scoped to Server Actions that
  actually touch an existing user's data (T11/T12/T13 — signup/login's
  pre-auth actions in T10 are exempt, since they establish a session
  rather than consuming one).
- **Exactly one primary action control per screen** (AC13): visual /
  manual QA, exercised per-screen in T10, T11, and T13.
- **Rate limiting on `/signup`, `/login`, and `/healthz`** (AC17):
  goal-based — a scripted burst of requests against the running Nginx
  in T14 asserts a 429 appears once the configured threshold is
  exceeded.
- **Session lifetime and logout** (AC18): visual / manual QA — the
  "Log out" control ends the session (a subsequent request to `/tasks`
  redirects to `/login`); the configured `maxAge` is a goal-based check
  of the NextAuth config value, not a real multi-day wait.
- **Fail-closed on an unset/empty secret** (AC19): goal-based —
  starting the stack from a freshly copied, un-edited `.env.example`
  must fail to serve traffic (T1).
- **Nginx forwards the headers Server Actions and NextAuth need, and
  never wildcards allowed-origins** (AC21): goal-based — a curl through
  Nginx asserting the forwarded headers reach `web` (T1), plus a grep of
  the NextAuth config for a literal `*` in `allowedOrigins`/`trustHost`.
- **A CI workflow runs a secret scanner, SCA for both ecosystems, and a
  container scan** (AC22): goal-based — the workflow file exists,
  declares the three scanner steps, and is structurally valid (this
  environment has no GitHub Actions runner to execute it against, so
  "runs" is verified by structure, not execution — noted honestly, not
  claimed as tested).
- **Signup → login → create task → run one full work interval → see it
  in the chart, end to end through Docker Compose** (AC1, AC2, AC4, AC6,
  AC8, AC10 together): visual / manual QA, exercised as an **end-to-end
  (E2E)** journey against the real running stack (`docker compose up`,
  then drive the browser). This is the walking-skeleton's core proof and
  cannot be faked by a narrower test.
- **Clean-clone self-host via the guide, including the TLS warning**
  (AC15, AC20): visual / manual QA, exercised in T15 — a fresh clone,
  following only the documented steps.
- **Docker Compose brings up all four services (migrated) and Nginx
  health-checks green** (AC10): goal-based check — `docker compose up -d
  && curl -f http://localhost/healthz`, from a clean volume so the
  migration-on-startup mechanism is actually exercised, not assumed.

## Acceptance Criteria

- [x] AC1: Given no account, when a person submits a valid email and a
      password between 8 and 128 characters on the sign-up screen, they
      are registered and immediately logged in (no email verification
      step).
- [x] AC2: Given an existing account, when a person submits the correct
      email/password on the login screen, they reach the task list;
      given an incorrect password, they see an inline error and are not
      logged in.
- [x] AC3: Given a logged-in user with an empty task list, when the page
      loads, the user sees an empty-state message and a way to add a
      task.
- [x] AC4: Given a logged-in user, when they submit a non-empty task
      title, a new task appears in their task list without a page
      reload.
- [x] AC5: Given a task, when the user starts a Pomodoro run on it, a
      25-minute work-interval countdown begins; when that interval
      finishes naturally, a 5-minute short-break countdown begins
      automatically, and the cycle continues, inserting a 15-minute long
      break after every 4th completed work interval (and every 4th
      thereafter). These are the canonical interval lengths and cadence
      for this spec: the plan's constants and test fixtures derive from
      this criterion, which is the only place the numbers may be
      changed — other sections restating them for implementation
      purposes (a TypeScript constant, a test's expected value) are
      instances of this criterion, not competing definitions of it.
- [x] AC6: Given a work interval that finishes naturally, FocusFlow
      records exactly one completed session against that task (`POST
      /tasks/{task_id}/sessions`); given a work interval the user stops
      before it finishes, no session is recorded.
- [x] AC7: Given a break interval (short or long) finishing naturally or
      being stopped early, no session is ever recorded for it — sessions
      represent completed work intervals only.
- [x] AC8: Given a user with at least one recorded session, when they
      open the analytics view, they see a bar chart of focus minutes per
      day for the last 7 days and a list of total focus minutes per
      task, both reflecting sessions recorded in this browser session
      without a manual page refresh.
- [x] AC9: Given a logged-in user with no recorded sessions, when they
      open the analytics view, they see an empty-state message instead
      of an empty chart.
- [x] AC10: Given the full stack running via `docker compose up` from a
      clean volume, `GET /healthz` through Nginx returns 200, and the
      signup → task → session → analytics journey above completes
      against the real containers (no component mocked).
- [x] AC11: No password (plaintext or hashed) appears in any HTTP
      response body — including a validation-error (422) body — error
      message, or log line, on either `apps/api` or `apps/web`.
- [x] AC12: Given an unauthenticated visitor, when they request `/tasks`
      or `/analytics`, they are redirected to `/login`.
- [x] AC13: The sign-up, login, and tasks screens each render exactly one
      primary, verb-labelled action control for the screen's main
      purpose ("Sign up", "Log in", "Add task"). Any per-task control —
      "Start focus session" and, once a run is in progress, "Stop" — is
      a contextual action attached to that task's row, not the screen's
      primary action, regardless of how many tasks have a run in
      progress. The shared authenticated shell's nav links and "Log
      out" control (AC18) are layout chrome, not a screen's primary
      action, and don't count against this limit on either authenticated
      screen. The analytics screen has no primary action of its own —
      only the shared shell's chrome.
- [x] AC14: Given two distinct user accounts, a user's task list,
      recorded sessions, and analytics never include the other user's
      data.
- [x] AC15: Given a clean clone of the repository, following
      `docs/guides/how-to/self-host-with-docker-compose.md` verbatim
      (no undocumented steps) brings the stack up and reaches the
      sign-up screen.
- [x] AC16: The `X-User-Id` value `apps/api` receives is derived solely
      from the caller's validated NextAuth session — no Server Action or
      Route Handler accepts a user id as client-supplied input. Every
      Server Action or Route Handler that reads or mutates user data
      independently verifies that session and rejects before any side
      effect if it's missing or invalid; the route-interception redirect
      (AC12) is a UX convenience, not the authorization boundary.
- [x] AC17: Given repeated rapid requests to `/signup`, `/login`,
      `/api/auth/*` (NextAuth's own credential-check routes), or
      `/healthz` from the same client, Nginx returns 429 once the
      request rate exceeds 20 requests/minute (burst 5) for the first
      three, or 60 requests/minute (burst 10) for `/healthz`, rather
      than forwarding every request to `web`/`api`. These thresholds are
      this spec's canonical values, the same way AC5 is canonical for
      interval lengths.
- [x] AC18: A session has a bounded lifetime (see the plan for the exact
      value), and every authenticated screen offers a "Log out" control
      that ends the session immediately — a request to `/tasks` after
      logging out redirects to `/login`.
- [x] AC19: `.env.example` ships every secret variable
      (`INTERNAL_API_SECRET`, the NextAuth secret, `POSTGRES_PASSWORD`)
      empty, not a placeholder value. Given either app started with a
      required secret unset or empty, it refuses to start and serve
      traffic rather than running with a guessable or absent secret.
- [x] AC20: `docs/guides/how-to/self-host-with-docker-compose.md` states
      plainly that the stack terminates plaintext HTTP on port 80 and
      recommends a TLS-terminating proxy before exposing it beyond
      localhost.
- [x] AC21: Nginx forwards `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`,
      and `X-Forwarded-Host` to `web`, so Next.js's Server Action
      Origin/Host check and NextAuth's callback URLs work correctly
      behind the proxy; no component configures a wildcard
      allowed-origins list as a workaround.
- [x] AC22: A CI workflow exists that runs a secret scanner, a dependency
      vulnerability scan for both ecosystems (`npm audit` or equivalent,
      `pip-audit`), and a container image scan, on every push/PR.

## Assumptions

- Technical: stack is Next.js (App Router, TS) + FastAPI (Python 3.13) +
  PostgreSQL, all Dockerized behind Nginx as the only published port
  (source: `docs/adr/0001-tech-stack.md` § Decision / Network topology).
- Technical: auth is NextAuth v5 Credentials provider (JWT session
  strategy) on Next.js; FastAPI trusts only an internal shared secret plus
  a user id header from the Next.js BFF, never a NextAuth token (source:
  `docs/adr/0001-tech-stack.md` § Auth architecture). NextAuth v5 and the
  App Router's route-interception layer (`middleware.ts`, renamed
  `proxy.ts` as of Next.js 16) have both changed API shape recently, and
  NextAuth v5 behind a reverse proxy needs `trustHost`/forwarded-header
  configuration; T9's Approach requires confirming current
  names/signatures/config against live docs before implementing, rather
  than trusting possibly-stale training data (source: repo
  `contract-acquisition` gate).
- Technical: persistence is SQLAlchemy 2.0 async + Alembic migrations
  against Postgres, Argon2id password hashing (source:
  `docs/architecture/reference.md` § Solution strategy).
- Process: this spec runs `work-loop` full mode — risk triggers "new
  dependency," "structural or public-interface change," and "security
  boundary" (auth) all fire (source: `AGENTS.md` § How we work).
- Process: the `Owner:` field uses a generic placeholder, never a real
  name, per repo privacy rules (source: `AGENTS.md` § Privacy).
- Process: no `api-contract` skill is installed, so
  `contracts/openapi/focusflow-api.yaml` was hand-authored without
  standard-compatibility enforcement (source: `.claude/skills/` listing;
  see the contract file's own header note).
- Process: no experience-design pack (`creative-direction` /
  `design-review`) is installed, so design intent for this spec's UI
  surfaces (sign-up, login, task list, timer, analytics) is ungrounded —
  no aesthetic-direction document exists to check against. AC13 holds
  this spec to functional clarity instead of a taste critique against a
  named reference (source: `.claude/skills/` listing).
- Product: the Pomodoro run implements the full work/short-break/long-break
  auto-cycle described in AC5, not a single fixed interval (source: user
  confirmation 2026-08-13).
- Product: auth is plain email + password with immediate login; no email
  verification, no password-reset flow in this spec (source: user
  confirmation 2026-08-13). `POST /auth/register`'s 409-on-duplicate-email
  discloses that an email is already registered (account enumeration) —
  an accepted tradeoff for this spec's plain-auth scope, not rate-limited
  beyond AC17's general threshold; see the plan's Failure, edge cases &
  resilience.
- Product: the analytics view renders a bar chart (focus minutes per day,
  last 7 days) plus a per-task minutes breakdown, not a plain list only
  (source: user confirmation 2026-08-13).
- Product: this spec includes baseline security hardening (AC16-AC22 —
  session/authorization provenance, rate limiting, session lifecycle,
  fail-closed secrets, a TLS warning, forwarded-header correctness, and a
  CI scanning pipeline) rather than deferring it to a follow-up spec,
  because this is the first exposure of a real login system to the
  public internet with no platform-level protections to lean on (source:
  user confirmation 2026-08-14, after a security-reviewer pass found
  these gaps at spec stage). TLS termination itself, full session
  revocation infrastructure, and a hosted WAF remain out of scope — a
  self-hosted operator is expected to put their own TLS-terminating
  proxy in front per AC20 if exposing beyond localhost.
