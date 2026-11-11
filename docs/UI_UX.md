# UI/UX — Internal PageSpeed Auditor

> Companion to `docs/APP_FLOW.md` (where things are) and `app/globals.css`
> (the actual tokens — this document explains them, it doesn't replace them
> as the source of truth). Written 20 Aug 2026; component inventory and
> onboarding updated 11 Nov 2026.

## 1. Design principle

From `globals.css`'s own header comment, still accurate: *"the chrome is an
instrument bezel and the content is the screen. Chrome is cool, quiet and
slightly recessed; readings sit on a bright field. Score colour is the only
saturated thing anywhere, so nothing else can be mistaken for a
measurement."*

Two things are deliberately **not** this tool's own invention: Lighthouse's
three score colours and its <50 / 50–89 / 90+ bands. The team reads PSI
reports daily and pattern-matches on them — deviating there costs accuracy,
not just consistency.

Body copy is 13px base, `font-variant-numeric: tabular-nums` on every
number column. The stated reason: *"this is an internal console showing
800 rows, not a landing page."*

## 2. Theming

Three states, not two — `System` (default, follows `prefers-color-scheme`),
`Light`, `Dark`, cycled via a toggle in the rail (`ThemeToggle.tsx`, added
20 Aug 2026 after the app only ever followed the OS setting with no
override).

- Light tokens live on bare `:root`.
- Dark tokens are defined **twice**: once under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
  for System-follows-OS, and again under `:root[data-theme="dark"]` for an
  explicit choice regardless of OS. Deliberately duplicated — plain CSS
  custom properties have no mixin.
- An inline script in `app/layout.tsx` applies the stored choice **before**
  paint, so there's no flash of the wrong theme. `<html>` carries
  `suppressHydrationWarning` because of it — the documented escape hatch
  for exactly this pattern, not a sign something's wrong.
- Score colours shift alongside the theme (brighter arcs, lighter text) so
  Lighthouse recognition survives in the dark palette too.

## 3. Layout shell

`AppShell.tsx`: a recessed left rail (sections, search, sort, account
links) plus a thin top bar, rendered once from the dashboard layout and
kept mounted across navigation — the rail doesn't re-render on route
change; it reads the active section from `usePathname` client-side.

Below `lg`, the rail collapses into a `<details>` disclosure in the top
header. That disclosure sits inside a `sticky` header with no bounded
height of its own — on a site with dozens of sections the expanded menu
used to grow taller than the viewport with no way to scroll to the bottom
half of it (a `sticky` element can't scroll past its own height once
stuck). Fixed 20 Aug 2026: `max-h-[70dvh] overflow-y-auto` on the
disclosure's content gives it an independent scroll region.

## 4. Core components

