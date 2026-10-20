# Plan: Web UI redesign & theming

- **Spec:** [`spec.md`](spec.md)
- **Status:** Executing <!-- Drafting | Approved | Executing | Done -->
- **Repository anchors:** `docs/architecture/reference.md` § Building-block
  view (this plan adds `apps/web/lib/theme.ts` and the repo's first
  shared React Context provider as new reusable building blocks, both
  catalogued there by T9); `apps/web/lib/pomodoro-durations.ts` +
  `pomodoro-durations.test.ts` (the analogous pure-module-plus-colocated-test
  pattern this plan's `lib/theme.ts` follows); spec Boundaries §
  Never do (hand-rolled theming — no `next-themes` — is a deliberate
  deviation from the ecosystem-default approach, not an oversight).

> **Plan contract:** this is the implementation strategy. Unlike the spec, this
> document is allowed to change as you learn. When it changes substantially
> (a different approach, not just a re-ordering), note why in the changelog
> at the bottom.

## Approach

Build the theme system bottom-up, then redesign screens top-down. First
lay the foundation everyone else depends on: design tokens (light/dark
CSS custom properties driving Tailwind v4's `@theme` + a class-based
`@custom-variant dark`), a small pure theme-state module, and the
provider/toggle/anti-flash wiring in the root layout — all before any
screen's visual redesign starts, so every later task styles against a
stable token set instead of hardcoded colors. Then redesign the shared
layout chrome (nav, header, toggle placement), then each screen
(Tasks+Timer, Analytics, Login/Signup) in parallel-safe order, then a
closing contrast/accessibility audit and full regression pass.

The riskiest part is `PomodoroTimer.tsx`: its existing test suite
(`PomodoroTimer.test.tsx`) queries by accessible name/role (`"start
focus session"`, `"stop"`, text matching `/Focus:/`, `/Short break:/`,
`/Long break:/`) — the redesign must keep those exact visible
strings/roles intact, restyling markup around them rather than renaming
or restructuring the accessible surface. Every other in-scope component
(`TaskForm`, `TaskList`, `LoginForm`, `SignUpForm`, `FocusTimeChart`) has
no dedicated component test today, so their redesign risk is lower —
regression coverage there comes from the Server-Action tests
(`tasks/actions.test.ts`, `login/actions.test.ts`,
`signup/actions.test.ts`), which don't touch rendered markup at all.

No backend, contract, or infra changes anywhere in this plan, and every
*code* change stays inside `apps/web` (round-7 pre-EXECUTE REVIEW
finding: T9 registers the new building blocks in
`docs/architecture/reference.md` and `docs/specs/README.md`, and every
manual-QA task records its result in
`docs/specs/web-ui-redesign/qa-log.md` — both under `docs/`, not code).

## Constraints

- ADR-0001 (`docs/adr/0001-tech-stack.md`): styling is Tailwind CSS: no
  swap to a different CSS framework or component library.
- `docs/architecture/reference.md`: Next.js (App Router) + TypeScript is
  the frontend stack; a Next.js *Server Action or Route Handler* is the
  only place allowed to call FastAPI — this plan touches no such call
  site, only presentation.
- Spec Boundaries § Never do: no new npm dependency for theming or
  component primitives (hand-rolled, per explicit user decision).

## Construction tests

Per-task tests live under each Task's `Tests:` subsection. Cross-cutting:

**Integration tests:** none beyond per-task tests — this plan has no
cross-service surface.
**Manual verification:** every visual/manual-QA task (T2-T8) records its
observed result — not just "looks good" — in
`docs/specs/web-ui-redesign/qa-log.md`, one entry per task, following
`docs/specs/walking-skeleton/qa-log.md`'s existing format. T8's
full-app walkthrough (both themes, every in-scope screen, real browser
via `docker compose up`) is the one cross-cutting manual pass; every
other manual QA step is scoped to its own task.

## Design (LLD)

### Component / module decomposition

New modules:
- `apps/web/lib/theme.ts` — pure functions: `resolveInitialTheme()`
  (reads `localStorage["focusflow-theme"]`, falls back to
  `window.matchMedia("(prefers-color-scheme: dark)")`), `applyTheme(theme)`
  (sets/removes the `dark` class on `document.documentElement` and
  writes `localStorage`), plus the storage-key constant. No React,
  fully unit-testable under jsdom.
- `apps/web/components/ThemeProvider.tsx` — client component, React
  Context wrapping `{children}`; holds the active theme in state via a
  **lazy `useState` initializer** (`typeof window === "undefined" ?
  <default> : resolveInitialTheme()`) — this is the pattern the
  installed Next.js docs prescribe for syncing React state with an
  inline anti-flash script (see State & control flow), not a
  post-mount effect; exposes a `toggleTheme()` used by the toggle
  control.
- `apps/web/components/ThemeToggle.tsx` — client component, a single
  icon button with an `aria-label` consuming `ThemeProvider`'s
  context; renders both light- and dark-mode icons in markup and
  picks between them with `dark:` Tailwind variants (correct from
  first paint, independent of JS/hydration timing), while
  `aria-pressed` tracks React state. Renders in the root layout's
  global header so it's present on every route (auth screens
  included), not only inside `(app)/layout.tsx`'s nav.

Reused, restyled only (no logic change): `PomodoroTimer`, `TaskForm`,
`TaskList`, `FocusTimeChart`, `LoginForm`, `SignUpForm`, `LogoutButton`,
`app/layout.tsx`, `app/(app)/layout.tsx`, and the four page files.

Traces to: AC1, AC2, AC3, AC6, AC7, AC8 · contracts: none.

### State & control flow

Theme state lives in `ThemeProvider`, mounted once in `app/layout.tsx`
above `{children}` — a single source of truth for the whole app,
including auth screens (which have no shared `(auth)/layout.tsx` today;
rather than adding one, the toggle lives in the root layout's global
header so both route groups get it for free). This follows the pattern
the installed Next.js docs bundle prescribes for exactly this problem
(`apps/web/node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`
§ Themes, § Syncing with React state, § Re-applying attributes in
development):

1. **Hard navigation / first paint:** an inline `<script>` in `<head>`
   (`dangerouslySetInnerHTML`), rendered before hydration, reads
   `localStorage` inside a `try/catch` (unavailable storage — private
   browsing, disabled cookies — must not crash the page) and falls
   back to `matchMedia` when nothing is stored, then sets the `dark`
   class on `<html>` synchronously, before first paint (AC1). `<html>`
   carries `suppressHydrationWarning` because this script-set class is
   expected to differ from React's own rendered markup for that
   element.
