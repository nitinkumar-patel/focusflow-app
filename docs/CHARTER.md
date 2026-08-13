# Charter

> The foundational document for this project. One page, read whole.
> Modeled on the [CNCF project charter pattern](https://contribute.cncf.io/maintainers/governance/charter/):
> mission, scope, and principles in a single place, kept stable and short.

Changes to this file go through an RFC. The rest of the docs in this repo
are scaffolding around it; this file is the why.

---

## Mission

FocusFlow helps someone using the Pomodoro Technique keep their tasks and
their focus-time history in one place, instead of a bare timer app and a
separate to-do list with no link between them.

## Scope

What this project does:

- Task creation and management (create, edit, complete, delete).
- A Pomodoro timer that runs against a specific task and records
  completed sessions.
- Lightweight analytics on focus time — per task, and over time.
- Single-user accounts so a person's tasks and history persist.
- A self-hosted, Dockerized deployment an end user can stand up themselves.

What this project does **not** do:

- Team or collaboration features — shared tasks, admin roles, multi-user
  workspaces. FocusFlow is single-player by design.
- Native mobile apps — web only.
- Third-party integrations — no calendar sync, Slack, Jira, etc.
- Gamification — no badges, streaks, or social/competitive features.

The "does not" list is at least as important as the "does" list. It's how
we — and AI agents working in the repo — know when a request is out of
bounds. If you find the project being asked to do things that aren't on
either list, that's a signal to refine this section, not to drift.

## Principles

The values that resolve ties when reasonable people disagree.

1. **Single-purpose over general-purpose.** FocusFlow does one thing —
   Pomodoro-based task focus tracking. When a request pulls toward a
   general project-management tool, that's a signal to say no, not to
   generalize.
2. **Self-hostable stays self-hostable.** Every component runs in Docker
   and the whole stack comes up with one `docker compose` command. A
   feature that requires a managed cloud service as a hard dependency
   needs an ADR before it lands.
3. **The browser only ever talks to the web app.** FastAPI and Postgres
   are never exposed to the public network — Next.js is the sole
   backend-for-frontend. See [ADR-0001](adr/0001-tech-stack.md).
4. **Boring, obvious solutions win.** Prefer the well-understood library
   or pattern over the clever one; see `AGENTS.md`.
5. **Analytics stay lightweight and factual.** Focus-time numbers, not
   gamified scores — this keeps the "does not do gamification" boundary
   honest as the analytics surface grows.

## What's NOT in this charter

To keep this file from becoming everything-and-the-kitchen-sink:

- **Decision history** lives in [`adr/`](adr/). The charter is what we
  believe; ADRs are the choices we made because of those beliefs.
- **Current product state** lives in [`product/`](product/). The charter
  is direction; product/ is where we are.
- **Current architecture state** lives in [`architecture/`](architecture/).
- **Conventions for how we work** live in [`CONVENTIONS.md`](CONVENTIONS.md).
- **Governance** (roles, decision-making processes, voting) lives in
  [`GOVERNANCE.md`](GOVERNANCE.md) if and when the project is large
  enough to need it. Most small/medium projects don't — a single
  maintainer or small group operating by consensus is fine, and forcing
  governance ceremony on a project that doesn't need it produces theater,
  not clarity.

## When to revise

Revise this charter when:

- The mission has actually changed (rare — usually means a fork).
- The scope has shifted enough that PRs are routinely landing for things
  the current scope doesn't cover.
- A principle has stopped resolving ties — it's being ignored, or it
  contradicts another principle in ways we haven't acknowledged.

Revise via RFC. Editing the charter directly without discussion is the
single fastest way to lose the trust this document is meant to build.
