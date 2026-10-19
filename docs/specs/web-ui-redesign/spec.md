# Spec: Web UI redesign & theming

- **Status:** Approved <!-- Draft | Approved | Implementing | Shipped | Archived -->
- **Owner:** project owner
- **Plan:** [`plan.md`](plan.md)
- **Constrained by:** ADR-0001 (tech stack), `docs/architecture/reference.md`
- **Brief:** none
- **Discovery:** none
- **Contract:** none — presentation-layer only, no API/contract surface touched
- **Shape:** ui

> **Spec contract:** this document defines what "done" means. The implementing
> PR must match this spec, or update it. Verification must be derivable from it.

## Objective

FocusFlow's self-hosting single user gets a web app that looks and feels
like a finished product instead of unstyled default HTML: every screen —
Tasks with the Pomodoro timer, Analytics, Login, and Signup, plus the
shared nav/layout chrome — uses a coherent, clean, modern visual design
built on Tailwind CSS utility classes and a small set of shared design
tokens. The user controls light vs. dark theme with a visible toggle;
their choice persists across reloads and sessions, and the app never
flashes the wrong theme on first paint. Every existing functional
behavior (auth, task management, timer, session recording, analytics)
keeps working exactly as it does today — this is a presentation-layer
change, not a behavior change.

## Boundaries

### Always do

- Style exclusively with Tailwind CSS v4 utility classes and the shared
  `@theme` tokens in `apps/web/app/globals.css` — no CSS-in-JS, no new
  CSS framework, no inline `style` attributes.
- Implement the theme toggle with plain React state/Context +
  `localStorage`, plus a small blocking inline script in
  `apps/web/app/layout.tsx` that applies the persisted (or
  system-preferred) theme class to `<html>` before first paint — no new
  npm dependency (`next-themes` or equivalent).
- Cover every in-scope surface consistently: `app/layout.tsx`,
  `app/(app)/layout.tsx`, `app/(app)/tasks/page.tsx`,
  `app/(app)/analytics/page.tsx`, `app/(auth)/login/page.tsx`,
  `app/(auth)/signup/page.tsx`, and their component trees
  (`PomodoroTimer`, `TaskForm`, `TaskList`, `FocusTimeChart`,
  `LoginForm`, `SignUpForm`, `LogoutButton`).
- Preserve every existing Server Action call, data-fetching path, and
  accessibility semantic (e.g. `role="alert"` on error states) — only
  markup/classes change, not component logic or wiring.
- Meet WCAG 2.2 AA contrast in both themes and keep every interactive
  control (including the new theme toggle) keyboard-operable.

- Preserve every behavior an existing test asserts (component tests
  under `apps/web`, `apps/api` tests) — a test's selectors may change
  when markup changes, provided the asserted observable behavior is
  identical and the change is recorded in the commit message; the
  behavior itself never changes as a side effect of restyling.
