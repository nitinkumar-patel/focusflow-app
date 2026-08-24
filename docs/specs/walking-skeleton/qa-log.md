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
  nginx` with no version number (`server_tokens off`). Round 16 added
  `Content-Security-Policy: base-uri 'self'; form-action 'self';
  frame-ancestors 'none'` — confirmed live via the same `curl -D-`
  (see Round 16 below).
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

## Round 8 (three-way re-review, X-Forwarded-Proto reviewer disagreement resolved) — 2026-08-18

Two of three specialist reviewers disputed round 7's X-Forwarded-Proto
fix (matching the *last* comma-element); adversarial-reviewer
demonstrated live that `https, http` — a real HTTPS client behind a
TLS-terminating edge proxy forwarding in plaintext, the guide's own
recommended topology — produced a non-`Secure` cookie under that
regex. Independently re-derived the correct semantics (first non-empty
element) and verified all four disputed cases against the running
stack, both **before** confirming the bug and **after** applying the
fix:

| `X-Forwarded-Proto` sent | Before (round 7, last-element) | After (round 8, first-element) |
|---|---|---|
| *(absent)* | not Secure | not Secure |
| `https` | Secure | Secure |
| `, https` (leading-empty, the original motivating misconfiguration) | Secure | Secure |
| `http, https` (client used HTTP) | **Secure** ← wrong, browser silently discards | not Secure ✓ |
| `https, http` (client used HTTPS, plaintext internal hop — the guide's own topology) | **not Secure** ← original Blocker reopened | Secure ✓ |

Both regressions in the "before" column are real: `http, https`
produced a cookie no browser would actually store (broken login, no
server-side signal), and `https, http` was the exact scenario the
original round-6 Blocker existed to fix, silently broken again. The
"after" column matches the actual live `curl -H "X-Forwarded-Proto:
..."` output against the rebuilt stack for every row.

Also verified: `apps/api` gates (`ruff`, `pytest` — 48 passed, cache
now writing to `/tmp` via `RUFF_CACHE_DIR`/`PYTEST_ADDOPTS` instead of
`pyproject.toml`), `apps/web` gates (`lint`, `tsc`, `vitest` — 44
tests, full suite in ~1.6s, down from ~7s now that the timeout test no
longer waits on a real 5s timer), `npm run build`; the corrected
`verify-invariants` AC16 step against both a positive case (existing
files, all pass) and a negative case (a scratch file with two exported
actions and only one `await auth()` call, correctly fails); a full
signup→task→analytics journey through Nginx.

All test users/tasks/sessions from this pass deleted afterward.

## Round 9 (quality-engineer) — 2026-08-19

2 Concerns + 2 Nits against round 8's diff:

- **CI grep fail-open on zero match**: `ci.yml`'s AC16 step ran bare
  `grep -c` for both `actions=` and `guards=` counts — `grep -c` exits
  1 (not just 2) when the count is zero, which under `bash -e` aborted
  the step at the assignment instead of reaching the `-lt` comparison.
  Guarded both with `|| true` so a zero count reaches the comparison
  and fails with a readable message instead of an opaque script abort.
  Also widened the `actions=` pattern itself to match `export const x
  = async` in addition to `export async function`, the other action
  style already used elsewhere in the codebase.
- **401 log-level split had no test covering both branches**: round 8
  added an `error`-vs-`warn` carve-out for a 401 on a non-`/auth/` path
  (signals a broken `X-Internal-Secret`) vs. a routine `/auth/` 401,
  but no test exercised both call shapes. Added a test asserting the
  call-count split directly.
- Nits: joined a two-line qa-log.md round-8 heading onto one line;
  removed a duplicate trailing line.

Verified against the real Docker Compose stack after rebuild: `ruff`,
48 api tests, 45 web tests, `lint`, `tsc`, `build` all clean; the
X-Forwarded-Proto fix re-confirmed live across all 5 disputed cases via
`/api/auth/csrf`.

All test users/tasks/sessions from this pass deleted afterward.

## Round 10 (adversarial-reviewer, full-diff pass) — 2026-08-19