2. **React state, correct in the render output from the first client
   render:** `ThemeProvider` initializes its state with a **lazy
   `useState` initializer** — not a post-mount effect — that returns a
   fixed default when `typeof window === "undefined"` (the literal
   server-render pass) and otherwise calls the same
   `resolveInitialTheme()` the inline script's logic mirrors. Because
   hydration itself always runs client-side (`window` already exists
   by then), the initializer computes the *real* theme during
   hydration too — React's own re-render output (what it *would*
   render) matches the script-corrected DOM. This is **not** the same
   as the DOM's `aria-pressed` attribute being correct: per round-3
   REVIEW, React does not retroactively patch a host attribute that
   mismatched between the server HTML and the client's hydration-time
   render (`suppressHydrationWarning`, applied only to `<html>`'s
   class, doesn't extend to it) — see point 5.
3. **Dev-only Strict Mode remount:** React Strict Mode (on by default
   for the App Router; `apps/web/next.config.ts` doesn't disable it)
   remounts once in development and resets `<html>`'s attributes to
   only what JSX manages, clearing the class the inline script set —
   a dev-only gap, not present in production. `ThemeProvider` re-applies
   the theme via `resolveInitialTheme()`/`applyTheme()` (**not** a raw
   `localStorage` read — a first-time visitor with nothing stored
   needs the same `matchMedia` fallback the initializer and the inline
   script use, or the re-apply is a no-op precisely in the AC1 case) in
   a `useLayoutEffect` on mount (before paint, self-healing, a no-op
   when nothing was cleared) — the documented workaround for this
   exact failure mode.
4. **Toggling:** `ThemeToggle`'s click calls `toggleTheme()`, which
   flips state, updates the `dark` class, and persists to
   `localStorage` (wrapped in `try/catch`) — no reload, every consumer
   re-renders via context (AC2, AC3).
5. **`aria-pressed` correctness after hydration:** since point 2 only
   guarantees React's *render output* agrees with the DOM, not that
   the DOM's `aria-pressed` attribute gets patched to match,
   `ThemeToggle` separately writes `aria-pressed` **imperatively** via
   a ref in its own `useLayoutEffect` (on mount and on every theme
   change) — a direct DOM mutation always lands, regardless of what
   hydration's attribute diffing did or didn't do. Redundant with the
   JSX output in the common case; the only case it actually corrects
   is the rare one where the server default and the resolved client
   theme disagree. Runs before paint (no visible flip for a sighted
   user); an AT user polling the DOM at the exact hydration instant
   could in principle observe the stale value for a moment — an
   accepted, documented limitation (AC7).

Traces to: AC1, AC2, AC3, AC7 · contracts: none.

### Behavior & rules

- Stored preference (`localStorage`) always wins over
  `prefers-color-scheme` once set; there is no "reset to system" control
  in this spec's scope (not named in any AC — out of scope, not a gap).
- The anti-flash inline script and `lib/theme.ts`'s
  `resolveInitialTheme()` must compute the *same* value from the *same*
  inputs (localStorage, then `matchMedia`) — they're necessarily two
  separate pieces of code (the inline script runs before any JS bundle
  loads, so it can't import `lib/theme.ts`), and divergence between
  them would cause a one-frame flash even with the script in place.
  `ThemeProvider`'s lazy state initializer calls `resolveInitialTheme()`
  too, but only ever during hydration or a fresh client render — never
  during the literal server-render pass — so it computes the same
  real value the script already applied to the DOM by the time it
  runs, and the two never visibly disagree (see State & control flow).
- `resolveInitialTheme()` only trusts a stored value that is exactly
  `"light"` or `"dark"` — anything else (unset, malformed, a stale
  value from a future version) falls through to the `matchMedia`
  branch. Both the inline script and `lib/theme.ts` wrap their
  `localStorage` access in `try/catch` — a browser with storage
  disabled (private browsing, an enterprise policy) must degrade to
  the OS preference, not throw and leave the page with no theme
  applied at all.
- No component's Server Action call, data shape, accessible name, ARIA
  role, or ARIA state changes as a side effect of restyling (round-1
  pre-EXECUTE REVIEW finding: this bullet previously dropped ARIA role
  from spec Boundaries § Always do's "every ... accessibility
  semantic (e.g. `role="alert"` on error states)" — a component's
  `role="alert"` on its error element is exactly such a semantic, and
  T4/T5 restyle three of them with no test that would catch its
  removal) — a redesign that requires changing what a component *does*
  (not just how it looks) is out of this plan's scope per spec
  Boundaries § Ask first.

Traces to: AC1, AC2, AC3, AC5 · contracts: none.

### Quality attributes (NFRs)

- **Contrast and focus visibility (AC4):** thresholds are AC4's, not
  restated here. Checked in T7 per-screen, against what's *actually
  rendered* in both themes — not only the token palette in the
  abstract, since a themeable color can still land on an unthemed
  element (e.g. an SVG `<text>` with no explicit `fill`, see T5, or a
  browser-native control with no `color-scheme` hint — T1 sets
  `color-scheme: light`/`dark` on `:root`/`.dark` so scrollbars, text
  carets, autofill backgrounds, and form-control chrome — relevant on
  Login/Signup's inputs — paint in the right theme instead of always
  light).
- **Keyboard/AT operability (AC7):** `ThemeToggle` is a real `<button>`
  (not a `<div onClick>`) with an `aria-label` (it's icon-only, so it
  has no accessible name otherwise), reachable by Tab, activatable by
  Enter/Space, and exposes `aria-pressed={theme === "dark"}` so a
  screen reader announces its state.

Traces to: AC4, AC7 · contracts: none.

## Tasks

### T1: Theme tokens + pure theme-state module

**Depends on:** none

**Tests:**
- `vitest.setup.ts` (new, registered via `test.setupFiles` in
  `vitest.config.ts`): stub `window.matchMedia` to return an object
  whose `matches` is **settable per test** (e.g. a module-level
  mutable flag the stub reads, reset in each test's own setup) — jsdom
  implements no such API at all, and a single fixed-value stub would
  make one of AC1's two OS-preference branches permanently untestable.
- `lib/theme.test.ts` (`beforeEach` clears `localStorage`, removes the
  `dark` class from `document.documentElement`, and resets the
  `matchMedia` stub's `matches` to a known default — all three persist
  across cases in the same file otherwise):
  - `resolveInitialTheme()` returns `"dark"` when `localStorage` holds
    `"dark"`, `"light"` when it holds `"light"`, and — when nothing is
    stored, when the stored value is malformed/unrecognized (e.g.
    `"Dark"`, `"blue"`), or when `localStorage` access throws (simulate
    by stubbing `localStorage.getItem` to throw) — falls back to
    `matchMedia`: both the `matches: true` → `"dark"` and
    `matches: false` → `"light"` cases, exercised separately via the
    settable stub.
  - `applyTheme("dark")` adds the `dark` class to
    `document.documentElement` and writes
    `localStorage["focusflow-theme"] === "dark"`; `applyTheme("light")`
    removes the class and writes `"light"`.

**Approach:**
- `apps/web/app/globals.css`: **delete** the existing
  `@media (prefers-color-scheme: dark)` block (`globals.css:15-20`) —
  it's OS-driven and would silently override a user's explicit *light*
  choice on a dark-OS device once no code reads it anymore; theme
  resolution becomes JS-only (`lib/theme.ts` + the anti-flash script in
  T2). Replace the current `--background`/`--foreground` pair with a
  fuller token set (surface, border, primary/accent, muted-foreground,
  danger) defined twice — once under `:root` (light) and once under a
  `.dark` class selector, **written after `:root` in the file** (both
  selectors compute equal specificity, and `.dark` lands on the same
  `<html>` element `:root` matches, so whichever block is later in the
  cascade wins — order is load-bearing, not incidental) — plus
  `color-scheme: light` under `:root` and `color-scheme: dark` under
  `.dark` (so scrollbars, carets, autofill, and native form-control
  chrome paint in the right theme — see Quality attributes), plus
  Tailwind v4's
  `@custom-variant dark (&:where(.dark, .dark *));` so `dark:` utility
  classes key off the class. Extend the `@theme inline` block with a
  matching `--color-<name>: var(--<name>);` entry for **every** new
  token (`surface`, `border`, `primary`/`accent`, `muted-foreground`,
  `danger` — not only `background`/`foreground`, which are the only
  two entries the block maps today) — round-3 pre-EXECUTE REVIEW
  finding: Tailwind v4 generates a utility class (`bg-surface`,
  `fill-muted-foreground`, etc.) only from a `@theme`-declared custom
  property; a token defined solely under `:root`/`.dark` without a
  matching `@theme inline` entry compiles to no CSS at all, silently,
  with no build/lint/test failure — exactly the trap T5's `fill-*`
  fix (round 2) already assumes is closed. Also delete the
  `body` rule's `background`/`color`/`font-family: Arial` declarations
  (`globals.css:22-26`) — they load after `@import "tailwindcss"` and
  currently override Tailwind's preflight, silently defeating the
  `--font-geist-sans` variable `app/layout.tsx` already sets.
- `apps/web/app/layout.tsx`: add `bg-background text-foreground` to
  `<body>`'s `className` — the token set is otherwise defined but
  never applied anywhere (deleting the old `body` CSS rule above
  removes the only current consumer of `--background`/`--foreground`).
- `apps/web/lib/theme.ts`: implement `resolveInitialTheme()` (only
  trusts a stored value of exactly `"light"` or `"dark"`; wraps
  `localStorage` access in `try/catch`, falling back to `matchMedia`
  on any thrown error, malformed value, or nothing stored),
  `applyTheme()` (same `try/catch` discipline on the write), and an
  exported `THEME_STORAGE_KEY = "focusflow-theme"` constant (the one
  place this literal is defined — every other file that needs it
  imports the constant, not a fresh string).

**Done when:** `lib/theme.test.ts` green (including the
malformed-value and thrown-storage-access cases); `globals.css` defines
both palettes, `color-scheme`, and the `dark` custom variant, with the
old media query and the `body` rule's color/font overrides removed;
`@theme inline` carries a `--color-*` entry for every token defined
under `:root`/`.dark` (not just `background`/`foreground`);
`app/layout.tsx`'s `<body>` carries the background/foreground
utilities.

### T2: ThemeProvider, ThemeToggle, and root-layout wiring

**Depends on:** T1

**Tests:**
- Component test (`components/ThemeToggle.test.tsx`): rendering
  `ThemeProvider` + `ThemeToggle` in jsdom (a fresh client render, not
  a hydration — Testing Library's `render()` cannot exercise the
  server/hydrate path at all, so this test proves the toggle-and-persist
  mechanics and the pre-seeded-storage-on-mount value, **not** anything
  about hydration-time correctness; that's covered only by T2's manual
  browser checks below, per the round-3 REVIEW finding that a jsdom
  render can't discriminate a hydration mismatch from a correct hydrate).
  Locate the button via `getByRole("button", { name: /theme/i })` —
  pins the `aria-label` (not just `aria-pressed`) so an icon-only
  button without an accessible name would fail this query outright.
  Clicking the toggle flips `document.documentElement`'s `dark` class
  and updates `localStorage["focusflow-theme"]`; `aria-pressed`
  reflects the new state, including immediately after a fresh mount
  with `localStorage["focusflow-theme"]` pre-seeded to `"dark"`.
- Goal-based: the built app's served HTML (`next build` + `next start`,
  not just the JSX source — the check needs to confirm the script
  survives into what a browser actually receives) — round-6 pre-EXECUTE
  REVIEW finding: `dangerouslySetInnerHTML` is a React/JSX-time prop
  the server renderer consumes, never an emitted HTML attribute, so a
  served-HTML check must not search for that literal token. Stated in
  served-HTML terms instead: the response's `<head>` element (not the
  whole response) contains a `<script>` element whose inline text
  includes the `focusflow-theme` storage key (matching the constant
  `lib/theme.ts` exports), and that `<script>` element precedes
  `<body>`. Round-7 pre-EXECUTE REVIEW finding: fetch **`/login`**, not
  `/` — `apps/web/app/page.tsx` redirects at `/` (`redirect(session ?
  "/tasks" : "/signup")`), and that redirect response's body is an
  error-boundary shell that never renders the root layout's real
  `<head>` at all, while still embedding the `focusflow-theme` literal
  in its serialized RSC payload — a naive whole-response `grep` on `/`
  would false-pass against a response with no anti-flash script in
  `<head>` whatsoever. `/login` renders the full root layout and
  redirects nowhere. The served document has no line breaks, so a
  line-oriented extraction (`sed`/`awk` between `<head>`/`</head>`)
  silently degrades to matching the whole response; slice on byte
  offset instead:
  ```
  curl -sS http://127.0.0.1:3000/login | python3 -c '
  import sys, re
  html = sys.stdin.read()
  head_end = html.find("</head>")
  sys.exit(0 if head_end > 0 and re.search(
      r"<script(?![^>]*\bsrc=)[^>]*>[^<]*focusflow-theme", html[:head_end]
  ) else 1)
  '
  ```
  Exit 0 is the pass case (a `<script>` with no `src` attribute,
  containing the storage key, found before `</head>`).

**Approach:**
- `components/ThemeProvider.tsx`: Context + state, initialized with a
  **lazy `useState` initializer** —
  `useState<Theme>(() => (typeof window === "undefined" ? "light" :
  resolveInitialTheme()))` — not a post-mount effect. This makes
  React's *own* re-render output agree with the inline-script-corrected
  DOM once hydration executes (hydration always runs client-side, so
  the initializer reads the real value there too) — but per the
  round-3 REVIEW finding, React does not retroactively patch a host
  attribute that mismatched between the server HTML and the client's
  hydration-time render (`aria-pressed` in particular; the class
  attribute on `<html>` is separately covered by
  `suppressHydrationWarning`, which explicitly keeps the DOM's value).
  So `ThemeToggle`'s own `useLayoutEffect` (below) doesn't only exist
  for the Strict Mode remount — it's also what guarantees
  `aria-pressed` reflects the real theme after hydration in every
  build, dev and production alike, by writing the attribute
  imperatively rather than relying on React's hydration diff to do it.
- `components/ThemeToggle.tsx`: a real `<button>` (not a `<div
  onClick>`) with `aria-label="Toggle theme"` (icon-only, so it has no
  accessible name otherwise) and `aria-pressed` driven by
  `ThemeProvider`'s state (correct JSX-wise from the first client
  render per the initializer above). Also runs a `useLayoutEffect` on
  mount and on every theme change that **imperatively** sets
  `aria-pressed` on the button via a ref (`ref.current.setAttribute(
  "aria-pressed", String(theme === "dark"))`) — redundant with the JSX
  output in the common case, but the only way to guarantee the DOM
  reflects the true value in the one case where the server-rendered
  default and the resolved client theme disagree (see State & control
  flow); runs before paint, so no visible flip, though this is an
  accepted, documented limitation for the rare instant between
  hydration completing and this effect running. Renders *both* a
  light-mode and a dark-mode icon in markup, shown/hidden purely via
  `dark:` Tailwind variants (e.g. sun icon `dark:hidden`, moon icon
  `hidden dark:block`) — the icon is correct at first paint from CSS
  alone, with no dependency on JS having run yet, so it needs none of
  the above. Both icons are hand-authored inline `<svg>` elements
  (the idiom `FocusTimeChart.tsx:14-44` already establishes for this
  repo) — no icon package (`lucide-react`, `@heroicons/react`, etc.)
  is added; round-2 pre-EXECUTE REVIEW finding: the plan previously
  left the icon source unspecified, and the ecosystem-default reach
  for a React icon is exactly such a new npm dependency, which spec
  Boundaries § Ask first would require sign-off for. Placement: a
  small icon button in the global header, not
  a labelled "primary action" — deliberate, so it reads as chrome
  rather than competing with walking-skeleton AC13's
  one-primary-action-per-screen rule (see spec Boundaries).
- `app/layout.tsx`: add the inline anti-flash script
  (`dangerouslySetInnerHTML` on a `<script>` in `<head>`, reading the
  same localStorage-then-matchMedia logic as `resolveInitialTheme()`,
  wrapped in `try/catch` — necessarily a separate, hand-duplicated
  copy, since this script runs before any JS bundle and can't import
  `lib/theme.ts`); add `suppressHydrationWarning` to the `<html>`
  element (`app/layout.tsx:22`) — expected, since the inline script
  sets the `dark` class before React hydrates and React would
  otherwise flag that as a mismatch; wrap `{children}` in
  `ThemeProvider`; add a small global header (app title +
  `ThemeToggle`) so the toggle is present on every route, auth screens
  included.
- `ThemeProvider`'s Strict Mode re-apply effect (see State & control
  flow point 3) re-applies via `resolveInitialTheme()`/`applyTheme()`
  — the same fallback-to-`matchMedia` resolution the initializer and
  the inline script use — **not** a raw `localStorage.getItem` read.
  A raw read is a no-op for the AC1 case (no stored preference at
  all), which would leave a first-time dark-OS visitor on light mode
  after any dev Strict Mode remount, defeating the very re-apply this
  effect exists for.

**Done when:** `ThemeToggle.test.tsx` green (including the
pre-seeded-`localStorage`-on-first-render case); `npm run build`
succeeds (catches an SSR crash from touching `localStorage`/`matchMedia`
during the literal render pass, which the jsdom-only component test
can't); manual checks in a real browser, each its own qa-log line: (1)
`localStorage` cleared, under each OS `prefers-color-scheme` setting —
the app matches the OS setting with no flash (AC1's actual scenario);
(2) `localStorage` pre-seeded to a theme opposite the OS preference —
the stored choice wins, no flash; (3) `npm run dev` specifically (not
just `next build && next start`) — confirms the Strict Mode remount
doesn't drop the theme; (4) no hydration-mismatch warning in the
console in any of the above; (5) a page reload and a fresh browser tab
(same `localStorage`) both keep the chosen theme (AC3).

### T3: Redesign shared layout chrome

**Depends on:** T2

**Tests:** no stub (visual / manual QA).

**Approach:**
- Restyle `app/layout.tsx`'s global header and `app/(app)/layout.tsx`'s
  nav (Tasks/Analytics links, `LogoutButton`) with Tailwind utilities:
  consistent spacing, hover/active/focus states, responsive layout,
  using only the tokens from T1. The two bars compose as one visual
  unit on authenticated screens — the root header (app title + theme
  toggle) sits above `(app)/layout.tsx`'s nav (Tasks/Analytics links +
  Log out), styled as a single cohesive band rather than two
  separately-boxed bars; on auth screens only the root header shows,
  since `(app)/layout.tsx` doesn't wrap `/login` or `/signup`.
  `LogoutButton.tsx`'s own `<button type="submit">Log out</button>`
  (round-1 pre-EXECUTE REVIEW finding: this file is spec-in-scope and
  its unstyled default control can't be styled from either layout
  file) needs its own Tailwind classes added directly, matching the
  nav's button/link styling.

**Done when:** header and nav render with the new visual design in both
themes, composing as one visual band on authenticated screens;
`LogoutButton`'s control carries the new button styling and its
behavior is unchanged; `PomodoroTimer.test.tsx` and other existing
suites still pass (nav change doesn't touch them, but confirms no
regression from the layout wrap); recorded in the qa-log.

### T4: Redesign Tasks screen (TaskForm, TaskList, PomodoroTimer)

**Depends on:** T3

**Tests:** no stub (visual / manual QA) — plus a regression run of the
existing `PomodoroTimer.test.tsx` and `tasks/actions.test.ts`, green
throughout. Two kinds of assertion change are permitted, both recorded
in the commit message per spec AC5: a genuine visible-string rename, or
(only if a countdown re-nest proves necessary — see Approach) the three
`queryByText` assertions converted to a `data-testid` query. No other
assertion change is permitted.

**Approach:**
- Restyle `TaskForm`, `TaskList`, and `PomodoroTimer` with Tailwind
  utilities and the shared tokens. Preserve every button's accessible
  name (`"Start focus session"`, `"Stop"`) and every status string
  `PomodoroTimer.test.tsx` matches against (`/Focus:/`,
  `/Short break:/`, `/Long break:/`). Testing Library's text matcher
  reads an element's *direct child text nodes* — `PomodoroTimer.tsx`'s
  `<span>{LABELS[kind]}: {formatTime(remainingSeconds)}{" "}...</span>`
  passes today only because the label and countdown stay sibling text
  nodes of one element; wrapping them in separately styled spans would
  break the query without changing a single visible string. Restyle by
  applying classes to the existing wrapping `<span>`/`<button>`
  elements, not by re-nesting the label/countdown text into new child
  elements — if a re-nest turns out necessary for the design, convert
  those three assertions to a `data-testid` query in the same commit,
  recorded in the commit message. Do **not** add a `role="status"` (or
  any other ARIA role) as part of this fallback — round-2 pre-EXECUTE
  REVIEW finding: `PomodoroTimer.tsx:126`'s countdown carries no role
  today, and adding a live-region role to a per-second countdown
  changes what assistive technology announces — a behavior change,
  not a restyle detail, and out of this plan's scope per spec
  Boundaries § Ask first.
- Restyle `app/(app)/tasks/page.tsx`'s layout (heading, form, list,
  error state). Preserve `role="alert"` on both error elements this
  task restyles — `TaskForm.tsx`'s `<p role="alert">{state.error}</p>`
  and `tasks/page.tsx`'s `<p role="alert">{safeErrorMessage(result)}</p>`
  (round-1 pre-EXECUTE REVIEW finding: neither had an explicit
  preservation instruction, and no test would catch the role being
  dropped during a restyle).

**Done when:** `PomodoroTimer.test.tsx` and `tasks/actions.test.ts`
green; both `role="alert"` elements above still carry the role; screen
visually matches the new design in both themes, recorded in the
qa-log.

### T5: Redesign Analytics screen (FocusTimeChart)

**Depends on:** T3

**Tests:** no stub (visual / manual QA).

**Approach:**
- Restyle `FocusTimeChart` and `app/(app)/analytics/page.tsx` with
  Tailwind utilities and shared tokens. `FocusTimeChart`'s `<rect>`
  already uses `fill="currentColor"` (themeable via the wrapping
  element's text color), but its `<text>` label has no `fill` at all —
  it renders at the SVG default (black), unreadable against a dark
  background. Give the `<text>` its own token-bound fill distinct from
  the bar's — not also `fill="currentColor"`, which would force it to
  inherit the exact same color as the bar it labels (illegible against
  the bar itself when a label overlaps a tall bar). Apply a Tailwind
  `fill-*` utility (generated from T1's `@theme inline --color-*`
  tokens, e.g. `fill-muted-foreground`) directly on the `<text>`
  element — round-2 pre-EXECUTE REVIEW finding: a `text-*` utility on
  a wrapping element sets CSS `color`, which SVG `fill` does not read
  unless the value is the literal keyword `currentColor`; a wrapper's
  `text-*` class would leave the label black in both themes, the exact
  regression this task exists to fix.
- Preserve `role="alert"` on `app/(app)/analytics/page.tsx`'s
  `<p role="alert">{safeErrorMessage(result)}</p>` error state (round-1
  pre-EXECUTE REVIEW finding — same class of gap as T4's, no test
  would catch the role being dropped). Also preserve
  `FocusTimeChart`'s own accessible surface, all untested and all
  inside the SVG this task restructures (round-2 pre-EXECUTE REVIEW
  finding): the `<svg role="img" aria-label={...}>` on the chart root
  (`FocusTimeChart.tsx:18-19`) and the per-bar
  `<title>{day.date}: {day.minutes} min</title>` elements
  (`FocusTimeChart.tsx:29-31`).

**Done when:** analytics screen renders correctly in both themes with
real and empty data (existing empty-state behavior unchanged); the
`role="alert"` error element above still carries the role; the chart's
`role="img"`, `aria-label`, and per-bar `<title>` elements are all
still present; chart day labels are legible against the bars and the
background in both themes, recorded in the qa-log.

### T6: Redesign auth screens (Login, Signup)

**Depends on:** T2

**Tests:**
- `login/actions.test.ts` and `signup/actions.test.ts` build `FormData`
  by hand and never render a component — they can't see markup, so
  they can't confirm a restyle preserved it. Add a rendered component
  test per form (`LoginForm.test.tsx`, `SignUpForm.test.tsx`) asserting
  the email/password inputs are reachable by their associated label
  text and carry their `name`/`required`/`autoComplete` attributes —
  checkable immediately on render, no mocking needed for this half. For
  the error-render half: both forms use `useActionState`, which returns
  `initialState` (`{}`, no error) until the form is actually submitted
  — `vi.mock` the form's own action module
  (`@/app/(auth)/login/actions` / `@/app/(auth)/signup/actions`) to
  return a fixed `{ error: "..." }`, render the form, `fireEvent.click`
  the submit button (from `@testing-library/react` — the idiom
  `apps/web/components/PomodoroTimer.test.tsx:32` already uses;
  round-1 pre-EXECUTE REVIEW finding: `@testing-library/user-event` is
  not an existing dependency, and adding one is an Ask-first boundary
  this task doesn't need to cross), then assert the mocked error
  renders inside a `role="alert"` element. Mocking the action module
  directly means the
  component never imports `next-auth`/`@/lib/auth` at all (unlike
  `login/actions.test.ts`, which exercises the real action and needs
  those two mocks instead) — don't carry them over; they'd be inert
  here.

**Approach:**
- Restyle `LoginForm`, `SignUpForm`, and the `login`/`signup`
  `page.tsx` files with Tailwind utilities and shared tokens. Preserve
  `role="alert"` on error states and every existing `id`/`name`
  attribute the Server Actions read from `FormData`.

**Done when:** `login/actions.test.ts`, `signup/actions.test.ts`, and
the two new component tests green; both screens render the new design
in both themes; the theme toggle (from T2's global header) is visible
and functional on both, recorded in the qa-log.

### T7: Contrast + accessibility audit

**Depends on:** T1, T2, T3, T4, T5, T6

**Tests:** goal-based — per AC4's thresholds, sample every
text/background and interactive-control/background pair *as rendered*
on each in-scope screen (Tasks, Analytics, Login, Signup, shared
header/nav) in both themes — not only the abstract token palette, since
a themeable color can still land on an element with no explicit color
applied (T5's `FocusTimeChart` `<text>` fix is the concrete case this
guards against; check for others of the same shape). Assert every
interactive control's focus indicator clears AC4's non-text-contrast
bar. Assert `ThemeToggle` is a real button with a correct
`aria-pressed` and is reachable/operable by keyboard alone (manual Tab
+ Enter/Space check).

**Approach:**
- Per-screen audit (not palette-only) of the finalized token values as
  actually used across all redesigned screens; adjust any pair that
  fails its threshold.
- Manual keyboard-only pass over every in-scope screen confirming
  every interactive control (not only the toggle) shows a visible
  focus indicator and is reachable/operable.
- Confirm walking-skeleton AC13 still holds with the global theme
  toggle present on *every* screen it renders on — the toggle lives in
  the root layout's header, so this includes the tasks screen (which
  AC13 names explicitly) as well as login/signup (per spec Boundaries'
  chrome-not-primary-action reading) — a manual pass, recorded in the
  qa-log; if it doesn't hold, stop and surface it rather than editing
  walking-skeleton's spec (per this spec's Ask first).

**Done when:** every checked pair, per-screen, clears its AC4
threshold in both themes; `ThemeToggle` passes the keyboard/`aria-pressed`
check; AC13 confirmed still holding on every in-scope screen; all
recorded in the qa-log.

### T8: Full regression pass

**Depends on:** T1, T2, T3, T4, T5, T6, T7

**Tests:** no stub (goal-based) — the full existing gate sequence, per
`AGENTS.md` § Commands you'll need (not re-enumerated here — that file
is canonical for the exact command set, including the api-side `ruff
check` and the `curl -f http://localhost/healthz` smoke command). Both
AC6 absence checks below are **run from the repository root** (round-5
pre-EXECUTE REVIEW finding: `AGENTS.md`'s own web gates run from
`apps/web/`, but these two checks use repo-root-relative paths; from
`apps/web/`, `apps/web/app`/`apps/web/app/globals.css` don't resolve,
`grep` errors, and the un-guarded pipelines below would have silently
passed having read nothing — verified against the actual behavior from
both working directories). (1) No in-scope source file uses an inline
`style` attribute:
```
test -d apps/web/app && test -d apps/web/components \
  && ! grep -rq 'style={' apps/web/app apps/web/components
```
(scoped to source directories, not `.next/`; `grep -q` alone exits 1,
not an error, on the desired no-match case, so the `!` form is correct
for the pipeline itself — but the directory guards must be `&&`-chained
into the same command, not run as separate statements, or their
failure is silently discarded and a missing/renamed directory reports
a false pass, per finding (2) below). (2) `globals.css` contains no
rule beyond what AC6 permits — chain the file-existence guard into the
same command as the check itself (round-5 pre-EXECUTE REVIEW finding:
a `test -f` on its own line, not `&&`-chained, doesn't gate anything —
its non-zero exit is discarded, the following pipeline runs against
the missing file, and the same `grep` error → empty input → `grep -v`
exits 1 → `!` flips it to exit 0 = false pass that round 4's fix
missed), then list every top-level (non-indented) selector/at-rule
line and negate the whole pipeline so a printed violation flips the
exit code to failure:
```
test -f apps/web/app/globals.css \
  && ! grep -E '^\S.*[{;]' apps/web/app/globals.css \
       | grep -vE '^(@import "tailwindcss";|:root \{|\.dark \{|@theme inline \{|@custom-variant dark)'
```
Exit 0 is the pass case (file exists, and the negated pipeline's inner
`grep -v` printed nothing); a missing file or a printed violating line
both make this exit non-zero and fail the step — verified locally
against a clean file (exit 0), a violating file (exit 1, line
printed), and a missing file (exit 1).

**Approach:**
- Run the full `AGENTS.md`-documented gate sequence for both `apps/web`
  and `apps/api` (a clean `apps/api` run confirms this plan's isolation
  — it touches no api code).
- Run both AC6 absence checks above, from the repository root.
- Rebuild the full stack (`docker compose up -d --build`) and manually
  walk the real end-to-end journey (signup → login → create task → run
  a Pomodoro interval → see it in analytics → toggle theme mid-journey
  → log out) in a real browser, both themes. Set
  `POMODORO_TEST_SHORT_INTERVALS=1` for this pass (existing mechanism,
  `apps/web/lib/pomodoro-durations.ts`) so the walkthrough doesn't
  require a real 25-minute wait; revert it afterward, matching
  `docs/specs/walking-skeleton/qa-log.md`'s established practice.

**Done when:** all gates green, including both new AC6 checks; the manual E2E walkthrough completes in
both themes with no visual or functional regression.

### T9: Register the new building blocks and this spec

**Depends on:** T8

**Tests:** no stub (goal-based).

**Approach:**
- Add `apps/web/lib/theme.ts` and `ThemeProvider` to
  `docs/architecture/reference.md`'s Building-block view (§ Reusable
  building blocks) — they're new shared building blocks (the repo's
  first React Context provider) in a document that's normative and
  already catalogues `apps/web/lib/api-client.ts` the same way.
