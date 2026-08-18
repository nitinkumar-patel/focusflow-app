# Walking-skeleton QA log

Manual verification transcripts for tasks whose Tests mode is
visual/manual QA (plan.md). Each entry records what was driven against
the real Docker Compose stack and the observed result — per the
work-loop Finish checklist's "trust the running artifact" requirement
and round-1 REVIEW finding #2 (T14 had no persisted verification
artifact).

## T14: End-to-end Compose smoke test — 2026-08-17

Run against a clean volume (`docker compose down -v` then
`docker compose up -d --build`, `POMODORO_TEST_SHORT_INTERVALS=1` for
the duration of this pass, reverted to empty afterward). All requests to
the app went through Nginx (`http://localhost`), never a container's
internal port directly, except where noted.

- `GET /healthz` through Nginx: `200 {"status":"ok"}` immediately after
  a fresh `docker compose up -d --build` — confirms `alembic upgrade
  head` ran and the schema (including the round-1-added indexes)
  applied cleanly (T1's Done-when check, AC10).
- `GET /` unauthenticated: `307` → `/signup` (AC15, root-route half).
- `GET /tasks`, `GET /analytics` unauthenticated: both `307` → `/login`
  (AC12).
- Sign-up (`POST /signup`, replicating the real Server Action wire
  protocol — `$ACTION_1:0`/`$ACTION_KEY` extracted from the rendered
  HTML, genuine `multipart/form-data`): `303` → `/tasks`, session cookie
  set (AC1).
  - Also drove the round-1-fixed re-validation paths directly: a
    5-character password was rejected inline ("Password must be
    between 8 and 128 characters", `200`, no redirect) without ever
    reaching `POST /auth/register`.
- Task creation (`POST /tasks` through Nginx, same wire-protocol
  replication) with a real title: `200`, task persisted — this success
  *is* AC21's forwarded-header functional proof (Design decisions); it
  would fail immediately if `Host`/`X-Forwarded-*` weren't wired
  correctly. Also drove a whitespace-only title: rejected inline
  ("Task title must be between 1 and 200 characters", `200`, no
  redirect) — round-1 fix confirmed.
- Pomodoro session recorded via the real `recordSessionAction` Server
  Action (`Next-Action` header protocol, the exact code path the
  client-side timer invokes on work-interval completion, extracted
  action id `78a65ab88654cda8773a6af33c5750407ba935853f` from
  `.next/server/app/(app)/tasks/page/server-reference-manifest.json`):
  returned `{"ok":true}`; RSC payload confirmed
  `durationsSeconds:{"work":60,"short_break":15,"long_break":30}`, i.e.
  the QA override was active for this run only.
- `/analytics`: before any session, showed the empty-state message
  ("No focus time recorded yet...", AC9). After recording one session
  60s in the past via the real action above, the page showed the
  per-task list (`"... : 1 min"`) and the chart's last bar at full
  height, empty for all six prior days (AC8).
- **Round-1 fix confirmation — `by_task` is all-time, not windowed
  (Concern #6):** recorded a second session dated 30 days in the past
  directly against `apps/api` (bypassing the UI, since the Server
  Action itself doesn't allow backdating). `/analytics` showed the task
  in the per-task list ("QA Final Task: 25 min") while every `by_day`
  bucket stayed at 0 minutes (the session falls outside the 7-day
  window) — confirms the empty-state (AC9) no longer fires for a user
  who has sessions, just none in the last 7 days.
- **AC18 logout interaction** (previously undocumented — round-1
  REVIEW finding #2's other half): invoked the `logoutAction` Server
  Action (moved to `app/(app)/actions.ts` per round-1 Concern #9) via
  its `$ACTION_ID_...` form encoding. Response: `303` → `/login`,
  `Set-Cookie: authjs.session-token=; Max-Age=0`. A subsequent
  `GET /tasks` with the same cookie jar: `307` → `/login`, confirming
  the session was actually ended, not just the client-side redirect.
- **AC11 (web running-artifact half):** `docker compose logs web api`
  grepped for the plaintext test password, `INTERNAL_API_SECRET`,
  `AUTH_SECRET`, and `POSTGRES_PASSWORD` values — no match for any.
- **AC21 (wildcard-origins/trustHost absence):**
  `! grep -rn 'allowedOrigins\|trustHost' apps/web/next.config.ts
  apps/web/lib/auth.ts | grep -q '\*'` — passes (round-2 REVIEW fix: the
  original check scanned only `lib/auth.ts` for `allowedOrigins`, which
  can never appear there since it's a `next.config.ts` option, making
  the original check vacuous regardless of outcome; round-3 correction:
  the round-2 fix still didn't match `trustHost`, spec.md's other named
  field — `apps/web/lib/auth.ts` does set `trustHost: true`, which the
  now-widened pattern correctly matches and confirms is not a literal
  `*`).
- **AC17 (rate limiting, whole-stack):** burst of 10 rapid
  `GET /login` requests through Nginx — first 6 returned `200`
  (burst=5 + the base rate), requests 7-10 returned `429`.

Not exercised in this pass (documented scope, not a gap): TLS (the
guide's warning covers this — there is no TLS to test, by design, on
`localhost`); the actual browser countdown UI (covered instead by
`PomodoroTimer.test.tsx`'s fake-timer tests, since no browser was
available in this environment — see T12's commit for that discipline).

**Verification-methodology caveat (round-2 REVIEW finding; wording
corrected in round-3 — the entry originally misquoted AC4's clause as
matching AC8's instead of citing each criterion's actual text):** every
check above drove Server Actions via curl replicating the RSC wire
protocol, not a real browser. This proves the server-side behavior
(the request succeeds, the database changes, the next response reflects
it) but cannot distinguish a client-side re-render from a full document
reload — so AC4's "without a page reload" and AC8's "without a manual
page refresh" clauses are both verified indirectly (the response is an
RSC flight payload, per `revalidatePath`, not an HTML document) rather
than observed directly in a browser.

All test data from this section (the QA user, its task, and both
sessions) was deleted from the database after this pass;
`POMODORO_TEST_SHORT_INTERVALS` was reverted to empty in `.env`
(round-3 correction: this teardown note was previously misplaced under
the AC13 section below, several sections after the T14 pass it
actually describes).

## Round-1-introduced error states — 2026-08-17

Round-1's Blocker #4 fix made `/tasks` and `/analytics` render an
explicit error instead of a false empty-state on API failure; this had
no test or QA record until now (round-2 REVIEW finding #2).

- Signed up a fresh user, then `docker compose stop api`. `GET /tasks`
  and `GET /analytics` (through Nginx, same session cookie) both
  rendered `role="alert"` with the real `apiFetch` failure text
  ("couldn't reach the server, try again") instead of the old
  false-empty-state copy. `docker compose start api` restored the
  stack afterward.
- `PomodoroTimer`'s equivalent error path (round-1 Concern #7) is
  covered by a new vitest case
  (`PomodoroTimer.test.tsx`: "shows an inline error when
  recordSessionAction fails") rather than a live-stack drive, since
  forcing a natural work-interval completion to fail requires
  controlling the API response mid-flight — cleaner as a mocked
  component test than a race against a real container.

This section's QA user was deleted from the database afterward (round-3
correction: the deletion previously happened but was never logged here).

## recordSessionAction's server-side re-validation — 2026-08-17

Round-2 Concern #6 added shape/bound checks to `recordSessionAction`
(UUID-shaped `taskId`, parseable timestamps, `durationSeconds` bounded
to `1..1500`); round-3 REVIEW flagged that nothing drove the reject
paths, and that the vitest suite's `taskId="task-1"` fixture would
itself fail the new UUID check were the action not mocked out (fixed
separately — the fixture is now a real UUID shape).

Invoked `recordSessionAction` directly via the `Next-Action` header
protocol (the same mechanism a client-side `recordSessionAction(...)`
call compiles to — extracted id `78d47ce8ba236153ddf3c309c2261b32b2dde09632`
from the rebuilt `server-reference-manifest.json`), against a real
signed-up user with a real task:

- `taskId="not-a-uuid"` (otherwise-valid timestamps/duration): `200`,
  body `{"ok":false,"error":"Invalid session data."}`.
- `durationSeconds=2000` (exceeds `MAX_WORK_INTERVAL_SECONDS=1500`,
  otherwise-valid `taskId`/timestamps): `200`,
  `{"ok":false,"error":"Invalid session data."}`.
- Confirmed neither request reached `apps/api`: `pomodoro_sessions` had
  zero rows for this user afterward.

Test user, task, and any sessions deleted afterward.

## AC13 primary-action count per screen — 2026-08-17

Previously asserted only by construction (component structure) and
task-commit prose, never observed (round-2 REVIEW finding #3).

- `/signup` (unauthenticated): one `<button>`, "Sign up".
- `/login` (unauthenticated): one `<button>`, "Log in".
- `/tasks` (idle, zero tasks): "Log out" (layout chrome, excluded per
  plan.md) + "Add task" — one primary action.
- `/tasks` (idle, one task): adds "Start focus session" as a per-row
  contextual control — plan.md's AC13 restatement ("at most one primary
  action, contextual per-row actions don't count") holds; "Add task"
  remains the sole primary action.
- `/tasks` mid-run (per-row "Stop" replacing "Start focus session"):
  not observable via curl — this state only exists client-side after a
  JS click, with no corresponding server round-trip to inspect. Verified
  instead by `PomodoroTimer.test.tsx`, which asserts the "Stop" button
  renders while running and reverts to "Start focus session" on stop —
  same reasoning as the countdown-UI scope note above.
- `/analytics`: zero buttons besides "Log out" (layout chrome) —
  confirms the screen's read-only design (no primary action at all).

This section reused the error-states section's QA user (same session,
one task created for the button-count checks above) — already deleted
per that section's teardown note.

## T15: Self-host guide clean-clone check — 2026-08-17

`git clone` to a scratch directory, followed the guide verbatim with no
undocumented steps: `cp .env.example .env`, generated all three secrets
with `openssl rand -hex 32`, `docker compose up -d --build`.

First attempt failed: `COPY --from=builder /app/public ./public` in
`apps/web/Dockerfile` errored `"/app/public": not found` — `public/`
was an empty, git-untracked directory that only existed by coincidence
in the working tree, not in a fresh clone. Fixed by dropping the COPY
line (`favicon.ico` is served via the Next.js App Router's
`app/favicon.ico` convention, not `public/`, so nothing needed it) —
committed as `2b37dbf`.

Re-ran the clean clone after the fix: stack came up clean, `GET
/healthz` → `200`, `GET /` → `307` → `/signup`, and `/signup` rendered
`<h1>Sign up</h1>` — the guide's Done-when condition (AC15, AC20).
Torn down (`docker compose down -v`) and the scratch clone deleted
after the check.

## safeErrorMessage's safe/unsafe classification — 2026-08-17

Round-4 REVIEW found the round-3 `safeErrorMessage` fix inferred
safety from `apiFetch`'s `status` field, which misclassified
`"server misconfigured"` (no status, since it fails before any request
is sent) as safe to show — the exact string the fix existed to hide.
Fixed with an explicit `safe: boolean` set correctly at each of
`apiFetch`'s three failure returns.

Verified live: temporarily blanked `API_BASE_URL` in `.env`,
`docker compose up -d --build web` (the container still starts —
`scripts/check-secrets.mjs` only guards `INTERNAL_API_SECRET`/
`AUTH_SECRET`), then drove `POST /signup` with a valid email/password
through Nginx. Rendered error: "Something went wrong. Try again." —
not the raw `"server misconfigured"` string.

This surfaced a second, subtler issue beyond the round-4 finding's
scope: the raw string was still present in the response body (inside
`useActionState`'s serialized previous-state payload — both the hidden
`$ACTION_1:1` form field and the `self.__next_f` hydration script),
even though it was never rendered as visible text. Confirmed via
`grep -c 'server misconfigured' <response body>` before and after
moving the `safeErrorMessage()` call from render time (`TaskForm`/
`SignUpForm`) into the actions themselves (`createTaskAction`/
`signUpAction`) — 2 matches before the fix, 0 after, same signup drive
repeated against a fresh rebuild. `API_BASE_URL` restored afterward.

**Round-5 follow-up — `recordSessionAction`:** round-5 REVIEW pointed
out the same unfiltered-echo issue existed in `recordSessionAction`
(exposed in that request's own response body, not persisted via
`useActionState` since it isn't bound to it, but still visible in the
network response). Verified live: signed up, created a task, recorded
one real session (succeeds), then immediately recorded a second
session for the same task through the real `Next-Action` protocol —
triggers T7's rapid-duplicate-for-same-task guard (60s window).
Before the fix this would have returned apps/api's raw `detail`
("a session for this task was just recorded"); after moving
`safeErrorMessage()` inside `recordSessionAction`, the response was
`{"ok":false,"error":"Something went wrong. Try again."}` with no
trace of the raw detail string anywhere in the response body. Test
user, task, and session deleted afterward.

## Round 6 (quality-engineer + security-reviewer) — 2026-08-18

Both specialist reviewers ran for the first time against the whole
implementation (not a prior round's fix diff) once the adversarial-
reviewer converged to Clean. Findings and fixes are summarized in
plan.md's Changelog; this section records the live verification.

**Docker rebuild surfaced a real, unrelated bug**: adding a non-root
`USER` + a `healthcheck:` to `apps/web`'s container (a quality-engineer
fix) made the container report unhealthy even though the Next.js
server itself logged "Ready". Diagnosed live: Next.js's standalone
`server.js` binds to `process.env.HOSTNAME`, which Docker auto-sets to
the container's short id (not an address) — so the server accepted
connections addressed to that specific container IP (reachable from
other containers via the `web` service name, confirmed via
`docker compose exec api python3 -c "urllib.request.urlopen('http://web:3000/healthz')"`
→ 200) but not `127.0.0.1`/`localhost` from inside the same container,
which is exactly what the new healthcheck used. Fixed with
`ENV HOSTNAME=0.0.0.0` in `apps/web/Dockerfile`; confirmed the
healthcheck then passes and `nginx` (which now waits on `web`'s health
before starting) comes up.

- **Non-root containers**: `docker compose exec api id` → `uid=999
  (appuser)`; `docker compose exec web id` → `uid=1001(nextjs)`.
- **Security headers**: `curl -sI http://localhost/signup` shows
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and `Server:
  nginx` with no version number (`server_tokens off`).
- **FastAPI docs disabled**: `urllib.request.urlopen('http://localhost:8000/docs')`
  from inside the `api` container → `404`.
- **The X-Forwarded-Proto Blocker fix, the one that mattered most**:
  signed up normally (no forwarded-proto header) — session cookie came
  back `authjs.session-token=…; HttpOnly; SameSite=lax`, correctly
  *not* `Secure` on genuine plaintext HTTP. Signed up again with
  `-H "X-Forwarded-Proto: https"` (simulating the outer TLS proxy
  AC20's guide recommends) — session cookie came back
  `__Secure-authjs.session-token=…; Secure; HttpOnly; SameSite=lax`,
  confirming Auth.js now honors the forwarded proto instead of the
  previously-hardcoded `$scheme` (always `http`, since this Nginx has
  no TLS listener).
- **Regression check**: full signup → task-creation → analytics
  journey through Nginx still works end to end; the AC17 rate-limit
  burst test (10 rapid `GET /login`) still returns 6× `200` then 4×
  `429`, unaffected by the new `map` block or security headers.

All test users/tasks/sessions from this pass deleted afterward.

## Round 7 (adversarial + specialist re-review fixes) — 2026-08-18

Verified live against a full clean rebuild (`docker compose down` then
`up -d --build`):

- **X-Forwarded-Proto comma-list bypass (security-reviewer finding),
  the round's highest-priority fix**: signed up with
  `-H "X-Forwarded-Proto: http, https"` (simulating a proxy that
  appends rather than replaces the header) — session cookie came back
  `__Secure-authjs.session-token=…; Secure`, confirming the regex fix
  (matching the last comma-separated element) correctly reopens what
  the exact-match version had silently broken.
- **Non-root without the chown**: `docker compose exec api id` →
  `uid=999(appuser)`; `docker compose exec api ls -la /app/app/main.py`
  → `-rw-r--r-- 1 root root`, confirming appuser can read but not write
  its own code with the recursive chown removed.
- **ruff/pytest cache redirect**: both ran clean against the same
  no-chown image after pointing their cache dirs at `/tmp` — `ruff
  check .` had failed outright with "Permission denied" before this
  fix (a real regression caught by simply re-running gates after the
  chown removal, not by any reviewer).
- **Healthcheck liveness fix**: full `docker compose up -d --build`
  brought up all four containers with `web` reporting healthy before
  `nginx` started (confirming `nginx`'s hard gate on `web`'s health is
  satisfied), and `docker compose logs web` showed a real, transient
  `/healthz failed { cause: 'TypeError: fetch failed' }` line during
  api's own rebuild — the new logging working as intended, not a
  regression.
- **Regression check**: full signup→task-creation→analytics journey
  through Nginx and the AC17 rate-limit burst test both still pass
  (burst counts shifted slightly between runs due to the shared `auth`
  zone's leaky-bucket state carrying across `/signup` and `/login`
  requests in the same test session — expected, not a regression).

All test users/tasks/sessions from this pass deleted afterward.
