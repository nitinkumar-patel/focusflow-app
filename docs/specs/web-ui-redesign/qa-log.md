# Web UI redesign & theming — QA log

Manual verification transcripts for tasks whose Tests mode is
visual/manual QA (plan.md). Each entry records what was driven and the
observed result — per the work-loop Finish checklist's "trust the
running artifact" requirement, and this plan's Construction tests §
Manual verification.

Entries are appended as each task's manual QA pass runs.

## T7 contrast + accessibility audit

**Method and limits (read first).** All ratios below are *computed*
(WCAG 2.x relative-luminance formula, independent Python script kept
outside the repo) from the token values in `apps/web/app/globals.css`
and the Tailwind classes *actually present* in `apps/web/app` and
`apps/web/components`. Keyboard/aria findings are *static* (read from
markup). **NOT performed:** a live browser pass (real Tab/Shift+Tab/
Enter/Space traversal, rendered-pixel sampling, screen-reader
announcement). That interactive keyboard check remains outstanding.

Tokens audited — light: bg `#ffffff`, fg `#171717`, surface `#f5f5f7`,
border `#858590`, primary/accent `#4338ca`, muted `#525252`, danger
`#b91c1c`. Dark: bg `#0a0a0a`, fg `#ededed`, surface `#171717`, border
`#737373`, primary/accent `#a5b4fc`, muted `#a3a3a3`, danger `#f87171`.
Thresholds per AC4: text 4.5:1 (all text here is normal size, incl. SVG
10px labels; the 2xl/3xl headings and timer would clear 3:1 anyway),
UI components and focus indicators 3:1, disabled controls exempt
(submit buttons use `disabled:opacity-60`).

Verification of the controller's `--border` finding: confirmed. With the
current values, input/control borders are 3.35-3.65:1 (light) against
surface/bg in light (3.35-3.65) and all >= 3:1 in dark (see tables). (The prior lighter border
values were not re-measured here; only the current ones were audited.)

### Fix applied during the audit

- `active:bg-border` (pressed state) put `text-foreground` on the
  border color: dark theme 4.05:1 (FAIL < 4.5; light was 4.91). Removed
  the `active:bg-border` class from the nav links
  (`apps/web/app/(app)/layout.tsx`) and the Log out button
  (`apps/web/components/LogoutButton.tsx`); the hover state
  (`hover:bg-background`, 17.93:1 light) still applies while pressed.
- Hover `opacity-90` on primary buttons (text and fill both fade over
  their backdrop): computed 6.31-8.21:1, PASS.

### Per-screen pairs (ratio, both themes)

