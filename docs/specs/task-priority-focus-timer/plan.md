# Plan: Task priority, Pomodoro estimates, and focus timer

- **Spec:** [`spec.md`](spec.md)
- **Status:** Executing <!-- Drafting | Approved | Executing | Done -->
- **Repository anchors:** `docs/architecture/reference.md` § Building-block view and § Crosscutting concepts; `apps/api/app/tasks/router.py` and `apps/api/app/analytics/router.py` (router-per-package pattern with `require_internal_secret`/`require_user_id` dependencies, which the new `app/timer` package follows); `apps/api/tests/test_sessions.py` and `test_tasks.py` (async API tests against real Postgres, which the new timer tests follow); `apps/web/app/(app)/tasks/actions.ts` (Server Action pattern through `lib/api-client.ts`); `apps/web/components/PomodoroTimer.tsx` (the inline timer this plan replaces). Named deviation: durations and cadence move from `apps/web/lib/pomodoro-*.ts` to `apps/api`, so the web copies are deleted in T8.

> **Plan contract:** this is the implementation strategy. It may change
> substantively only while its Status is `Drafting`, before approval records its
> baseline. After approval, `spec.md` and `plan.md` are pinned in substance;
> only lifecycle bookkeeping is permitted, and execution observations belong in
> `docs/specs/task-priority-focus-timer/notes/verification-ledger.md`. A genuine
> artifact error follows the controlled-amendment path.

## Approach

The server owns the Pomodoro cycle. A new `active_timers` table holds at most one row per user (the user id is its primary key), and the API settles elapsed phases lazily whenever the timer is read or started, so no background worker is needed. Settlement runs under a row lock, records the finished work interval as a `pomodoro_sessions` row, and advances the row to the next break; the web app only displays server state and re-fetches when a countdown reaches zero. Tasks gain two columns, and the list endpoint computes `completed_pomodoros` from session rows. The web work follows the API: Server Actions first, then the Tasks screen, then the new `/focus` view, then deletion of the now-dead client timer. The riskiest parts are the concurrency guarantee (T3) and the migration on existing data (T1).

## Constraints

- ADR-0001: browser talks only to Next.js; FastAPI is internal; Alembic ships with every schema change.
- Walking-skeleton AC7 (breaks are never recorded as sessions) is preserved: breaks live only in `active_timers`, which is deleted when a break ends.
- Walking-skeleton AC13 (one primary action per screen) applies to `/focus`: Stop / Skip break is its only primary control.
- web-ui-redesign tokens and contrast rules apply to all new markup.

## Construction tests

**Integration tests:** API tests in T3 drive the real routers against Postgres with a controllable clock; T9 re-runs the full gate set.
**Manual verification:** T7 and T9 record real-browser qa-log entries (both themes, 400px, phase transition, reload, two tabs).

## Durable-output map

| Durable output | Tasks | Implementation evidence | Closeout evidence |
| --- | --- | --- | --- |
| `contracts/openapi/focusflow-api.yaml` | T4 | contract-vs-router test | contract matches routers |
| `docs/specs/web-ui-redesign/spec.md` amendment | T10 | AC5, AC8, the Objective, and the Boundaries amended to the focus view and server-recorded sessions | no contradiction with this spec |
| `docs/architecture/overview.md` | T10 | table list names `active_timers` | overview names it |
| `docs/specs/walking-skeleton/spec.md` amendment | T10 | walking-skeleton text on cadence values, sessions route, client-side breaks, and the override no longer contradicts this spec | no contradiction with this spec |
| `docs/architecture/reference.md` | T10 | updated Building-block view | names `app/timer` and `active_timers` |
| `docs/guides/how-to/` timer guide | T10 | new guide page | covers priority, estimates, focus view, breaks |
| `docs/product/changelog.md` | T10 | new entry | entry present |

## Design (LLD)

### Data & schema
Traces to: AC1, AC3, AC6, AC7, AC21–AC24 · `contracts/openapi/focusflow-api.yaml`.

