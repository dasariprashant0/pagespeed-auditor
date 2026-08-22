# Per-user onboarding tour — design spec

> Brainstormed 22 Aug 2026. Supersedes the org-wide `SetupChecklist` +
> per-user-global `RoleTourBanner` pair with one per-membership system.
> Written after Phase 5's per-tenant cutover shipped and its final-review
> fix (unprovisioned orgs redirect to `/settings/database`) surfaced the
> real bug this spec exists to fix: that redirect, combined with
> `onboardingState()` being derived from organization-wide data, means a
> teammate invited into an already-configured org — or a brand-new admin,
> now hard-gated behind Settings → Database — never gets shown around at
> all.

## Problem, precisely

Two independent onboarding mechanisms exist today and both have real gaps:

1. **`SetupChecklist`** (`components/onboarding/SetupChecklist.tsx`,
   `lib/services/onboarding.service.ts`) — five steps (site, key, pages,
   first audit, schedule), all derived from **organization-wide** data.
   Once the org is objectively "complete," the checklist is gone **for
   everyone, forever** — including a teammate invited next week who has
   personally never seen any of it.
2. **`RoleTourBanner`** (`components/onboarding/RoleTourBanner.tsx`,
   `User.roleTourSeenAt`) — a static "here's what your role can do" card,
   shown once ever, tracked on `User` (not `Membership`), so it is: (a)
   global across every organization a person belongs to, not scoped to
   the one they're currently in, and (b) never resets on a role change or
   on being removed and re-added to an organization.

Separately, this session's own Phase 5 final-review fix added a real
regression in spirit: `app/(dash)/layout.tsx` and six pages now catch
`NotProvisionedError` and `redirect('/settings/database')` — correct as a
crash fix, but it means a brand-new admin who just signed up cannot see
the dashboard, the checklist, or anything else until they've already
completed a technical setup step. That inverts the order a real
onboarding flow wants: show them around first (with realistic
placeholder data), let them connect real credentials as one step among
several, not a wall in front of everything else.

## What this replaces both mechanisms with

One system, tracked **per membership** (per user, per organization) —
because `Membership` already uniquely identifies that pair and is
**hard-deleted** on removal (confirmed: `removeMemberAction` runs a real
`deleteMany`, not a soft-disable), so "show onboarding again after
remove-then-re-add" falls out for free: a fresh `Membership` row has no
onboarding history, full stop, no special-case code needed.

### A. Data model

```prisma
model Membership {
  // ...existing fields unchanged...
  tourStepsSeen      String[] @default([])
  checklistDismissedAt DateTime?
}
```

- `tourStepsSeen` — step IDs (from the catalog below) this person has
  been shown, in this org. A step is added to this list the moment its
  tooltip is dismissed (via Next, or via Skip — see "Skip semantics"
  below) — never before it was actually rendered.
- `checklistDismissedAt` — independent of the tour: hiding the floating
  widget. Reopening it (a "Show onboarding" control in Settings →
  Profile) sets this back to `null`. This does **not** replay tour steps
  already in `tourStepsSeen` — reopening the summary widget isn't the
  same thing as asking to see tooltips again.

**Retire entirely:** `User.roleTourSeenAt`, `RoleTourBanner.tsx`,
`dismissRoleTourAction`, every `hasSeenRoleTour` reference in
`account.service.ts` (3 call sites: `login`, `loginWithGoogle`,
`contextFor`) and both render sites in `app/(dash)/page.tsx`. The
banner's content (what each role can do) becomes the tour's opening step
group instead of a parallel mechanism.

**Why not reset `tourStepsSeen` on a role change instead of the
"capability minus seen" computation:** a person's `tourStepsSeen` list
only ever grows. A role change needs no write at all — the tour
recomputes live, every time, as "every step whose `requiredCapability`
this role now has, minus steps already in `tourStepsSeen`." A promotion
from viewer to admin doesn't erase what they already learned as a
viewer; it just surfaces the admin-only steps they've never had access
to before. A demotion doesn't need to hide anything either — a step
already seen stays seen even if the current role could no longer reach
its target element; there's nothing to accidentally re-show.

### B. Tour step catalog and engine

One source of truth, e.g. `lib/onboarding/tourSteps.ts`:

```ts
export interface TourStep {
  id: string;                 // stable, never reused once shipped
  route: string;               // pathname (or pattern) it applies to
  targetSelector: string;      // matches a `data-tour="<id>"` attribute
  title: string;
  body: string;
  requiredCapability: Capability | null; // null = every role sees it
}
```

Target elements in existing components get a `data-tour="stepId"`
attribute — no structural changes to those components otherwise.

**Client engine** (`components/onboarding/TourEngine.tsx`, mounted once
in the `(dash)` layout): given the current route and the membership's
remaining steps (server-computed and passed down — see "Wiring" below),
find the first remaining step whose `targetSelector` exists in the DOM
on this route, and render a positioned tooltip anchored to it with
Next / Skip. **Opportunistic, not a forced wizard** — per your choice: a
step lights up when you naturally land on a page where it applies, it
does not navigate you there. The floating checklist widget (below) is
what surfaces reachable-but-not-yet-visited areas as plain links, so
nothing already built gets buried for someone who never happens to click
around into it.

