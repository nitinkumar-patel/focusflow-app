# Brief: FocusFlow

- **Slug:** `focusflow`
- **Received:** 2026-08-13
- **Owner:** <unassigned — single-maintainer project>
- **Status:** Draft

## Outcome

People who use the Pomodoro Technique to structure their work today juggle
a plain timer app and a separate task list (or a notebook) with no link
between the two — so they can't see where their focused time actually
went. FocusFlow gives a user one place to create tasks, run a Pomodoro
timer against a specific task, and see lightweight analytics on their
focus time per task and over time — a single-purpose tool, not a general
project-management app.

## Scope / Non-goals

**In scope:**

- Task creation and management (create, edit, complete, delete).
- A Pomodoro timer (work/break intervals) that runs against a selected
  task and records completed sessions.
- Lightweight analytics: focus time per task, and focus time over time
  (e.g. daily/weekly totals).
- Single-user accounts (sign up, log in) so a user's tasks and history
  persist across sessions.

**Non-goals:**

- Team/collaboration features — shared tasks, admin roles, multi-user
  workspaces. FocusFlow is single-player.
- Native mobile apps (iOS/Android) — web only for the MVP.
- Third-party integrations — no calendar sync, Slack, Jira, etc.
- Gamification — no badges, streaks, or social features beyond the plain
  focus-time analytics.

## Appetite

A few weeks, not a quarter. If any in-scope item turns out to need
infrastructure beyond a standard web app + database + auth (e.g. real-time
sync, a mobile app, a third-party integration), that's a signal to cut it
to a follow-up brief rather than absorb it here.

## Rabbit holes

- **Team/collaboration features** — shared tasks, admin roles, multi-user
  workspaces. Out of bounds; FocusFlow is a single-player tool by design.
- **Native mobile apps** — do not start an iOS/Android app; ship web-only
  first.
- **Third-party integrations** — calendar sync, Slack, Jira, etc. are all
  out of bounds for this brief.
- **Gamification / streaks** — badges, streaks, social/competitive
  features are out of bounds; analytics stay plain and factual.

## Spec map

<!-- No stories (Shape A): one row per derived spec, coverage is spec-granular.
Populated by receive-brief during decomposition. -->

| Spec | Status |
| --- | --- |
| `walking-skeleton` | <auto> |