- `tasks` gains `priority` (text with a CHECK constraint on `high|medium|low`, server default `medium`) and `estimated_pomodoros` (integer with CHECK 1–20, server default 1), so existing rows backfill by the defaults.
- `active_timers`: `user_id` UUID primary key referencing `users.id` (the one-timer guarantee), `task_id` referencing `tasks.id`, `phase` (`work|short_break|long_break`, CHECK), `started_at` and `duration_seconds`. The end time is derived, never stored.
- `pomodoro_sessions` is untouched. Completed count per task is `COUNT(*)` of its sessions; the long-break rule counts the user's sessions joined through `tasks`.

### Interfaces & contracts
Traces to: AC5–AC19, AC25, AC45, AC46 · `contracts/openapi/focusflow-api.yaml`.

- `POST /timer/start {task_id}` → 201 timer | 404 | 409. `GET /timer` → 200 timer or `null`. `POST /timer/stop` → 204 | 404.
- Timer body: `task_id`, `phase`, `started_at`, `ends_at`, `duration_seconds`, `remaining_seconds`, `server_time`, and `cycle_position` (the `n` of AC34: `(c mod 4) + 1` in a work phase, `((c - 1) mod 4) + 1` in a break, where `c` is the user's session count). `server_time` lets the client correct for clock skew.
- All routes require the internal secret and `X-User-Id` like the existing routers.

### State & control flow
Traces to: AC11–AC18, AC35, AC36, AC44–AC48.

- Settlement runs at the start of `GET /timer`, `POST /timer/start`, `POST /timer/stop`, `GET /tasks`, and `GET /analytics/focus-time` (the last two so counts and totals are never stale): lock the user's timer row; while the current phase's end time is past: a finished `work` phase inserts one session (`started_at`, `ended_at = started_at + duration`) and becomes a break starting at that `ended_at` (long when the session count is now a multiple of 4, else short); a finished break deletes the row. The loop handles a user who was away for several phases. The row lock serializes concurrent readers so each session is inserted once.
- `POST /timer/start` settles first, then inserts; a primary-key conflict returns 409. `POST /timer/stop` settles first, then deletes whatever timer remains (404 if none).
- The web focus view stores `ends_at` and `server_time`, ticks locally each second, and calls `GET /timer` when remaining reaches zero or the tab becomes visible.

### Failure, edge cases & resilience
Traces to: AC6–AC8, AC12, AC18, AC49, AC50.

- The primary key makes simultaneous starts safe without application locking; settlement uses `SELECT … FOR UPDATE`.
- Durations come from API settings; `POMODORO_TEST_SHORT_INTERVALS` (when set) selects the existing 60/15/30-second QA durations, read by the API instead of the web app.

### Component / module decomposition
Traces to: AC26–AC38, AC43.

- `apps/api/app/timer/` (router and settlement functions), `apps/api/app/models.py` additions.
- Web: `components/FocusTimer.tsx` (client; ring + countdown), `components/TaskForm.tsx` and `TaskList.tsx` (extended), `app/(app)/focus/page.tsx` (server component fetching the timer), Server Actions in `app/(app)/tasks/actions.ts` and a new `app/(app)/focus/actions.ts`.
- The ring is an inline SVG circle using `stroke-dasharray`/`stroke-dashoffset` from the elapsed fraction, token colors per phase.

### Quality attributes (NFRs)
Traces to: AC39–AC41.

- Countdown text has no live-region role; a separate visually hidden `aria-live="polite"` element announces phase changes once.
- Break phases use a distinct token color that still clears 3:1 against the background in both themes.

## Tasks

### T1: Migration and models land and round-trip on existing data

**Depends on:** none

**Tests:**
- Migration test (goal-based, real Postgres, run against a throwaway database created for the test and dropped afterwards, never the shared `focusflow_test` database the suite migrates once per session): seed old-schema tasks and a session, run `alembic upgrade head`, assert each task is `medium`/1 (AC21) and the session is unchanged (AC22); run `downgrade` one revision, assert the columns and `active_timers` are gone (AC23) and `pomodoro_sessions` rows are intact (AC24).
- Constraint tests: a priority outside the three values, an estimate of 0 or 21, a second `active_timers` row for one user, and a phase outside the three values are each rejected by the database.

**Done when:** the migration test and constraint tests pass.

### T2: Task create and list carry priority, estimate, and completed count in order

**Depends on:** T1, T3

**Tests:**
- API tests in `apps/api/tests/test_tasks.py` for AC1 (defaults and stored values), AC2 (422 cases), AC3 (counts from seeded sessions, including a task with none), and AC11 for `GET /tasks`, which this task wires to settlement (a seeded elapsed work timer is settled before the list is computed), AC4 (mixed priorities and creation times).

**Done when:** those tests pass and existing task tests still pass unchanged.

### T3: Timer start, read, stop, and settlement obey the cadence and the one-timer rule

**Depends on:** T1

**Tests:**
- New `apps/api/tests/test_timer.py` with a controllable clock: AC5, AC6 (during work, during a break, and against an elapsed work phase, where the response is 409 and the stored timer is the break that settlement produced), AC7 (two concurrent starts via `asyncio.gather`), AC8, AC9, AC10, AC11 for the three timer routes (`GET /timer`, `POST /timer/start`, `POST /timer/stop`); `GET /tasks` is owned by T2 and `GET /analytics/focus-time` by T4, AC12 (repeated and concurrent reads), AC13 (sessions 1–3 then 4: short, short, short, long), AC14, AC15, AC16, AC17, AC18, AC45 (start after an elapsed break), AC46 (stop after an elapsed break), AC47 (break anchored at the work phase's end), AC48 (multi-phase catch-up read after a long absence recording every elapsed session with correct timestamps).
- Config tests: with `POMODORO_TEST_SHORT_INTERVALS` set the durations are 60/15/30 (AC50); unset or empty they are 1500/300/900 (AC49).

**Approach:** write the settlement as a function taking the session and a `now`, so tests pass an explicit time instead of patching a clock; compose the API env with the override variable, remove the `web` service's entry in `docker-compose.yml`, and correct the comment saying `api` has no use for it.

- Goal-based: `docker compose config` shows `POMODORO_TEST_SHORT_INTERVALS` in the `api` service environment and not in `web`.

**Done when:** `test_timer.py`, the config test, and the compose check pass.

### T4: Sessions route is removed and the OpenAPI contract matches the routers

**Depends on:** T2, T3

**Tests:**
- AC19: a request to `POST /tasks/{id}/sessions` answers 404 or 405; `test_sessions.py` cases that exercised recording through that route move to timer settlement tests or are deleted with their route. `test_analytics.py` seeds sessions through that route (`_record_session`); it is re-seeded with direct `pomodoro_sessions` row inserts, keeping every analytics and cross-user-isolation assertion (including `test_excludes_other_users_sessions`).
- AC11 for analytics (this task wires `GET /analytics/focus-time` to settlement): `GET /analytics/focus-time` called after a work phase's end time with no prior timer read reports that session. AC20: after settlement of one work phase, analytics `by_task` and `by_day` each rise by 25 minutes.
- AC25: a test loads the OpenAPI file and asserts each router response field and status code named in the spec appears in it, and the sessions path does not.

**Done when:** `docker compose exec api pytest` and `ruff check .` pass.

### T5: Web Server Actions expose tasks and timer start/read/stop

**Depends on:** T4

**Tests:**
- Action tests in the style of `tasks/actions.test.ts`: create passes priority/estimate to the API; start/stop/get call the right routes with the session user id; `recordSessionAction` stays until T8, where it is deleted with its last importer `PomodoroTimer.tsx`, so the web gate set passes at every task boundary (the old inline timer's session recording is dead against the removed route from T4 and is never shipped).

**Done when:** the new and existing action tests pass.

### T6: Tasks screen shows priority, progress, and the running task

**Depends on:** T5

**Tests:**
- Component tests: form fields have labels and an out-of-range estimate renders a `role="alert"` message (AC26, AC27); list rows show priority and `completed/estimated` in API order (AC28); for each of the three phases the matching row is marked (AC29), other start controls are disabled (AC30), and each shows text naming the running task (AC43).

**Done when:** those tests pass and the screen is recorded in the qa-log in both themes at 400px.

### T7: The focus view shows a circular countdown through every phase

**Depends on:** T5

**Tests:**
- Component tests with fake timers: ring fraction (AC32), mm:ss, phase name and title (AC33) and the "Pomodoro n of 4" value for session counts 0–5 in work and break phases (AC34) for a given `ends_at`/`server_time`; a re-fetch at zero that shows the break (AC35) or the empty state (AC44); empty state with a Tasks link (AC31); exactly one primary control whose name changes to "Skip break" in a break (AC37) and that is focusable and keyboard-activatable (AC38); no live-region role on the countdown (AC39) and one polite announcement per phase change (AC40).
- Manual QA (real browser, recorded in the qa-log): AC35 and AC44 with `POMODORO_TEST_SHORT_INTERVALS` set, AC36 reload and second tab, AC38 visible focus indicator, both themes, 400px.

**Done when:** component tests pass and the manual entries are recorded.

### T8: Dead client timer code is deleted

**Depends on:** T6, T7

**Tests:**
- Goal-based: `grep` finds no remaining import of `PomodoroTimer`, `pomodoro-cycle`, `pomodoro-durations`, or `recordSessionAction` in `apps/web`, and their files and tests are removed (the action is deleted here with its last importer); the web suite, lint, typecheck, and build pass.

**Done when:** the grep is empty and the web gate set is green.

### T9: Contrast, keyboard, and full regression pass

**Depends on:** T8

**Tests:**
- Computed contrast for every text/background and component/background pair on the Tasks screen and `/focus` in both themes (AC41 for `/focus`; the Tasks screen under the web-ui-redesign bar); keyboard pass over both screens; full gates — `docker compose exec api pytest`, `docker compose exec api ruff check .`, and in `apps/web` `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` — plus `curl -f http://localhost/healthz` after `docker compose up -d --build` (AC42).

**Done when:** the audit is recorded in the qa-log with no failing pair and every gate is green.

### T10: Guide, architecture reference, and changelog updated

**Depends on:** T9

**Tests:** goal-based — the destinations in the Durable-output map exist and mention the items named there. For each of `docs/specs/walking-skeleton/spec.md` and `docs/specs/web-ui-redesign/spec.md`, `tr -s ' \n' ' ' < <spec> | grep -oE 'only place the numbers may be changed|POST /tasks/\{task_id\}/sessions|enforced entirely client-side|passed as props into the timer UI|pomodoro-(cycle|durations)\.test|timer start/stop/complete, session recording|Tasks\+Timer|\(auth, task management, timer, session recording, analytics\)|\(`PomodoroTimer`, `TaskForm`|Preserve every existing Server Action call'` prints nothing (whitespace is normalized first, so passages wrapped across lines are caught; amended text points at this spec instead of restating the removed behavior). `grep -n active_timers docs/architecture/overview.md` is non-empty.

**Approach:** amend the walking-skeleton and web-ui-redesign specs through their controlled-amendment paths (both are `Implementing`), re-homing the canonical 25/5/15 values to this spec; the web-ui-redesign amendment is the owner's recorded way of resolving its AC5/AC8 conflict with the timer's replacement, so T8 does not wait for that spec to ship. Update `docs/architecture/reference.md` to describe the cross-resource call: the `tasks` and `analytics` routers call `app/timer` settlement before their own queries (the analytics router already reads other resources' models).

**Done when:** the Tests above pass and a how-to page, the reference.md update, the overview.md update, the changelog entry, and the walking-skeleton and web-ui-redesign amendments are in the repository.

## Rollout

- **Delivery:** single PR (or a stack following the task order). The migration adds columns with defaults and a new table; rollback is `alembic downgrade` plus reverting the web build. Removing the sessions route is a breaking API change with one in-repo caller (the web app), shipped in the same release.
- **Infrastructure:** `docker-compose.yml` passes `POMODORO_TEST_SHORT_INTERVALS` to the `api` service and stops passing it to `web`. No new services.

## Risks

- **Concurrency of settlement:** a missed lock would double-record sessions; mitigated by the row lock and the concurrent-read test in T3.
- **Clock skew between server and browser:** mitigated by `server_time` in every timer response.
- **Migration on real data:** mitigated by the seeded-old-rows round-trip test in T1.

## Changelog

- 2026-10-19: spec approved by project owner
- 2026-10-19: plan approved by project owner
