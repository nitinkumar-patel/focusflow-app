# Spec: Task priority, Pomodoro estimates, and focus timer

- **Status:** Implementing <!-- Draft | Approved | Implementing | Shipped | Archived -->
- **Owner:** project owner
- **Plan:** [`plan.md`](plan.md)
- **Constrained by:** ADR-0001
- **Brief:** none
- **Discovery:** none
- **Contract:** contracts/openapi/focusflow-api.yaml
- **Shape:** mixed

> **Spec contract:** this document defines what "done" means. The implementing
> PR must match this spec, or update it. Verification must be derivable from it.
>
> **Not every section is contract.** `Agent Rules`, `Testing Strategy` and
> `Acceptance Criteria` are what a completion gate reads, and an amendment
> changes them. `Outcome`, `What Changes`, `Durable Outputs`, `Follow-ons` and
> `Assumptions` are working material: they orient a reader and an author corrects them in place
> as the work teaches, without an amendment and without a review round.

## Outcome

A FocusFlow user gives each task a priority (High, Medium, Low) and an expected number of Pomodoros (1 to 20), sees how many are completed (for example 2/4), and runs one Pomodoro at a time against a task in a dedicated focus view with a circular countdown. The Pomodoro Technique cadence — 25-minute work, 5-minute short break, 15-minute long break after every 4th completed Pomodoro — is tracked by the server, so one user can never have two timers running, and a reload or second tab shows the same countdown.

## What Changes

- Tasks carry `priority` and `estimated_pomodoros`, and the task list reports `completed_pomodoros` and orders by priority — `apps/api` models, migration, `/tasks` routes.
- A per-user active timer (work, short break, or long break) is stored and settled by the server — new `active_timers` table and `/timer` routes in `apps/api`.
- Completed work intervals are recorded by the server when a work phase ends; the client-posted `POST /tasks/{task_id}/sessions` route is removed — `apps/api` tasks router and contract.
- Task creation form gains priority and estimate inputs; the task list shows priority, `completed/estimated`, and which task is running — `apps/web` Tasks screen.
- A dedicated focus view with a circular countdown, phase label, and cycle position replaces the inline timer on the Tasks screen — new `apps/web` route `/focus`.
- The OpenAPI contract describes the new fields and routes — `contracts/openapi/focusflow-api.yaml`.

## Durable Outputs

| Semantic role | Applicability | Destination | Owner | Expected evidence | Closeout condition |
| --- | --- | --- | --- | --- | --- |
| Interface compatibility | Public API gains `/timer` routes and task fields, and loses the sessions route | `contracts/openapi/focusflow-api.yaml` | implementing task | contract diff reviewed against the routes | contract matches the routers |
| Current architecture | New table and server-owned timer settlement are new building blocks | `docs/architecture/reference.md` (Building-block view) | implementing task | updated section | section names the timer module and `active_timers` |
| User promise / how-to | Users plan tasks with estimates and run the timer | `docs/guides/how-to/` (new how-to) | implementing task | guide page | guide covers priority, estimates, focus view, breaks |
| Governing spec | The walking-skeleton spec (Implementing) pins the cadence values (AC5), the sessions route (AC6), client-side breaks, and the override as UI props; this spec re-homes them | `docs/specs/walking-skeleton/spec.md` | implementing task | walking-skeleton text on cadence values, the sessions route, client-side breaks, and the override no longer contradicts this spec | no walking-skeleton text contradicts this spec |
| Governing spec | The web-ui-redesign spec (Implementing) AC5 and AC8, the Objective, and the Always-do Boundaries (component list naming `PomodoroTimer`, and the rule to preserve every existing Server Action call) keep the inline timer and client-side session recording in place, which this spec replaces | `docs/specs/web-ui-redesign/spec.md` | implementing task | AC5, AC8, the Objective, and the Boundaries amended to point at the focus view and server-recorded sessions | no web-ui-redesign text contradicts this spec |
| Current architecture | The overview names the API's tables | `docs/architecture/overview.md` | implementing task | table list includes `active_timers` | overview names `active_timers` |
| Release history | User-visible change | `docs/product/changelog.md` | implementing task | changelog entry | entry present |

## Agent Rules

### Always do

- Keep every browser-to-API call behind a Next.js Server Action or Route Handler, with the user id taken only from the validated session (ADR-0001, walking-skeleton AC16).
- Enforce the single active timer, the 25/5/15-minute durations and the settlement rules in `apps/api`; the web app displays server state and never decides cadence.
- Ship every schema change with an Alembic migration whose upgrade and downgrade both run.
- Style with Tailwind and the shared design tokens (AC41 owns the contrast bar).