**Header**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| FocusFlow wordmark text (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| ThemeToggle icon (stroke) (fg on surface) | UI 3:1 | 16.47 PASS | 15.31 PASS |
| ThemeToggle border (border on surface) | UI 3:1 | 3.35 PASS | 3.78 PASS |
| ThemeToggle focus outline (primary on surface) | focus 3:1 | 7.26 PASS | 8.99 PASS |

**App nav**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| nav link text (muted) (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |
| nav link hover text (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| nav link active-press text (fg on border) (fg on border) | text 4.5:1 | 4.91 PASS | 4.05 FAIL (pre-fix; class removed) |
| nav link focus outline (primary on surface) | focus 3:1 | 7.26 PASS | 8.99 PASS |
| Log out text (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| Log out border (border on surface) | UI 3:1 | 3.35 PASS | 3.78 PASS |
| Log out hover text on bg (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| Log out active-press text on border (fg on border) | text 4.5:1 | 4.91 PASS | 4.05 FAIL (pre-fix; class removed) |
| Log out focus outline (primary on surface) | focus 3:1 | 7.26 PASS | 8.99 PASS |

**Tasks**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| h1 text (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| input text (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| label text (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| input border (border on bg) | UI 3:1 | 3.65 PASS | 4.18 PASS |
| input focus ring/border (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| Add task text (bg on primary) (bg on primary) | text 4.5:1 | 7.90 PASS | 9.93 PASS |
| Add task button fill vs page (primary on bg) | UI 3:1 | 7.90 PASS | 9.93 PASS |
| Add task focus ring (offset=bg) (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| error text (danger on bg) (danger on bg) | text 4.5:1 | 6.47 PASS | 7.16 PASS |
| empty-state text (muted on surface) (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |
| task card border (border on bg) | UI 3:1 | 3.65 PASS | 4.18 PASS |
| task title (fg on surface) (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| running card ring/border (primary on bg) | UI 3:1 | 7.90 PASS | 9.93 PASS |

**Tasks timer**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| work phase text/border (primary on surface) (primary on surface) | text 4.5:1 | 7.26 PASS | 8.99 PASS |
| break phase text (fg on surface) (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| break phase border (border on surface) | UI 3:1 | 3.35 PASS | 3.78 PASS |
| Start button text (bg on primary) (bg on primary) | text 4.5:1 | 7.90 PASS | 9.93 PASS |
| Start button fill vs surface (primary on surface) | UI 3:1 | 7.26 PASS | 8.99 PASS |
| Start focus ring (offset=bg) vs bg (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| Stop text (fg on bg) (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| Stop border vs surface (border on surface) | UI 3:1 | 3.35 PASS | 3.78 PASS |
| Stop hover text (fg on surface) (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| Stop focus ring vs bg offset (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| record error text (danger on surface) (danger on surface) | text 4.5:1 | 5.94 PASS | 6.48 PASS |

**Analytics**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| h1 text (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| h2 text (fg on surface) (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| by-task row text (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| by-task minutes (muted on surface) (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |
| SVG <text> fill-muted-foreground 10px on surface (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |
| SVG bar fill-primary on surface (primary on surface) | UI 3:1 | 7.26 PASS | 8.99 PASS |
| section card border (decorative) vs bg (border on bg) | UI 3:1 | 3.65 PASS | 4.18 PASS |
| error text (danger on bg) | text 4.5:1 | 6.47 PASS | 7.16 PASS |
| empty-state text (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |

**Login/Signup**

| Pair (fg on bg) | Kind / min | Light | Dark |
| --- | --- | --- | --- |
| h1 text (fg on surface card) (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| label text on surface (fg on surface) | text 4.5:1 | 16.47 PASS | 15.31 PASS |
| input text (fg on bg) (fg on bg) | text 4.5:1 | 17.93 PASS | 16.91 PASS |
| input border vs surface card (border on surface) | UI 3:1 | 3.35 PASS | 3.78 PASS |
| input border vs own bg (border on bg) | UI 3:1 | 3.65 PASS | 4.18 PASS |
| input focus ring/border vs surface (primary on surface) | focus 3:1 | 7.26 PASS | 8.99 PASS |
| input focus ring vs bg (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| submit text (bg on primary) (bg on primary) | text 4.5:1 | 7.90 PASS | 9.93 PASS |
| submit fill vs surface (primary on surface) | UI 3:1 | 7.26 PASS | 8.99 PASS |
| submit focus ring (offset bg) (primary on bg) | focus 3:1 | 7.90 PASS | 9.93 PASS |
| error text (danger on surface) (danger on surface) | text 4.5:1 | 5.94 PASS | 6.48 PASS |
| helper text (muted on surface) (muted on surface) | text 4.5:1 | 7.18 PASS | 7.11 PASS |
| link text (accent on surface) (primary on surface) | text 4.5:1 | 7.26 PASS | 8.99 PASS |
| link focus ring vs surface (primary on surface) | focus 3:1 | 7.26 PASS | 8.99 PASS |
| card border (decorative) vs bg (border on bg) | UI 3:1 | 3.65 PASS | 4.18 PASS |


Result: every pair clears its threshold in both themes; the only two FAIL cells are the pre-fix `active:bg-border` rows, whose class was removed (no remaining FAIL after the
fix above). The SVG `<text>` in `FocusTimeChart` carries
`fill-muted-foreground` (no unthemed default fill) and the bar uses
`fill-primary`. Other unthemed-element shape checks: no element in
`apps/web/app`/`components` relies on a default browser text/background
color; `color-scheme` is set on `:root`/`.dark` for native control chrome.
Note on the focus ring for primary buttons: `ring-offset-background`
means the ring sits against the page bg; on a surface card the ring's
neighbour is the offset gap in bg, so bg is the right comparison.
Decorative card borders are listed for information; they are not
required to meet 3:1.

### Static keyboard / aria findings

- `ThemeToggle` (`components/ThemeToggle.tsx`): a real `<button
  type="button">` with `aria-label="Toggle theme"` and
  `aria-pressed={theme === "dark"}` (also re-set via `setAttribute` in a
  layout effect for hydration); icons are `aria-hidden`. A native button
  is Tab-reachable and Enter/Space-operable by default. PASS (static).
- Focus-visible style on every interactive control: nav links, Log out,
  ThemeToggle (`focus-visible:outline-2 ... outline-primary`); all
  inputs, Add task / Log in / Sign up submit, Start / Stop buttons, and
  the Login/Signup links (`focus-visible:ring-2 ring-primary`, with
  `focus:outline-none` only paired with that ring). No interactive
  control found without one. PASS (static). Inputs additionally switch
  to `border-primary` on focus-visible.
- AC13 (walking-skeleton), read from markup: Tasks has one `bg-primary`
  screen-level action ("Add task"; Start/Stop are per-task contextual
  controls inside each task row; nav links, Log out and the header
  ThemeToggle are chrome with outline/border styling, not primary-filled);
  Login has one ("Log in") and Signup one ("Sign up"), the other
  controls on those screens being a text link and the header toggle;
  Analytics has no primary action control. Holds on tasks, login, signup
  with the header toggle present. PASS (static); walking-skeleton spec
  not edited.
- Not verified: actual Tab order, focus-trap absence, and Enter/Space
  behaviour in a real browser; rendered-pixel contrast; screen-reader
  output.

## T8 full regression pass

Run from the repo root unless noted; exit codes read directly.

| Step | Command | Result |
| --- | --- | --- |
| web tests | `npm test` (apps/web) | PASS, exit 0: 12 files, 69 tests passed |
| web lint | `npm run lint` (apps/web) | PASS, exit 0, no output |
| web typecheck | `npx tsc --noEmit` (apps/web) | PASS, exit 0, no output |
| web build | `npm run build` (apps/web) | PASS: compiled, TypeScript finished, 9/9 static pages |
| stack rebuild | `docker compose up -d --build` | PASS, exit 0; `docker compose ps`: db, api, web healthy (nginx up, no healthcheck) |
| api tests | `docker compose exec -T api pytest -q` | PASS, exit 0: 51 passed |
| api lint | `docker compose exec -T api ruff check .` | PASS, exit 0: All checks passed |
| smoke | `curl -f http://localhost/healthz` | PASS, exit 0: `{"status":"ok"}` |
| AC6 check 1 | no `style={` in `apps/web/app`, `apps/web/components` (plan form) | PASS, exit 0 |
| AC6 check 2 | `globals.css` top-level rule allowlist (plan form) | PASS, exit 0 |
| GET /login via nginx | curl | PASS: 200, contains `aria-label="Toggle theme"` (1 match) |
| GET /signup via nginx | curl | PASS: 200, contains `aria-label="Toggle theme"` (1 match) |
| anti-flash head check | plan python snippet vs `http://localhost/login` | PASS, exit 0 |

### Real-browser end-to-end walkthrough: NOT performed

No real browser was available to the agent, so the plan's manual E2E
walkthrough was not done and is not claimed. Remaining for a human, in
both light and dark themes, against the rebuilt stack at
`http://localhost` (set `POMODORO_TEST_SHORT_INTERVALS=1` for the pass
and revert it afterward, per walking-skeleton practice):
signup, login, create a task, run a Pomodoro interval, see it in
analytics, toggle the theme mid-journey (and confirm persistence on
reload with no flash), log out; check for any visual or functional
regression. T8's "Done when" is therefore only partly satisfied (all
automated gates green; manual walkthrough outstanding).