- Add a `web-ui-redesign` row to `docs/specs/README.md`'s active-specs
  list.

**Done when:** both docs updated; `docs/specs/README.md` lists this
spec.

## Rollout

**Delivery:** single PR (or a small stack of task-sized PRs per the
task list above), no flag — this is a presentation-only change with an
instant, cheap rollback (revert the PR; no data migration, no schema
change, nothing else depends on the new markup). **Infrastructure:**
none — no new services, no config, no secrets. **External-system
integration:** none. **Deployment sequencing:** no ordering constraint;
ships as a normal `apps/web` image rebuild.

## Risks

- **`PomodoroTimer`'s accessible-name coupling** (see Approach) is the
  single highest-risk spot — a careless rename during restyling breaks
  its test suite silently until CI catches it. Mitigated by calling it
  out explicitly in T4 and by keeping the regression run in the same
  task as the restyle, not deferred to T8.
- **Anti-flash script drift**: if `lib/theme.ts`'s logic and the inline
  `<script>` in `app/layout.tsx` (which can't import a module — it runs
  before any JS bundle) are hand-duplicated and later edited
  independently, they can silently diverge and reintroduce the flash.
  Mitigated by keeping the inline script's logic deliberately tiny and
  noting the duplication in a comment pointing at `lib/theme.ts` as the
  source of truth for anyone changing one to also change the other.