### Ask first

- Any change to the 25/5/15-minute durations, the four-Pomodoro long-break cadence, or the 1–20 estimate bound.
- Any change to the `POMODORO_TEST_SHORT_INTERVALS` QA override beyond moving its reader from `apps/web` to `apps/api` (AC49, AC50).
- Adding a new npm or Python dependency.
- Adding task editing, deletion, completion states, or reminders (see Follow-ons).

### Never do

- Never trust a client-supplied duration, start time, or session record; the server derives them from the stored timer.
- Never add a new top-level module boundary, service, or background worker; settlement happens inside request handling.
- Never edit or delete existing `pomodoro_sessions` rows in the migration.

## Testing Strategy

- **Cadence and settlement rules (which phase follows which, session recording, long break every 4th):** TDD — pure rules with a compressible invariant, driven through the API with a controllable clock.
- **Single active timer and concurrency (one winner under simultaneous starts; one session under concurrent settlement):** TDD at the API level against a real Postgres, because the guarantee comes from a database constraint.
- **Task fields, validation, ordering, completed counts, migration:** TDD (API tests), plus a goal-based `alembic upgrade`/`downgrade` run against a database seeded with old rows.
- **Contract:** goal-based — the OpenAPI file is checked against the routers' response shapes.
- **Tasks screen and focus view rendering, form wiring, running-task indicator:** component tests where logic exists; visual / manual QA in a real browser, both themes, for the circular timer, phase transitions, reload behavior, and layout at 400px.

## Acceptance Criteria

AC5, AC11, AC13, and AC20 state default durations and hold with `POMODORO_TEST_SHORT_INTERVALS` unset or empty (AC49).