- Treat the global theme toggle as layout chrome, not a screen's
  "primary action" — walking-skeleton spec's AC13 (one primary,
  verb-labelled action control per screen) exempts the authenticated
  shell's nav/"Log out" chrome by name but is silent on unauthenticated
  screens; this spec keeps that AC intact by design (the toggle lives
  in the same root-layout chrome band as the app title, the same class
  of control AC13 already exempts elsewhere — not competing with "Log
  in"/"Sign up" as the screen's stated primary action) and confirms it
  holds as part of T7's manual QA pass rather than editing
  walking-skeleton's spec. Note: the toggle does carry an accessible
  `aria-label` for screen-reader users (AC7) — the chrome argument
  rests on its role and placement, not on withholding a name from it.

### Ask first

- Adding any new npm dependency beyond what's already in
  `apps/web/package.json`.
- Any change to a component's or page's responsibilities beyond styling
  (moving Server Action logic, changing what data is fetched or when).
- Deviating from Tailwind CSS as the styling mechanism.
- Editing `docs/specs/walking-skeleton/spec.md` for any reason — if the
  theme-toggle-as-chrome reading above turns out not to hold, that's a
  cross-spec change outside this spec's boundaries.

### Never do

- Add a component-library or theming dependency (shadcn, Radix, MUI,
  styled-components, `next-themes`) — hand-rolled, utility-first only,
  per explicit user decision (2026-08-24).
- Touch `apps/api`, `docker-compose.yml`, or `apps/nginx/nginx.conf` —
  this spec is web-presentation-layer only.

## Testing Strategy

Every manual / visual QA pass below is recorded in
`docs/specs/web-ui-redesign/qa-log.md` (same artifact convention as
`docs/specs/walking-skeleton/qa-log.md`) — the observed result, not
just "looks good," per `work-loop`'s verification-modes contract.

- **Theme resolution and persistence** (read a stored preference or
  fall back to OS preference; toggling flips and persists the choice):
  TDD — a compressible contract (given a stored value or none, resolve
  the active theme; given a toggle, flip and persist it), testable
  headlessly against `jsdom`'s `localStorage`, a stubbed
  `matchMedia`, and `document.documentElement`.
- **No flash of the wrong theme on first paint** (AC1): goal-based —
  the anti-flash inline script exists in the root layout, runs before
  hydration, and sets the theme class synchronously (checked against
  the built app's served HTML — `next build` + `next start`, not just
  the JSX source — confirming the script actually survives into what a
  browser receives). Manual QA, both with
  `localStorage` cleared under each OS `prefers-color-scheme` setting
  (the actual AC1 scenario — a first-time visitor) and, separately,
  with `localStorage` pre-seeded to a theme opposite the OS preference
  (the stored-choice-overrides-OS scenario) — each combination its own
  recorded qa-log line, confirming no visible flash in any case.
- **Theme toggle control and persistence across the whole app** (AC2,
  AC3): a component test for the toggle-and-persist mechanics, plus a
  manual QA pass recording that toggling on one screen changes every
  in-scope screen without reload, and that the choice survives both a
  page reload and a fresh browser session (new tab, `localStorage`
  intact) — the reload case and the new-session case are each their
  own recorded qa-log line, not implied by one another.
- **Visual redesign as a coherent design** (AC8): visual / manual QA —
  each in-scope screen reviewed in both themes, recorded in the
  qa-log; a goal-based absence check (no inline `style` attribute
  anywhere under `apps/web/app` or `apps/web/components`, and
  `app/globals.css` contains no rule beyond what AC6 permits) as a
  supporting, automatable check for AC6's mechanical half.
- **Contrast and focus visibility** (AC4): goal-based — every
  text/background and UI-component/background pair *as actually
  rendered* on each in-scope screen (not only the token palette in the
  abstract — a themeable color can still land on an unthemed element,
  such as an SVG element with no explicit `fill`) is checked against
  the WCAG 2.2 AA thresholds this AC states, in both themes; every
  interactive control's focus indicator is checked against the same
  AC's non-text-contrast bar. A fixed, checkable bar, not a subjective
  read — recorded per-screen in the qa-log.
- **Existing functional behavior unchanged** (AC5): goal-based — the
  full existing `apps/web` and `apps/api` test suites stay green; this
  is a regression gate over new/adjusted tests, not fresh coverage. For
  the two components with no rendered-markup test today (`LoginForm`,
  `SignUpForm`), a rendered component test (or, at minimum, a recorded
  manual pass exercising the real failed-login/failed-signup path) is
  added so the redesign's markup changes have some check beyond the
  Server-Action-level tests, which cannot see markup.
- **Theme toggle accessibility** (AC7): goal-based — the control has an
  accessible name (`aria-label`) so an icon-only button isn't silent
  to assistive technology, exposes its state via `aria-pressed`, and is
  reachable and operable by keyboard alone (Tab, then Enter/Space).

## Acceptance Criteria

- [ ] AC1: Given a first-time visitor with no stored theme preference,
      when any page loads under each OS-level `prefers-color-scheme`
      setting (light and dark, checked separately), the app matches
      that OS setting with no visible flash of the wrong theme before
      first paint.
- [ ] AC2: Given a user on any page, when they activate the theme
      toggle (present in the shared layout chrome on both the
      authenticated app shell and the auth screens), the whole app
      switches between light and dark immediately, without a page
      reload.
- [ ] AC3: Given a user has chosen a theme via the toggle, when they
      reload the page or return in a new browser session, the chosen
      theme persists (via `localStorage`) and overrides
      `prefers-color-scheme` until the stored preference is cleared.
- [ ] AC4: Given any in-scope screen (Tasks, Analytics, Login, Signup,
      shared nav/layout), when viewed in either theme, all rendered
      text and UI components meet WCAG 2.2 AA contrast (4.5:1 normal
      text, 3:1 large text and UI components) against their actual
      background, and every interactive control shows a visible focus
      indicator meeting the same 3:1 non-text-contrast bar. These
      thresholds are this spec's canonical values — other sections
      reference this AC rather than restating the numbers.
- [ ] AC5: Given the redesign, when compared against current behavior,
      every existing functional flow — signup, login, logout, task
      creation, Pomodoro timer start/stop/complete, session recording,
      analytics rendering, and every error state — works identically;
      the full existing test suite passes (tests may be updated for new
      markup/selectors, but must assert the same observable behavior).
- [ ] AC6: Given the redesigned app, when any in-scope page's source is
      inspected, no element uses an inline `style` attribute, and
      `app/globals.css` contains no rule beyond `@import "tailwindcss"`,
      the token definitions (`:root`/`.dark`), the `@theme` block, and
      the dark custom variant — all other styling routes through
      Tailwind utility classes.
- [ ] AC7: Given the theme toggle control, when operated via keyboard
      alone (Tab to focus, Enter/Space to activate) or inspected by
      assistive technology, it is reachable, operable, exposes an
      accessible name (e.g. `aria-label="Toggle theme"`), and exposes
      its current state via `aria-pressed`.
- [ ] AC8: Given each in-scope screen (Tasks+Timer, Analytics, Login,
      Signup, shared header/nav), when reviewed in both themes, the
      result is recorded in `qa-log.md` as a coherent, intentional
      visual design (consistent spacing, type scale, and color use
      drawn only from the shared token set) — not the current unstyled
      default HTML.

## Assumptions

- Technical: frontend stack is Next.js 16.3.1 (App Router) + React
  19.2.8 + TypeScript + Tailwind CSS v4, CSS-first config with no
  `tailwind.config.js` (source: `apps/web/package.json`;
  `docs/architecture/reference.md` § Constraints).
- Technical: no *user-controllable* theming exists yet — no
  `next-themes`, no `ThemeProvider`, no `localStorage` usage anywhere
  in `apps/web` (source: grep across `apps/web/app`, `components`,
  `lib` — zero matches). `apps/web/app/globals.css` does have an
  OS-driven `@media (prefers-color-scheme: dark)` block from the
  default `create-next-app` boilerplate — this spec's theme system
  replaces it (JS-resolved, class-based) rather than layering on top
  of it (source: `apps/web/app/globals.css:15-20`).
- Technical: no component library (shadcn/Radix/MUI) is installed or
  named — ADR-0001's Decision names only "Styling: Tailwind CSS"
  (source: `apps/web/package.json` deps; `docs/adr/0001-tech-stack.md`).
- Technical: test stack is vitest + `@testing-library/react` + jsdom,
  tests colocated with source (source: `apps/web/package.json`;
  `docs/architecture/reference.md` § Testing standards).
- Product: FocusFlow is single-player/single-tenant by design — no
  multi-user theme-sharing or org-level settings to consider (source:
  `docs/CHARTER.md`: "FocusFlow is single-player by design").
- Product: scope is the whole web app — Tasks+Timer, Analytics,
  Login/Signup, and shared layout/chrome — with a user-toggleable,
  persisted light/dark theme and a "clean and modern" aesthetic, agent's
  creative latitude on visual direction (source: user confirmation
  2026-08-24).
- Process: single-maintainer/consensus governance, no formal review
  board (source: `docs/CHARTER.md`).
- Process: this qualifies for `work-loop` full mode — two risk triggers
  fire: "Structural or public-interface change" (new design tokens,
  the repo's first shared React Context provider) and "Multi-feature or
  dependent tasks" (T1-T9 form a dependency chain) (source: `AGENTS.md`
  risk-triggers block).
- Technical/Process: the theme toggle is hand-rolled (React context +
  `localStorage` + a blocking inline anti-flash script) rather than
  adding a new dependency such as `next-themes` — ADR-0001 doesn't name
  a theming library, so this was an explicit ask-first decision (source:
  user confirmation 2026-08-24).
- Technical: `apps/nginx/nginx.conf`'s current `Content-Security-Policy`
  (added by the walking-skeleton spec's round 16, `base-uri 'self';
  form-action 'self'; frame-ancestors 'none'`) has no `script-src`
  directive, so it doesn't block the inline `dangerouslySetInnerHTML`
  anti-flash script this spec adds — a future `script-src` addition
  would break AC1's flash-prevention, but `nginx.conf` is out of this
  spec's Never-do (source: `apps/nginx/nginx.conf`; the installed
  Next.js docs bundle names this exact CSP coupling —
  `apps/web/node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`).
- Product/Design: no grounded aesthetic-direction document exists in
  this repo, and the `creative-direction`/`design-review` skills aren't
  installed in this environment — "clean and modern" is the
  implementing agent's own designer's-choice interpretation (spacing,
  type scale, palette, component shapes), with no external reference to
  check it against (source: repo search for `# Aesthetic direction:`
  returned nothing; skill roster at spec-authoring time).