1 Blocker + 4 Concerns + 4 Nits against the full implementation diff
(43bed1f..HEAD, 97 files):

- **Blocker — round 9's own fix reopened the fail-closed invariant**:
  `|| true` on `actions=` alone means a file the grep pattern can't
  recognize yields `actions=0`, and `0 -lt 0` is false — the step now
  silently *passes* a file with zero recognized action exports and
  zero guards, the same "check can't see it → must fail closed" defect
  rounds 7-8 fixed twice already. Verified locally: a `"use server"`
  file with an unrecognized export style produced `actions=0 guards=0
  fail=0` (wrongly passes) before this round's fix, and `fail=1`
  (correctly fails, with a "pattern may be stale" message) after.
  Fixed by adding an explicit `[ "$actions" -eq 0 ]` failure branch
  ahead of the `-lt` comparison.
- Concerns: `spec.md`/`plan.md` Status fields left at
  `Implementing`/`Executing` though all ACs are checked — flip to
  `Shipped`/`Done` deferred to the finish commit, once this round's
  re-review is clean; round 9 had no qa-log.md or plan.md changelog
  entry (only the commit message) — added above; the seven items
  explicitly deferred (five from round 6's security-reviewer pass, two
  from round 7's quality-engineer pass) lived only in plan.md prose,
  with `workspace.toml [backlog].open` empty — added slugs, sources,
  and summaries for all seven.
- Nits: AC11's grep corpus covered only `apps/web/app/(auth)`, missing
  `apps/web/app/(app)/`, `proxy.ts`, and `scripts/` — widened to all of
  `apps/web/app` plus those two paths (verified zero false positives
  against the current tree); `config.py`'s `_build_database_url`
  comment still cited the round-1 `env_file:`-specific explanation
  after round 3 corrected the reasoning in plan.md — restated to
  match (round 11 found this restated reasoning itself false and
  retracted it — see the Round 11 section below); `apps/api/uv.lock`
  was untracked and unread by any build step
  (`pip`, not `uv`, installs deps) — deleted; the changelog's `[0.1.0]`
  entry was dated 2026-08-17, two days before work actually finished —
  redating deferred to the finish commit alongside the Status flip.

Verified: `ruff`, api pytest, `lint`, `tsc`, web vitest, `npm run
build` all clean after the CI-workflow and comment fixes (workflow
syntax and grep-corpus changes confirmed by direct shell reproduction
of both the positive and negative cases, since GitHub Actions itself
doesn't run locally).

All test users/tasks/sessions from this pass deleted afterward.

## Round 11 (adversarial-reviewer, fix-verification) — 2026-08-20

1 Blocker + 3 Concerns + 3 Nits against round 10's fixes:

- **Blocker — round 10's `.env` interpolation claim is false**: the
  comment added to `config.py`/`plan.md` said a `.env` file's own
  values aren't recursively interpolated within that same file.
  Reproduced live: `docker compose config` (v5.1.4) with
  `POSTGRES_PASSWORD=s3cr3t` and `DATABASE_URL=...${POSTGRES_PASSWORD}`
  both in `.env` renders the fully-expanded URL — via `env_file:` and
  via `environment:`. Retracted the claim; restated the real reason
  (no combined `DATABASE_URL` var is ever shipped, so the password has
  one canonical home).
- Concerns: `workspace.toml`'s comments cited a nonexistent `plan.md
  T-security` task — repointed at the real round-6/round-7 changelog
  entries; the two quality-engineer backlog items were mislabeled
  round-6, should be round-7 — relabeled in `workspace.toml` and here;
  the seven backlog entries still classified `unsupported_legacy`
  under `workspace_status.py reconcile` even with `summary`/`needs`
  present — added an acknowledgment comment describing this as
  expected (round 12 found that comment's stated mechanism wrong and
  replaced the actual fix — see below).
- Nits: Round 8's closing line had gone missing (orphaned/duplicated
  at EOF after Round 10) — restored it in place, removed the
  duplicate; the Round 9 record above only mentioned the `|| true`
  guard, not the `export const x = async` pattern widening the same
  commit made — added; the AC16 zero-action failure message printed
  the filename twice — fixed.

Verified: `ruff`, 48 api tests (container rebuilt), `lint`, `tsc`
clean; `lint-spec-status.py --root .` clean.

All test users/tasks/sessions from this pass deleted afterward.

## Round 12 (adversarial-reviewer, fix-verification) — 2026-08-20

0 Blockers + 3 Concerns + 0 Nits against round 11's fixes:

- Round 11's `workspace.toml` acknowledgment comment claimed the seven
  backlog entries render `unsupported_legacy` because none has a
  target spec/plan artifact yet ("no `path` to register") — false;
  adding `path` alone doesn't change the classification (the
  accepted-legacy shape needs the exact 5-field set `{slug, source,
  summary, needs, type}` with `type = "spec"`, per
  `workspace_status_engine.py`). Fixed by adding `type = "spec"` to
  each of the seven entries and rewriting the comment to describe the
  real mechanism.
- Round 11 itself had no changelog/qa-log record (the same defect
  round 10 raised about round 9, reopened one round later) — added the
  Round 11 section above and a matching `plan.md` changelog entry.
- The interpolation-claim retraction was tagged "round-10 REVIEW
  correction" in `plan.md`, though round 11 is what found and
  retracted it — retagged "round-11 REVIEW correction".

Verified: `ruff`, api pytest, `lint`, `tsc` clean (api/web code
unchanged since round 11, only docs/config); `lint-spec-status.py`
clean; `workspace.toml` re-parsed with `tomllib` (7 entries, all
fields present) and `workspace_status.py reconcile` re-run to confirm
all seven now classify `legacy_entry`, not `unsupported_legacy`.

All test users/tasks/sessions from this pass deleted afterward.

## Round 13 (adversarial-reviewer, fix-verification) — 2026-08-20

2 Concerns + 1 Nit against round 12's fixes — all record-keeping; no
further findings against `ci.yml` or `config.py` (unchanged since
round 11):

- Round 12 itself had no changelog/qa-log entry, and the Round 11
  entries in both files misattributed the `type = "spec"` fix to round
  11 (it was round 12's fix) — corrected the Round 11 entries and
  added this Round 12 entry above (and to `plan.md`).
- `workspace.toml`'s comment cited "CONVENTIONS.md § 4" for the legacy
  5-field backlog shape, but § 4 only defines the `slug`-matching
  deferral-token contract, not the 5-field shape — repointed at
  `.claude/skills/workspace-status/SKILL.md § 1a` (`legacy_entry`
  row), keeping the § 4 reference scoped to `slug`.
- Nit: this file's Round 10 entry still asserted the `.env`
  interpolation reasoning round 11 retracted, without a pointer to the
  retraction (only `plan.md`'s copy had one) — added the same pointer
  here.

Verified: `workspace.toml` re-parsed with `tomllib`; `reconcile`
re-run, still zero `unsupported_legacy`; `lint-spec-status.py` clean.

All test users/tasks/sessions from this pass deleted afterward.

## Round 14 (adversarial-reviewer, fix-verification) — 2026-08-20

0 Blockers + 1 Concern + 0 Nits against round 13's fixes. Confirmed
the one-round-behind changelog pattern is broken: round 12 and round
13 both now have entries in `plan.md` and here, and the reviewer
cross-checked them against the actual diffs and found them accurate.

- `workspace.toml`'s round-13 citation
  (`.claude/skills/workspace-status/SKILL.md § 1a`) named the right
  classification code (`legacy_entry`) but not the field-set contract
  — § 1a documents only that the code is non-dispatchable/
  informational, not the 5-field shape. Repointed the comment at the
  actual shape definition, `workspace_status_engine.py:993-1015`
  (`_accepted_legacy_entry`'s `backlog.open` branch), keeping the
  `SKILL.md § 1a` pointer for what it does document.

Verified: `workspace.toml` re-parsed with `tomllib`; `reconcile`
re-run, still zero `unsupported_legacy`.

All test users/tasks/sessions from this pass deleted afterward.

## Round 15 — 2026-08-20

adversarial-reviewer returned `Clean — ready to commit.` against round
14's fix. No findings, no changes. This satisfied the mandatory
adversarial requirement, triggering the whole-spec specialist pass
(quality-engineer + security-reviewer, dispatched in parallel) —
Round 16 below.

## Round 16 (quality-engineer + security-reviewer, whole-spec pass) — 2026-08-20

1 Blocker + 9 Concerns + 5 Nits combined — the first real
application-code findings since round 11 (rounds 12-14 were pure
record-keeping). Both reviewers independently caught the same gap:
`db` never got `restart: unless-stopped` (round 6 added it to
api/web/nginx and left a comment on `api` falsely claiming `db` was
already covered).

**Applied:**

- **Blocker**: AC2's login half had zero test coverage. Added
  `apps/web/app/(auth)/login/actions.test.ts` (missing-fields
  rejection, `signIn` call shape, `AuthError` → generic message,
  non-`AuthError` rethrow) — verified red against a broken mapping
  before confirming green. Then live-drove the real flow through
  nginx: created a test user directly via `apps/api`'s
  `/auth/register` (`docker compose exec api python3` — no `curl` in
  the slim image), then hit `/api/auth/csrf` +
  `/api/auth/callback/credentials` through nginx twice — correct
  password: `302`, session cookie set (`authjs.session-token` present
  in the cookie jar); wrong password: `302` to
  `/login?error=CredentialsSignin&code=credentials`, no session
  cookie. Browser extension wasn't available in this session, so this
  substituted for a UI-driven click-through — the same NextAuth
  `authorize()` code path `loginAction`'s `signIn()` call reaches.
- `db`'s restart policy (above) — confirmed via `docker inspect
  focusflow-app-db-1 --format '{{.HostConfig.RestartPolicy.Name}}'` →
  `unless-stopped` after `docker compose up -d --build`.
- The `INTERNAL_API_SECRET`-mismatch signal logged at `warn` on
  `/auth/*` — exactly where it hits first — because the carve-out was
  path-based. Switched to detail-based (`cause === "unauthorized"` —
  superseded by round 17, which replaced this with
  `"invalid internal secret"`; see Round 17 below) in `api-client.ts`;
  rewrote the pinning test to cover `/auth/register` too, not just
  `/tasks` vs `/auth/verify`.
- `check_db_connection`'s log line had no failing test — added one,
  verified red against a reverted `logger.exception` call before
  confirming green (50 api tests, was 48).
- `test_by_day_buckets_in_utc` only ran against the default UTC
  session timezone. Added a `non_utc_client` conftest fixture (`SET
  TIME ZONE 'Pacific/Kiritimati'`) and a matching test — verified red
  against a bare `func.date(started_at)` (yesterday's bucket read 0.0
  instead of 1.0) before confirming green.
- No CSP anywhere — added `base-uri 'self'; form-action 'self';
  frame-ancestors 'none'` to `nginx.conf` — confirmed live via `curl
  -D- http://localhost/login | grep -i content-security-policy` after
  rebuild.
- AC16's CI loop still failed open on a non-numeric `grep -c` capture
  — added an explicit `case` guard on both counts, verified locally
  (unreadable-count branch fires; the three existing action-shape
  cases from round 15 still behave correctly).
- `handleStop`'s silent `completedWorkIntervals` preservation —
  commented (deliberate: doesn't undo already-completed work
  intervals, so restarting still counts toward the 4th-interval long
  break).
- `dockerfile-runtime-stage-absent`'s backlog summary understated its
  consequence — reworded in `workspace.toml`.

**Deferred** (design-scope; added to `workspace.toml
[backlog].open`): the AC5/AC6 `revalidatePath`-re-render join has no
test against a live mid-cycle timer; CI never runs a real `docker
compose up` + HTTP smoke test (AC10 and the X-Forwarded-Proto
protection rest on this file's hand-run curl tables); `apps/api`'s
unpinned dependencies have no committed lockfile (the `apps/api/uv.lock`
deleted at round 10 as unreferenced would, in hindsight, have closed a
real gap — but restoring it needs an actual switch to lockfile-based
installs, not just un-deleting the file); `apiFetch`'s `logFailure`
can log a fragment of a submitted email address via some
`email_validator` rejection reasons, needing an apps/api-side design
call (a custom validation-error handler), not a client-side guess.

Verified: full stack rebuilt (`docker compose up -d --build`); `ruff`,
50 api tests, `lint`, `tsc`, 49 web tests, `npm run build` all clean;
CSP header and the real login flow (both outcomes) re-confirmed live
post-rebuild; `workspace.toml` re-parsed with `tomllib` (11 entries)
and `reconcile` re-run, all classify `legacy_entry`.

All test users/tasks/sessions from this pass deleted afterward.

## Round 17 (adversarial re-review of round 16's own fixes, two passes) — 2026-08-21

Round 16's fixes went through a fresh adversarial pass; that pass found
1 Blocker + 5 Concerns + 4 Nits, mostly missing test coverage for round
16's own new behavior and doc-drift the round-16 entry itself
introduced. Fixing those triggered a second adversarial pass, which
found 1 more Blocker + 5 Concerns + 4 Nits of the same shape. Full list
in `plan.md`'s round-17 changelog entry; QA-relevant verification below.

- **The non-UTC analytics test was fail-open for ~42% of run hours**:
  it used `datetime.now(UTC) - 60s`, which only crosses the
  Kiritimati/UTC calendar-date boundary when the UTC hour is >= 10.
  Reproduced live: reverted `router.py`'s `func.timezone("UTC", ...)`
  to a bare `func.date(started_at)` and ran the test with the old
  `- 60s` anchor at a UTC hour < 10 — passed against the broken code.
  Re-ran with the round-17 fix (both sessions pinned to 23:00 UTC) —
  failed red against the same broken code (the `yesterday` bucket came
  back `0.0` instead of `1.0`, since a 23:00 UTC session lands in the
  *next* Kiritimati calendar day). Restored the real fix — green.
- **`require_internal_secret`'s wrong-secret branch had no coverage,
  and apps/web's discriminator string had no api-side test**: added
  `test_wrong_internal_secret_401` plus a `detail` assertion on all
  three internal-secret tests. Reverted `security.py`'s
  `"invalid internal secret"` back to `"unauthorized"` — all three
  failed red with a clear string-mismatch diff. Restored — 11/11
  `test_auth.py` tests green.
- **The `"invalid internal secret"` detail, live**: `docker compose
  exec api python3 -c "..."` posting to `/auth/register` with
  `X-Internal-Secret: wrong` → `401 {"detail":"invalid internal
  secret"}`, confirmed against the running container post-rebuild.
- **CI grep-guard rewrites (AC11, AC21 steps)**: both steps in
  `ci.yml` previously fail-opened on a `grep` error (exit 2) the same
  way the AC16 step did before its round-16 fix. Simulated locally with
  `bash -eo pipefail`: (1) clean-repo pass case — both steps exit 0
  with no output; (2) injected a nonexistent path into each grep's
  argument list — both steps now print "grep failed unexpectedly (exit
  2)" and exit 1, instead of silently passing; (3) injected an actual
  violation (a `console.log` template string with `password`, and a
  literal `"*"` in a mock `allowedOrigins`) — both steps correctly
  detect it and exit 1.
- **`handleStop`'s cycle-position invariant**: `PomodoroTimer.test.tsx`'s
  new test — start, complete one work interval, stop mid-way through
  the second, restart, complete three more — lands on a long break at
  the 4th completion. Injected `setCompletedWorkIntervals(0)` into
  `handleStop` — the same scenario landed on a short break instead
  (red); reverted the injection — long break, as expected (green).
- **Regression check**: `/healthz` → `{"status":"ok"}`; CSP header
  still present via `curl -sI /signup`; `db`/`api` restart policies
  still `unless-stopped` via `docker inspect`.

Verified: full stack rebuilt (`docker compose up -d --build`); `ruff`,
51 api tests (was 50), `lint`, `tsc`, 50 web tests (was 49), `npm run
build` all clean.

All test users/tasks/sessions from this pass deleted afterward.

### Pass 3 (third adversarial review of round 17's own fixes)

Found 0 Blockers, 3 Concerns, 3 Nits — no Blocker after two prior
passes each found one, taken as convergence. Full list in `plan.md`'s
round-17 changelog Pass 3 addendum; QA-relevant verification below.

- **AC21 CI step's multi-line blind spot**: the pass-2 rewrite still
  missed a wildcard on a line *after* the `allowedOrigins`/`trustHost`
  match. Reproduced: wrote a throwaway
  `allowedOrigins: [\n  "*",\n]` (multi-line) into a scratch file
  outside the repo and ran the pass-2 grep against it — passed (no `*`
  on the matched line itself). Ran the pass-3 `-A3` version against the
  same scratch file — caught it. Re-ran all three cases (clean repo,
  the multi-line violation, a simulated grep error) with the final
  version — all three still behave correctly.
- **`AC23` added for the security-header set** — `spec.md`'s
  Acceptance Criteria now name it explicitly; previously the whole
  header block in `nginx.conf` could be deleted without failing any
  criterion.
- **OpenAPI contract updated**: `contracts/openapi/focusflow-api.yaml`'s
  `Unauthorized` response now documents both `detail` values
  (`"invalid internal secret"` vs `"unauthorized"`) as the canonical
  cross-service reference, since three independent code locations
  (api, web, and each side's tests) now depend on the exact strings
  matching.
- **Regression check**: `/healthz` → `{"status":"ok"}`; CSP header
  still present via `curl -sI /signup`.

Verified: full stack rebuilt (`docker compose up -d --build`); `ruff`,
51 api tests, `lint`, `tsc`, 50 web tests — counts unchanged from pass 2
(pass 3's fixes were doc/CI/contract-only) — `npm run build` all clean.
`git status` confirms `test_db_session.py` and
`apps/web/app/(auth)/login/actions.test.ts` are now staged (were
untracked since round 16/pass 1).

All test users/tasks/sessions from this pass deleted afterward.

### Pass 4 (fourth adversarial review of round 17's own fixes)

Found 1 Blocker + 3 Concerns + 3 Nits — the Blocker was in pass 3's own
new OpenAPI contract text, and two Concerns were regressions in pass
3's own AC21 CI-step rewrite. Full list in `plan.md`'s round-17
changelog Pass 4 addendum; QA-relevant verification below.

- **`/auth/verify` returns a third `detail` string the new OpenAPI
  text denied existed**: confirmed in `apps/api/app/auth/router.py:76,79`
  — `"invalid credentials"`, not `"unauthorized"` — and confirmed it's
  the endpoint `$ref`ing `Unauthorized` (`focusflow-api.yaml:227`).
  Rewrote the contract description to list all three `detail` values
  with their real source files.
- **AC21 CI step's `-A3` window missed a wildcard 6 lines past the
  matched line**: reproduced with a throwaway scratch file
  (`allowedOrigins: [...5 lines of unrelated entries..., "*", ]`) —
  the pass-3 `-A3` version passed it (wildcard outside the 3-line
  window); the pass-4 file-level version (`grep -F -e '"*"' -e
  "'*'"` over the whole file) caught it.
- **AC21 CI step's fail-closed-on-empty-corpus regression, fixed**:
  reproduced pass 3's `test -d apps/web` bug directly — pointed the
  step at a scratch `apps/web` directory containing only an unrelated
  file (no `allowedOrigins`/`trustHost` anywhere) and confirmed the
  pass-3 version passed silently; added `test -n "$files"` and
  confirmed the same scratch scenario now fails closed.
- **AC21 CI step, all four cases re-verified after both fixes**: clean
  repo (pass), the far multi-line wildcard (fail), the empty-corpus
  case (fail), and a simulated grep error on a nonexistent path (fail)
  — all four correct.
- **Regression check**: `/healthz` → `{"status":"ok"}`; all five
  Nginx response headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Content-Security-Policy`, and no `Server` version
  string) reconfirmed via `curl -sI /signup` against the rebuilt stack.

Verified: full stack rebuilt (`docker compose up -d --build`); `ruff`,
51 api tests, `lint`, `tsc`, 50 web tests, `npm run build` all clean
(counts unchanged — pass 4's fixes were doc/CI/contract-only).

All test users/tasks/sessions from this pass deleted afterward.