**Skip semantics:** "Skip" on one tooltip marks *that* step seen and
moves to the next one, same as "Next" — there is no difference between
them from the data model's point of view; "Next" is just the label used
when the step's content was actually read, "Skip" when it wasn't. A
distinct "skip the whole tour" affordance (in the floating widget, not
on individual tooltips) marks every **currently applicable** step
(matching the role right now) as seen in one write — not the entire
catalog, so a later role change still surfaces the steps it newly
unlocks.

**Authorization:** every action below (`markTourStepSeenAction`,
`dismissChecklistAction`, `reopenChecklistAction`, `skipTourAction`)
requires only `requireSession()`, not a specific capability — dismissing
your own onboarding view is not an org-admin action, unlike the
capability-gated Settings mutations elsewhere in this app.

**Wiring:** `(dash)/layout.tsx` already resolves `ctx` and (per section E
below) will resolve fixture-or-real site data regardless of provisioning
state. It additionally computes `remainingTourSteps` (catalog minus
`membership.tourStepsSeen`, filtered by current role) and passes it to a
client `<TourProvider>` wrapping `<AppShell>`, which `<TourEngine>`
reads from context. Marking a step seen is a small Server Action,
`markTourStepSeen(stepId)` (`lib/onboarding` or folded into
`app/actions/onboarding.ts`), doing an atomic array-append
(`{ push: stepId }` via Prisma) — idempotent by construction if called
twice for the same id (a duplicate entry in the array is harmless; reads
already dedupe via a `Set` when computing "remaining").

### C. Floating checklist widget

Bottom-left, persistent, replaces `SetupChecklist`'s current placement
as a panel on the dashboard. Shows:
- The five existing organization-level setup steps (site, key, pages,
  first audit, schedule) — `onboardingState()`'s logic is unchanged,
  still genuinely derived from real data, just re-homed into the widget
  instead of a dashboard panel.