## Changelog

- 2026-08-24: initial plan.
- 2026-08-24: spec-mode adversarial review (6 Blockers, 10 Concerns, 8
  Nits) applied. Key fixes: T1 now deletes `globals.css`'s existing
  OS-driven `@media (prefers-color-scheme: dark)` block and the `body`
  rule's color/font overrides (previously unaddressed — would have
  silently overridden a stored light preference on a dark-OS device,
  and kept the app on Arial); T2's `ThemeProvider` no longer touches
  `localStorage`/`matchMedia` during server render (would have crashed
  `npm run build`) — it now reads the theme back from
  `document.documentElement.classList` in a mount effect, `<html>`
  gets `suppressHydrationWarning`, and `npm run build` is now part of
  T2's Done-when; added a `vitest.setup.ts` `matchMedia` stub (jsdom
  has none) to T1; AC4's audit is now per-screen-as-rendered, not
  palette-only (a token can be correct in the abstract and still land
  on an unthemed element — `FocusTimeChart`'s `<text>` had no `fill`,
  fixed in T5); resolved the global toggle vs. walking-skeleton AC13
  (one-primary-action-per-screen) tension by treating the toggle as
  chrome (spec Boundaries) rather than editing that spec, with an
  explicit T7 confirmation pass; added `docs/specs/web-ui-redesign/qa-log.md`
  as the recorded-evidence artifact for every manual QA task; added a
  rendered component test for `LoginForm`/`SignUpForm` (T6) since the
  existing Server-Action tests can't see markup; added T9 to register
  the new building blocks in `docs/architecture/reference.md` and this
  spec in `docs/specs/README.md`. See spec.md's parallel revision for
  the AC/Boundaries-level changes.