- [ ] AC1: `POST /tasks` stores `priority` (`high`, `medium`, or `low`; default `medium`) and `estimated_pomodoros` (integer 1–20; default 1) with the task.
- [ ] AC2: `POST /tasks` answers 422 for a `priority` outside the three values and for an `estimated_pomodoros` outside 1–20.
- [ ] AC3: `GET /tasks` returns for each task `priority`, `estimated_pomodoros`, and `completed_pomodoros` equal to the number of that task's recorded work sessions.
- [ ] AC4: `GET /tasks` orders tasks `high`, then `medium`, then `low`, newest first within a priority.
- [ ] AC5: `POST /timer/start` with the caller's task id and no active timer answers 201 with phase `work` and a 1500-second duration.
- [ ] AC6: `POST /timer/start` while the caller has an active timer in any phase answers 409 and the request itself changes nothing: the stored timer is whatever settlement (AC11, AC45) left, with no new timer inserted.
- [ ] AC7: Two simultaneous `POST /timer/start` requests from one user produce exactly one 201 and one 409.
- [ ] AC8: `POST /timer/start` with a task id that does not exist or belongs to another user answers 404 and stores no timer.
- [ ] AC9: `GET /timer` returns the active timer's task id, phase, start time, end time, remaining seconds, server time, and a cycle position equal to the `n` of AC34 for the caller's recorded session count.
- [ ] AC10: `GET /timer` returns `null` when the caller has no active timer.
- [ ] AC11: Every timer route (`GET /timer`, `POST /timer/start`, `POST /timer/stop`), `GET /tasks`, and `GET /analytics/focus-time`, on seeing a work phase whose end time has passed, records exactly one session for that phase with `ended_at` equal to its start plus 1500 seconds.
- [ ] AC12: Reading an elapsed work phase repeatedly or concurrently records its session once.
- [ ] AC13: After a work phase settles, the timer is a 300-second `short_break`, unless the caller's recorded session count is a multiple of 4, in which case it is a 900-second `long_break`.
- [ ] AC14: When a break phase has elapsed, the next timer route removes the timer, so the caller can start a new one.
- [ ] AC15: `POST /timer/stop` during a work phase whose end time has not passed removes the timer and records no session.
- [ ] AC16: `POST /timer/stop` after a work phase's end time has passed records that phase's session, then removes the timer that settlement produced.
- [ ] AC17: `POST /timer/stop` during a break phase removes the timer.
- [ ] AC18: `POST /timer/stop` with no active timer answers 404.
- [ ] AC19: `POST /tasks/{task_id}/sessions` does not exist (the route answers 404 or 405).
- [ ] AC20: After one work phase settles for task T, `GET /analytics/focus-time` reports 25 more minutes for T in `by_task` and 25 more minutes on the UTC date of the phase's start in `by_day`.
- [ ] AC21: `alembic upgrade head` on a database holding pre-existing tasks gives each task priority `medium` and estimate 1.
- [ ] AC22: `alembic upgrade head` on a database holding pre-existing sessions leaves every `pomodoro_sessions` row unchanged.
- [ ] AC23: `alembic downgrade` back one revision removes the new task columns and the `active_timers` table.
- [ ] AC24: `alembic downgrade` back one revision leaves every `pomodoro_sessions` row unchanged.
- [ ] AC25: `contracts/openapi/focusflow-api.yaml` documents the new task fields, the `/timer` routes with their 404 and 409 responses, and omits the sessions route.
- [ ] AC26: Given the Tasks screen, the create form offers a priority choice and an expected-Pomodoros input, each with a visible label.
- [ ] AC27: Given an out-of-range estimate on the create form, the user sees an error in a `role="alert"` element.
- [ ] AC28: Given tasks, each row shows its priority label and `completed/estimated`, in the order of AC4.
- [ ] AC29: Given a timer in any phase (work, short break, long break), the Tasks screen marks that task's row as in progress.
- [ ] AC30: Given a timer in any phase, the Tasks screen disables every other row's start control.
- [ ] AC43: Given a timer in any phase, the Tasks screen shows beside each disabled start control text naming the running task.
- [ ] AC31: Given no active timer, when the user opens `/focus`, the user sees an empty state with a link to Tasks.
- [ ] AC32: Given an active timer, `/focus` shows a circular progress ring whose filled fraction equals elapsed time over the phase duration.
- [ ] AC33: Given an active timer, `/focus` shows the remaining time as mm:ss, the phase name (Focus, Short break, Long break), and the task title.
- [ ] AC34: Given a recorded session count `c`, `/focus` shows "Pomodoro n of 4" with `n = (c mod 4) + 1` during a work phase and `n = ((c - 1) mod 4) + 1` during a break phase.
- [ ] AC35: Given a work phase, when its remaining time reaches zero, `/focus` shows the break phase without a manual reload.
- [ ] AC44: Given a break phase, when its remaining time reaches zero, `/focus` shows the empty state of AC31 without a manual reload.
- [ ] AC36: Given an active timer, a reload or a second tab on `/focus` shows the same remaining time to within 2 seconds.
- [ ] AC37: `/focus` has exactly one primary control, labelled "Stop" during work and "Skip break" during a break.
- [ ] AC38: Every interactive control on `/focus` is keyboard-operable and shows a visible focus indicator with at least 3:1 contrast against its background.
- [ ] AC39: The per-second countdown text carries no ARIA live-region role.
- [ ] AC40: Each phase change on `/focus` is announced once through a polite live region.
- [ ] AC41: Every text and UI-component pair on `/focus` meets WCAG 2.2 AA contrast in both themes, by the thresholds of web-ui-redesign AC4.
- [ ] AC45: Every timer route settles all elapsed phases before acting, so `POST /timer/start` after a break has elapsed answers 201.
- [ ] AC46: `POST /timer/stop` after a break has elapsed answers 404.
- [ ] AC47: A break that follows a settled work phase has `started_at` equal to that work phase's `ended_at`.
- [ ] AC48: A single read after an absence spanning several phases records one session per elapsed work phase.
- [ ] AC49: With `POMODORO_TEST_SHORT_INTERVALS` unset or empty, phase durations are 1500, 300, and 900 seconds for work, short break, and long break.
- [ ] AC50: With `POMODORO_TEST_SHORT_INTERVALS` set, phase durations are 60, 15, and 30 seconds.
- [ ] AC42: The `apps/web` and `apps/api` test suites, `ruff check`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass.

## Follow-ons

- project owner: add task editing (priority, estimate, title) and deletion — future spec via work-intake.
- project owner: add task completion states and break/phase-end notifications — future spec via work-intake.

## Assumptions

- Product: a Pomodoro counts as completed only when its 25-minute work phase finishes; an early stop discards it — assumed from the owner's brief; changing it alters AC15 and AC16 (settled by: project owner).
- Product: the long break follows the user's every 4th recorded session overall, not a per-day or per-task cycle — assumed; a per-day cycle would change AC13 and AC34 (settled by: project owner).
- Technical: the web-ui-redesign spec reaches Shipped before or with this work, since the new views use its tokens — if not, AC41 is ungrounded (settled by: project owner).
