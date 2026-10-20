# QA log: Task priority, Pomodoro estimates, and focus timer

Real-browser walkthrough of T6 and T7 against the rebuilt stack at
`http://localhost`, with `POMODORO_TEST_SHORT_INTERVALS=1` set on the
`docker compose up` command line (60/15/30-second phases). The override was
reverted afterwards by recreating `api` and `web` without it, and the `api`
container's value is empty again. The account was a seeded test user.

| Check | AC | Result |
| --- | --- | --- |
| Create form shows labelled Priority select and Expected Pomodoros input | AC26 | PASS (dark theme) |
| New task appears with priority and `completed/estimated` (High, 0/4; Low, 0/1), High before Low | AC28 | PASS |
| Start navigates to `/focus`; ring, `01:00`, "Focus", task title, "Pomodoro 1 of 4", one "Stop" control | AC32, AC33, AC34, AC37 | PASS |
| Ring fraction at 14 s of 60 s: `stroke-dashoffset` 432.98 of 565.49, filled 0.234 (expected 0.233) | AC32 | PASS |
| Countdown text has no ARIA role; one hidden `aria-live="polite"` element | AC39, AC40 | PASS (DOM read) |
| Tasks screen while running: row shows "In progress", other row's Start disabled with "Running: <title>" | AC29, AC30, AC43 | PASS |
| Work phase ends: `/focus` shows "Short break" with no reload; live region read "Short break started"; control reads "Skip break"; "Pomodoro 1 of 4" | AC35, AC34, AC37, AC40 | PASS |
| Break ends: `/focus` shows the empty state with a link to `/tasks` with no reload | AC44, AC31 | PASS |
| After the work phase: Tasks shows 1/4; Analytics shows 1 min for the task | AC3, AC11, AC20 | PASS |
| Second work phase shows "Pomodoro 2 of 4" after one recorded session | AC34 | PASS |
| Light theme on `/focus` renders correctly (ring, text, Stop) | AC41 (visual only) | PASS; contrast computed in the T9 table |
| Reload and a second tab: implied end times differ by 0.36 s | AC36 | PASS |
| Keyboard: Tab reaches the primary control; focus ring is a 4 px primary ring over a 2 px offset (indigo `rgb(67,56,202)` on white); Enter on "Skip break" returns to the empty state | AC37, AC38 | PASS (light theme) |

## T9: computed contrast and full gates

Contrast is computed from the `globals.css` tokens for the pairs the
`/focus` and Tasks markup uses (taken from the Tailwind classes in the
components, not from rendered computed styles). Ratios, light / dark:

| Pair | Needs | Light | Dark |
| --- | --- | --- | --- |
| foreground text on background / on surface | 4.5 | 17.93 / 16.47 | 16.91 / 15.31 |
| muted text on background / on surface | 4.5 | 7.81 / 7.18 | 7.85 / 7.11 |
| danger text on background / on surface | 4.5 | 6.47 / 5.94 | 7.16 / 6.48 |
| primary text (phase label, "In progress") on background / surface | 4.5 | 7.90 / 7.26 | 9.93 / 8.99 |
| break text (phase label) on background | 4.5 | 5.47 | 13.38 |
| primary button text on primary | 4.5 | 7.90 | 9.93 |
| ring progress, primary / break, on background | 3 | 7.90 / 5.47 | 9.93 / 13.38 |
| ring track, input and select border on background | 3 | 3.65 | 4.18 |
| row border on surface | 3 | 3.35 | 3.78 |
| focus ring and running-row border (primary) on background / surface | 3 | 7.90 / 7.26 | 9.93 / 8.99 |

No pair fails in either theme.

Gates against `docker compose up -d --build` with default configuration:

| Step | Result |
| --- | --- |
| `docker compose exec -T api pytest -q` | PASS, exit 0: 98 passed |
| `docker compose exec -T api ruff check .` | PASS, exit 0 |
| `apps/web`: `npm test` | PASS, exit 0: 13 files, 97 tests |
| `apps/web`: `npm run lint` | PASS, exit 0 |
| `apps/web`: `npx tsc --noEmit` | PASS, exit 0 |
| `apps/web`: `npm run build` | PASS, exit 0 (lists `/focus`) |
| `curl -f http://localhost/healthz` | PASS: `{"status":"ok"}` |

## UI shell and spacing pass

Triggered by a request to modernize the UI and recheck spacing, typography,
and the menu bar. Reviewed in a real browser (dark and light) on `/tasks`,
`/focus`, `/analytics`, and `/login`.

Found and fixed:

- **Two stacked bars and unpadded content.** The root layout drew a brand and
  toggle bar and `(app)/layout.tsx` drew a separate nav bar, and `<main>` had no
  padding or width limit, so content touched the left edge. Now one sticky
  `SiteHeader` (brand, tab-style `AppNav` with `aria-current="page"` and an
  active state, Log out, theme toggle) on every screen, and a `max-w-3xl`
  padded `<main>` whose edges line up with the bar. Auth screens use the same
  bar without navigation (`(auth)/layout.tsx`); the toggle stays on every
  screen (web-ui-redesign AC2).
- **Typography.** One page-heading style (`text-2xl`, `sm:text-3xl`, tight
  tracking) on Tasks, Focus, and Analytics; row titles `text-base`.
- **Tasks screen.** Create form is a card with equal-height fields; task rows
  put the title, a priority chip, `completed/estimated`, and one pip per
  estimated Pomodoro on the left and Start on the right at `sm` and up.
  Pips use static classes, so no inline `style` (web-ui-redesign AC6 holds:
  `grep -rn 'style=' apps/web/app apps/web/components` finds none).
- **Focus screen.** Timer sits in a card; the empty state is now full width
  like the other empty states.
- **AC27 was unreachable in a real browser.** The form lacked `noValidate`, so
  the browser's native `min`/`max` tooltip stopped an out-of-range estimate
  before the server action could return the `role="alert"` message. With
  `noValidate`, an estimate of 99 and an estimate of 0 each render the server
  message in a `role="alert"` element (observed in the browser). A component
  test now pins `noValidate`.

New pairs, computed from the tokens: active nav text (foreground) on background
17.93 light / 16.91 dark; nav active ring and pip track (border) on surface
3.35 / 3.78; filled pip (primary) on surface 7.26 / 8.99; high-priority chip
text and border (danger) on surface 5.94 / 6.48. No failures.

Gates after the pass: `npm test` 98 passed, `npm run lint`, `npx tsc --noEmit`,
and `npm run build` all exit 0.

Still not verified: the header's second-row nav layout below `sm`, because the
400 px viewport could not be produced (see below).

## Not performed

- **400 px layout.** The browser tool could not resize the window (`innerWidth`
  stayed 1629 after two attempts) and the app refuses to be framed, so no
  narrow viewport was measured. Still owed for T6, T7, and T9.
- **Dark-theme keyboard focus ring.** Only the light theme was checked by
  hand; the dark ring pair is covered by the computed T9 audit above.
- **Keyboard pass over the Tasks screen.** Only `/focus` was exercised by
  hand.

## Observation outside this spec

`apps/web/app/(app)/layout.tsx` renders `<main>{children}</main>` with no
horizontal padding, so page content on `/tasks`, `/focus`, and `/analytics`
sits flush against the left edge of the viewport. That line is unchanged by
this work (it came with the web-ui-redesign commit), and the web-ui-redesign
qa-log records that its own real-browser walkthrough was never run.