- 2026-08-24: second spec-mode adversarial review (4 Blockers, 10
  Concerns, 6 Nits) applied. Round 1's `ThemeProvider` mount-effect
  design was itself subtly wrong; fixed by reading the installed
  Next.js docs bundle
  (`apps/web/node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`)
  directly rather than reasoning from memory. Key fixes: `ThemeProvider`
  now uses a **lazy `useState` initializer** (correct from the first
  client render, including during hydration) instead of a post-mount
  effect (which shipped a visibly wrong toggle icon/`aria-pressed`
  until the effect ran); added a `useLayoutEffect` re-apply in
  `ThemeProvider` for React Strict Mode's documented dev-only class-
  clearing remount; `ThemeToggle` now renders both icon states in
  markup and picks via `dark:` CSS variants (correct at first paint
  with no JS dependency) and gained a required `aria-label` (it was
  icon-only with no accessible name); `resolveInitialTheme()`/
  `applyTheme()` and the inline script now wrap `localStorage` access
  in `try/catch` and validate the stored value, instead of trusting it
  blind; `<body>` now actually gets `bg-background text-foreground`
  (T1 deleted the only prior consumer of those tokens without adding a
  new one — dark mode would have flipped tokens nothing read); added
  `color-scheme` to the token blocks so native form controls, carets,
  and scrollbars theme correctly; added AC8 for the visual redesign
  itself (previously T3-T6 traced to no criterion at all); AC1's
  Testing Strategy and T2's Done-when now actually test AC1's stated
  scenario (cleared `localStorage`, both OS preferences) instead of
  only pre-seeded-storage cases; fixed T5's `FocusTimeChart` fix, which
  as first written would have made the day-label text inherit the
  exact same color as the bar it labels; specified T6's `vi.mock` setup
  (mirroring the existing action test) since the new component tests
  can't otherwise import a component whose action module pulls in
  `next-auth`; extended T7's AC13 confirmation to the tasks screen, not
  only the auth screens; added a `globals.css`-purity check to T8 for
  AC6's other half; fixed a duplicated `**Approach:**` block in T8 left
  over from an earlier edit; assorted doc-accuracy nits (task-range
  drift after T9 was added, manual-QA task range excluding T2, an
  unrecorded CSP/script-src assumption).