- Remaining tour areas not yet visited, as direct links (e.g. "See how
  reports work → /g/<first-group>").

Dismissible (sets `checklistDismissedAt`); a "Show onboarding" control
under Settings → Profile clears it back to visible. Collapses to a small
icon on narrow viewports rather than occupying real screen space
permanently on mobile.

### D. Dummy data / demo mode

While an organization has no site configured (regardless of whether its
database is provisioned yet — the two are already independent facts:
provisioning is about the *database*, having a site is about
*sitemap ingestion*), dashboard / group / report pages render a small
canned fixture instead of empty states: one fake site, a handful of fake
groups and pages, plausible scores and a bit of history so charts have
something to draw.

Per your choice, this is **interactive, not inert**: "run an audit" in
demo mode simulates progress client-side (a timed fake progress bar) and
reveals a canned result, rather than calling the real audit pipeline —
there is nothing real to measure yet. The moment a real site exists
(`defaultSite()` returns non-null), the exact same components render
real data instead; nothing about the page changes shape, only which
data source feeds it.

**Scope note, stated plainly rather than left implicit:** building a
fully faithful simulated audit run (progress bar, live log, realistic
timing) is real engineering work in its own right, separate from the
tour/checklist plumbing above. The implementation plan should treat "one
static canned fixture, rendered wherever real data would go" and "the
simulated interactive audit-run experience" as two tasks, not one, so
the first can ship and be verified before the second's extra complexity
is layered on.

### E. Un-gating the Phase 5 provisioning redirect

Rework this session's earlier fix: `app/(dash)/layout.tsx` and the six
pages that currently catch `NotProvisionedError` and
`redirect('/settings/database')` instead treat "not provisioned" as
another data state — same as "no site yet" — and render with demo-mode
fixture data (section D) plus the floating widget's nudge, rather than
redirecting away. `/settings/database` remains directly reachable at all
times; it is simply no longer the *only* reachable page. The 4 API
routes' `NotProvisionedError → 409` handling (also from that same fix)
can stay as-is — those are polling/data endpoints an unprovisioned org's
demo-mode pages won't call in the same way real ones do.

## Scenarios considered

Worked through deliberately, since a gap here is exactly the kind of
thing that reads as broken (or worse, as leaking one tenant's fixture
data into another's view) in front of a real user:

- **Invited teammate joining an already-fully-set-up org.** Their fresh
  `Membership` has an empty `tourStepsSeen` — every applicable step for
  their role shows, regardless of the org's own setup completeness. This
  is the exact bug this spec exists to fix.
- **Removed, then re-invited.** Hard-delete + fresh `Membership` on
  re-accept means onboarding restarts with no special-case code, as
  established above.
- **Role changed while mid-tour.** No write happens on the role change
  itself; the next render recomputes "capability-eligible minus seen"
  live, so new steps the new role unlocks simply appear.
- **Role demoted.** Nothing hides. A step already seen stays seen even
  if the current role can no longer reach its target — there's no
  "unsee" concept, and there's no harm in that: the tooltip pointed at
  something they still remember existed even if they can't act on it
  right now.
- **Same person, multiple organizations.** Independent `Membership` rows
  mean independent progress; switching the active org via the existing
  org-picker shows that org's own remaining steps, never another org's.
- **New tour step added in a later release.** Automatically surfaces to
  *everyone* who hasn't seen that specific id — including people who
  finished the "old" tour long ago. This is normal, desired product-tour
  behavior, not a bug to guard against.
- **Skip-the-whole-tour, then later promoted.** Only currently-applicable
  steps get bulk-marked seen; a later promotion still surfaces the
  steps it newly unlocks, exactly like the ordinary role-change case.
- **Double-submit / race on marking a step seen** (e.g. a fast double
  click, or a hard refresh mid-request). Array-append is naturally
  idempotent for this purpose — a duplicate id in the array changes
  nothing observable, since "remaining" is computed as a set difference.
- **A step's target element doesn't exist yet on a page that's still
  loading (streaming/`Suspense`).** The engine finds nothing to anchor to
  and simply shows nothing this render; it re-checks on the next
  navigation/DOM update rather than erroring or retrying aggressively.
- **Demo-mode fixture data must never leak into a provisioned org's real
  view, or vice versa.** Two states collapse into the same fixture
  branch: `defaultSite()` returning `null` (today's existing "no site
  yet" case) and `defaultSite()` *throwing* `NotProvisionedError`
  (today's redirect case, from section E). The one new piece of logic is
  a `try/catch` normalizing the second case into the same "show fixture
  data" path as the first — not a second, independent way to reach demo
  mode. Once normalized, there is exactly one condition
  (`site === null`) every page already branches on today; this spec
  changes what that branch renders, not how many branches exist.
- **Accessibility.** Tooltips are keyboard-reachable (Next/Skip are real
  `<button>`s in the normal tab order), dismissible with Escape, and
  don't trap focus — a screen reader user is never stuck inside a
  tooltip they can't leave. `aria-live="polite"` on the tooltip region so
  its appearance is announced without interrupting whatever the user was
  doing.
- **Mobile / narrow viewports.** The floating widget collapses to an
  icon rather than permanently occupying bottom-left real estate; a
  tooltip anchored to an off-screen or since-scrolled-away element is
  simply not shown that render, same handling as the loading case above.
- **MCP-only usage (agent bearer tokens).** No UI renders for MCP calls,
  so none of this applies — the tour and widget are dashboard-only
  concerns, `lib/mcp/*` is untouched.
- **Analytics on onboarding funnel drop-off.** Explicitly out of scope
  for this pass — this is an internal tool without an existing analytics
  pipeline, and adding one is a separate, unrelated initiative. Noted
  here so it's a deliberate deferral, not an oversight.

## What this spec does not cover (deferred, explicitly)

- The full content/copy for every tour step across the "full app
  walkthrough" — the catalog structure is specified, but authoring every
  step's title/body/anchor for the whole app is content work sized into
  the implementation plan as its own pass, not enumerated line-by-line
  here. A first meaningful set (overview, sections, one report, running
  an audit, the settings pages, database provisioning) ships first;
  the catalog is designed to grow without further schema changes.
- The simulated interactive audit-run experience's exact visual design
  (progress bar styling, timing, canned result content) — flagged above
  as its own implementation task, not designed in this pass.

## Files touched (indicative, not exhaustive — the implementation plan owns the real list)

- `prisma/central/schema.prisma` (+migration): `Membership.tourStepsSeen`,
  `Membership.checklistDismissedAt`; remove `User.roleTourSeenAt`.
- `lib/onboarding/tourSteps.ts` (new): the step catalog.
- `components/onboarding/TourEngine.tsx`, `TourProvider` (new).
- `components/onboarding/FloatingChecklist.tsx` (new, replaces
  `SetupChecklist`'s dashboard placement — its derivation logic in
  `lib/services/onboarding.service.ts` is reused, not rewritten).
- `components/onboarding/RoleTourBanner.tsx` (deleted).
- `app/actions/onboarding.ts`: replace `dismissRoleTourAction` with
  `markTourStepSeenAction`, `dismissChecklistAction`,
  `reopenChecklistAction`, `skipTourAction`.
- `lib/services/account.service.ts`: remove `hasSeenRoleTour`/
  `roleTourSeenAt` from `login`, `loginWithGoogle`, `contextFor`.
- `app/(dash)/layout.tsx` and the six pages from the Phase 5 final-review
  fix: replace `redirect('/settings/database')` on `NotProvisionedError`
  with demo-mode fixture rendering (section E).
- `lib/onboarding/fixtures.ts` (new): the canned demo dataset.
- Settings → Profile: a "Show onboarding" control.
