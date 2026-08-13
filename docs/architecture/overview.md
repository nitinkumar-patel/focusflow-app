# Architecture Overview

> The map of this monorepo. Read this first when exploring. Updated whenever
> the directory layout or major dependencies change.

## Layout

```
.
├── AGENTS.md             # canonical agent context (CLAUDE.md is a symlink)
├── apps/                 # deployable applications
│   └── <app-name>/       # one directory per app
├── packages/             # shared libraries (consumed by apps and other packages)
│   └── <package-name>/
├── tools/                # build, dev, and ops tooling — not shipped to users
├── docs/
│   ├── CHARTER.md        # mission, scope, principles (one page)
│   ├── CONVENTIONS.md    # how we work
│   ├── adr/              # architecture decisions (frozen history)
│   ├── rfc/              # proposals (governance)
│   ├── specs/            # feature specs and plans
│   ├── architecture/     # this directory — current code structure (for contributors)
│   ├── product/          # current product state (roadmap, changelog) — for maintainers
│   └── guides/           # user-facing docs (Diátaxis: tutorials, how-to, reference, explanation)
├── .claude/
│   ├── skills/           # agent workflows for repeating tasks (each skill owns its templates under `assets/`)
│   ├── agents/           # subagent definitions
│   └── commands/         # custom slash commands
└── .github/              # CI, issue and PR templates
```

## Apps and packages

- `apps/web/` — the public-facing web app (Next.js App Router, TypeScript,
  Tailwind). Talks to `apps/api/` server-side only (Server Actions / Route
  Handlers act as the backend-for-frontend). Owns auth session management
  via NextAuth. Entry point: `app/page.tsx`.
- `apps/api/` — the FastAPI backend (Python 3.13). Owns all persisted data
  (`users`, `tasks`, `pomodoro_sessions`) via SQLAlchemy + Alembic against
  PostgreSQL. Not reachable from the browser — only `apps/web` calls it,
  over the internal Docker network. Entry point: `app/main.py`.
- `apps/nginx/` — reverse-proxy config + Dockerfile. The only component
  that publishes a port to the host.
- `packages/` — empty for now. `web` and `api` don't share code across the
  language boundary; introduce a shared package only when a real
  duplication shows up.

See [ADR-0001](../adr/0001-tech-stack.md) for why this stack and topology,
and [`reference.md`](reference.md) for the normative golden path new code
conforms to.

## Conventions you'll see across packages

- Every app has its own `AGENTS.md` describing app-specific rules once
  real code lands (package-level conventions, not yet needed while the
  skeleton is being built).
- The browser never calls `apps/api/` directly — every API call is
  proxied through a `apps/web/` Server Action or Route Handler.
- Every schema change to `apps/api/` ships with an Alembic migration in
  the same PR.

## Where to start

1. Read [`docs/CHARTER.md`](../CHARTER.md) — the project's mission and scope.
2. Read this file (architecture overview) and
   [`reference.md`](reference.md) — the normative golden path.
3. Read [ADR-0001](../adr/0001-tech-stack.md) for why this stack.
4. Skim [`docs/product/roadmap.md`](../product/roadmap.md) for current direction.
5. Pick a feature in `docs/specs/` and read its `spec.md` and `plan.md`
   side by side with the resulting code in `apps/`.