- 2026-08-24: third spec-mode adversarial review (2 Blockers, 4
  Concerns, 3 Nits) applied — the third and, per `new-spec`'s
  convergence guidance, final automated review round before
  implementation begins. Key fixes: round 2's claim that the lazy
  `useState` initializer alone makes `aria-pressed` "correct from the
  first client render" was itself wrong — React does not retroactively
  patch a DOM attribute that mismatched between server HTML and the
  client's hydration-time render, so a dark-resolved first load could
  ship `aria-pressed="false"` until a click; fixed by having
  `ThemeToggle` imperatively write `aria-pressed` via a ref in its own
  `useLayoutEffect`, which always lands regardless of what hydration's
  attribute diffing did. Separately, T2's Strict Mode re-apply effect
  read raw `localStorage`, which is a no-op for AC1's actual scenario
  (a first-time visitor with nothing stored) — fixed to re-apply via
  `resolveInitialTheme()`/`applyTheme()` so it also covers the
  `matchMedia` fallback. Also: reworded T2's component test description
  to state plainly it covers toggle/persist mechanics, not hydration
  correctness (a jsdom `render()` can't discriminate a hydration
  mismatch from a correct hydrate — that's manual-browser-check
  territory only); T1's `matchMedia` stub is now per-test-settable and
  both OS-preference fallback branches are explicitly listed; dropped
  spec Boundaries' "not verb-labelled" justification for the AC13
  reconciliation (the plan's own `aria-label` requirement contradicts
  it — the chrome/placement argument stands on its own); gave T8's
  `globals.css`-purity check a concrete, runnable command instead of
  prose; unified spec.md and plan.md on the AC1 script check being
  against built/served HTML, not JSX source; stated `.dark` must follow
  `:root` in `globals.css` (equal specificity, same element — order is
  load-bearing); T6's component tests now specify submitting the form
  to reach the mocked error state, and drop two mocks (`next-auth`,
  `@/lib/auth`) that are inert once the action module itself is mocked
  directly.
