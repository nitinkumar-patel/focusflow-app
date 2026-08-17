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
- **AC21 (wildcard-origins absence):**
  `! grep -rn 'allowedOrigins' apps/web/next.config.ts apps/web/lib/auth.ts
  | grep -q '\*'` — passes (round-2 REVIEW fix: the original check
  scanned only `lib/auth.ts`, where Next.js's `allowedOrigins` setting
  can never appear since it's a `next.config.ts` option, making the
  original check vacuous regardless of outcome; re-verified against
  `apps/web/next.config.ts`, which has no `allowedOrigins` entry at
  all).
- **AC17 (rate limiting, whole-stack):** burst of 10 rapid
  `GET /login` requests through Nginx — first 6 returned `200`
  (burst=5 + the base rate), requests 7-10 returned `429`.

Not exercised in this pass (documented scope, not a gap): TLS (the
guide's warning covers this — there is no TLS to test, by design, on
`localhost`); the actual browser countdown UI (covered instead by
`PomodoroTimer.test.tsx`'s fake-timer tests, since no browser was
available in this environment — see T12's commit for that discipline).

**Verification-methodology caveat (round-2 REVIEW finding):** every
check above drove Server Actions via curl replicating the RSC wire
protocol, not a real browser. This proves the server-side behavior
(the request succeeds, the database changes, the next response reflects
it) but cannot distinguish a client-side re-render from a full document
reload — so AC4's and AC8's "without a manual page refresh" /
"without a manual page refresh" clauses are verified indirectly (the
response is an RSC flight payload, per `revalidatePath`, not an HTML
document) rather than observed directly in a browser.

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

All test data (the QA user, its task, and both sessions) was deleted
from the database after this pass; `POMODORO_TEST_SHORT_INTERVALS` was
reverted to empty in `.env`.

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