| Component | Purpose |
|---|---|
| `ScoreGauge` / `ScoreTiles` | PSI's own arc gauges, the signature visual |
| `ScorePill` | Compact score chip for table rows — a gauge is too heavy there |
| `ScoreCharts` | The interactive distribution panel: every page as a bar, histogram, by-section, and scatter, by metric. Hover for the page, click to open it. Used on the Overview and on each group page |
| `SectionGrid` | Drag-to-reorder sections; `useReorder` seeds state from props once, which is why a `key={strategy}` remount was needed to fix stale mobile/desktop tiles |
| `PageTable` | A group's pages, with search, sort and bulk-select to measure a hand-picked set |
| `TopIssuesWidget` | Issues across the latest sweep, ranked by saving per page; each title links to its drill-down (`/issues/[auditId]`) |
| `StrategyTabs` | Mobile/Desktop — links, not buttons, so the choice lives in the URL |
| `FieldDataPanel` | Real-user metrics with good/NI/poor distribution bars, the Core Web Vitals Passed/Failed badge (LCP, INP and CLS only — FCP/TTFB are labelled diagnostic), and a collapsible whole-site (origin) comparison |
| `CWVGrid` | Lab metrics, including Speed Index rated on Lighthouse's mobile/desktop curve |
| `AuditSection` | One collapsible section of audits; each audit expands to its description, stack-specific tips and evidence tables. Metric chips (LCP, TBT…) mark what each audit affects |
| `RunConditions` | Device, network, CPU, browser, user agent and Lighthouse version for the run. A redirect or Lighthouse warning shows as a banner above the report |
| `RunAuditButton` | Queues a page, group, selection, changed-pages or whole-site run. Its tooltip shows the measured estimate, fetched on hover |
| `DownloadMarkdown` | The agent `.md` export, with a mobile/desktop/both choice. CSV export is a plain link styled with `buttonClass('ghost')` |
| `ActiveRunBar` | Persistent, every screen — whatever's running, with a link to where |
| `RunControls` | Hold/Continue/Stop — optimistic (`useOptimistic`), flips instantly, reverts on failure without a hand-rolled rollback path |
| `RunTerminal` | Collapsed by default under `ActiveRunBar`; live per-page activity, monospace, colour-coded |
| `FailedPages` | A run's unmeasurable pages, with a retry for exactly those |
| `RunHistoryList` | The delete-checks picker — checkbox per row, "select all", two-step confirm |
| `RecommendationPanel` | "What to fix first" on a page report. Rendered only when the organisation has an Anthropic key (`aiEnabledForOrg`); otherwise absent, not disabled |
| `AiKeyForm` | Settings → Site: save, verify or clear the Anthropic key that turns AI on |
| `McpTokenManager` | Settings → Agent access: create a token (shown once with a `claude mcp add` command), list and revoke |
| `Button` (`buttonClass`) | The one button definition: primary / secondary / ghost / danger, two sizes |
| `WaitingOnAdmin` | Role-aware onboarding (§5) |

## 5. Onboarding UI

- **No site yet / no data yet, you're not an admin** → `WaitingOnAdmin`:
  one honest line naming your role, not a wall of steps you can't act on.
- **Unprovisioned organisation** → the dashboard renders demo data
  (`lib/onboarding/demoTenant.ts`) so there is something real-looking to
  explore; run buttons are disabled with a tooltip saying why.
- **The guided tour** (`TourProvider`/`TourEngine`/`FloatingChecklist`,
  per-membership progress in `Membership.tourStepsSeen`) is built but
  **switched off** at the wiring level in `app/(dash)/layout.tsx` — see
  `docs/BUILD_LOG.md`, "onboarding tour disabled". The components and
  tests are intact for re-enabling.

The earlier `SetupChecklist` and `RoleTourBanner` (20 Aug 2026) no longer
exist; the tour replaced them.

## 6. Motion

One easing curve, three durations (`--t-fast`/`--t-base`/`--t-slow`), all
in `globals.css`. Entrances only, and only for content that just arrived
from the server — nothing loops, nothing bounces, nothing animates on
scroll. The stated reason: *"the point is to make streaming legible — you
should see WHICH part of the page filled in."*

## 7. Accessibility

One focus ring everywhere, including inside SVG (`:focus-visible`) — a
tool that reports accessibility scores has to pass its own audit. Verified
across desktop (1440), tablet (834), and mobile (390) breakpoints for
horizontal overflow, runtime errors, and missing headings as of the last
full UI pass (`docs/archive/BUILD_LOG-2026-08-19-20.md`, "the interface rebuild").

## 8. Optimistic UI — where it's used, and where it deliberately isn't

Added 20 Aug 2026, `useOptimistic` seeded from the real prop/state in each
case, reverting for free by simply never updating the base value on
failure:

- `RunControls` (Hold/Continue/Stop)
- `RunHistoryList`'s delete-checks picker (rows disappear on confirm)
- `ScheduleForm`'s "Check the whole site automatically" checkbox (saves
  itself in the background, separate from the frequency/day/time picker,
  which still needs the explicit Save button — deliberate configuration,
  not a low-stakes flip)

## Related documents

`docs/APP_FLOW.md`, `docs/PRD.md`, `docs/TRD.md`, `docs/BACKEND_SCHEMA.md`,
`docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md` §10 (the interface
rebuild) for the deeper design rationale.
