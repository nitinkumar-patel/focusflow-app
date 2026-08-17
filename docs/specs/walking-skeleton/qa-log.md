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
  `grep -rn 'allowedOrigins' apps/web/lib/auth.ts | grep -q '*'` — no
  match, confirms no wildcard workaround was added.
- **AC17 (rate limiting, whole-stack):** burst of 10 rapid
  `GET /login` requests through Nginx — first 6 returned `200`
  (burst=5 + the base rate), requests 7-10 returned `429`.

Not exercised in this pass (documented scope, not a gap): TLS (the
guide's warning covers this — there is no TLS to test, by design, on
`localhost`); the actual browser countdown UI (covered instead by
`PomodoroTimer.test.tsx`'s fake-timer tests, since no browser was
available in this environment — see T12's commit for that discipline).

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