- 2026-08-24: work-loop pre-EXECUTE structural review (round 1: 1
  Blocker, 2 Concerns, 1 Nit sustained by independent finding
  adjudication; 1 Concern refuted — the ambient-global-reads question
  in `lib/theme.ts`, refuted because the spec's own Testing Strategy
  already sanctions the stubbed-`matchMedia` approach) applied. Fixes:
  T6's `userEvent.click` replaced with `fireEvent.click` (the repo's
  existing component-test idiom) — `@testing-library/user-event` isn't
  an installed dependency and adding it would have silently crossed an
  Ask-first boundary; widened the plan's ARIA-preservation rule to
  cover role/state, not just accessible name, and added explicit
  `role="alert"`-preservation instructions to T4 (`TaskForm.tsx`,
  `tasks/page.tsx`) and T5 (`analytics/page.tsx`) — previously only T6
  named this, leaving three untested error-state sites; T3 now names
  `LogoutButton.tsx` explicitly as a file to restyle (it was
  spec-in-scope but orphaned — no task's Approach touched it).
- 2026-08-24: work-loop pre-EXECUTE structural review round 2 (0
  Blockers, 4 Concerns, 2 Nits sustained by independent finding
  adjudication; 1 Nit refuted — T8's env-var routing was already
  correct, just imprecisely worded) applied. Fixes: T5's SVG label-fill
  instruction corrected from a wrapper `text-*` utility (which would
  have silently done nothing, since SVG `fill` doesn't read CSS `color`
  unless the value is the literal keyword `currentColor`) to a `fill-*`
  utility applied directly to the `<text>` element — a real bug the
  round-2 reviewer caught by reasoning about the CSS/SVG rendering
  model, not just the plan's prose; T5 now also preserves
  `FocusTimeChart`'s `role="img"`/`aria-label`/per-bar `<title>`
  elements, previously unnamed and untested; T2 now states both theme
  icons are hand-authored inline `<svg>` (no icon package), closing an
  unflagged Ask-first gap identical in shape to round 1's `user-event`
  finding; T4's re-nest fallback narrowed to `data-testid` only —
  `role="status"` would have added an ARIA live region changing what
  screen readers announce, a behavior change the plan's own rules
  forbid as a side effect of restyling; T4's Tests and Approach now
  agree on which assertion changes are permitted and both require the
  commit-message record.
- 2026-08-27: work-loop pre-EXECUTE structural review round 3 (0
  Blockers, 1 Concern sustained by independent finding adjudication —
  verified against the installed `tailwindcss@4.3.3` via a compile
  probe, not just prose) applied. T1's "Keep the `@theme inline`
  block" instruction was satisfiable by preserving only the two
  entries `globals.css` already has, silently leaving every new token
  (`surface`, `border`, `primary`/`accent`, `muted-foreground`,
  `danger`) unregistered — Tailwind v4 generates a utility class only
  from a `@theme`-declared custom property, so `bg-surface`,
  `fill-muted-foreground`, etc. would compile to nothing, with no
  build/lint/test failure, directly undermining T5's round-2 `fill-*`
  fix. Fixed: T1 now requires a matching `--color-<name>` entry per
  new token, checked in its Done-when.
- 2026-08-27: work-loop pre-EXECUTE structural review round 4 (0
  Blockers, 1 Concern sustained by independent finding adjudication)
  applied. T8's second AC6 absence check (`globals.css` purity) ended
  in an un-negated `grep -v`, so its exit status was inverted from what
  the task's own Done-when expects — 1 (failure) on a clean file, 0
  (success) when a violation survives the filter and prints — and would
  have failed open if the file were ever renamed. Fixed by negating the
  whole pipeline (matching check (1)'s existing `!`-prefixed idiom) and
  adding a `test -f` guard, verified locally against both a clean and a
  violating file (clean: exit 0; violating: exit 1, line printed).
- 2026-08-27: work-loop pre-EXECUTE structural review round 5 (0
  Blockers, 2 Concerns sustained by independent finding adjudication;
  1 Concern refuted — the global `vitest.setup.ts` mechanism is
  authorized, no governing rule constrains where a stub is registered)
  applied. Round 4's `test -f` guard was never actually gating
  anything — it sat on its own line with no `&&` chaining, so a missing
  `globals.css` still passed (grep error → empty input → `grep -v`
  exits 1 → `!` flips to exit 0). Separately, both AC6 checks use
  repo-root-relative paths while `AGENTS.md`'s own web gates run from
  `apps/web/` — from there, both checks silently pass having read
  nothing. Fixed: chained every guard into the same `&&`-joined command
  as its check, and stated both checks run from the repository root;
  verified locally across four cases (clean, violating, missing-file,
  and wrong-cwd) — all now behave correctly.
- 2026-08-31: work-loop pre-EXECUTE structural review round 6 (0
  Blockers, 1 Concern sustained by independent finding adjudication)
  applied. T2's AC1 goal-based check described the served-HTML target
  in JSX terms (`<script dangerouslySetInnerHTML>`), but that prop is
  consumed by the server renderer and never appears in what a browser
  actually receives — the check as written could never match a correct
  build. Fixed: restated in served-HTML terms — a `<script>` element in
  `<head>` whose inline text includes the `focusflow-theme` storage
  key, preceding `<body>`.
- 2026-08-31: work-loop pre-EXECUTE structural review round 7 (0
  Blockers, 1 Concern + 1 Nit sustained by independent finding
  adjudication) applied, both verified against a real `next build` +
  `next start`. T2's served-HTML check named no route to fetch;
  `apps/web/app/page.tsx` redirects at `/`, and that redirect
  response's body — an error-boundary shell that never renders the
  root layout's real `<head>` — still embeds the `focusflow-theme`
  literal in its RSC payload, so a naive whole-response check on `/`
  would false-pass with no anti-flash script served anywhere. Fixed:
  the check now targets `/login` (renders the full layout, redirects
  nowhere) and slices on byte offset via a small Python one-liner
  instead of `sed`/`awk`, since the served document has zero line
  breaks and line-oriented head extraction silently degrades to
  matching the whole response. Also fixed: the Approach's "every task
  stays inside `apps/web`" claim, contradicted by T9's `docs/`
  registrations and every task's qa-log entry — narrowed to "every
  *code* change."

- 2026-10-19: spec approved by project owner
- 2026-10-19: plan approved by project owner
