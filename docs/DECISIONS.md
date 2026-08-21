# Why this is built the way it is

A record of what was asked for, what was decided, and — most importantly — **why**,
including the options that were rejected and the reasons they lost. Written so
that someone picking this up in six months (or a different AI tool tomorrow)
doesn't re-open settled questions, and doesn't "fix" something that is
deliberate.

- The **original brief**, verbatim: `docs/SPEC.md`
- The **approved plan**: `docs/PLAN.md`
- **Current state**: `docs/BUILD_LOG.md`

---

## 1. The original request

The work began with a written build specification (reproduced in full at
`docs/SPEC.md`) that opened:

> **Instructions for the implementing model:** Build the system described below
> exactly as specified. Where a decision has been explicitly made, do not deviate
> from it. Where a section is marked "default — override if needed," implement the
> default unless told otherwise, but flag it rather than silently changing it. Ask
> for clarification only if something below is genuinely contradictory or
> physically impossible — not to re-litigate settled decisions.

That instruction shaped the whole approach: the spec's decisions were treated as
locked, and every deviation below is either (a) forced by something verified
about the real world, or (b) explicitly approved. None are preferences.

Alongside it, the user later asked for three things:

1. *"please log whatever you are doing in a file inside the project so that if
   needed i can change to antigravity or codex if the usage is over in the
   claude"* → `docs/BUILD_LOG.md`
2. *"and also same for the plan it should live in the project not in your
   session"* → `docs/PLAN.md`, marked authoritative
3. *"can you include the prompt which i gave you and why we choose this direction
   into one file as well"* → this file

The through-line: **nothing required to continue this work should live in a
single tool's session.** That is a constraint on how the repo is documented, and
it is why these four docs exist.

---

## 2. Direction decisions

### 2.1 Why a web app *and* an MCP server over one service layer

**Chosen:** Next.js dashboard + MCP server, both thin adapters over
`lib/services/*`.

The spec settled this, and a second independent discovery pass (spec §16) reached
the same conclusion, so it was not re-derived. The reason it holds: the two
consumers want the *same* data with different ergonomics — a human wants gauges
and a table, an agent wants JSON and markdown. Duplicating the query logic to
serve both is how the two drift.

The practical consequence is the **architecture boundary**: `lib/services`,
`lib/psi`, `lib/queue`, `lib/report` and `lib/sitemap` may not import `next/*` or
`react`. This is not tidiness. The worker is a bare Node process that imports
those modules directly, so one stray Next import breaks it at load time. ESLint
enforces it, and the rule was verified by planting a deliberate bad import and
confirming lint fails — an unenforced boundary is decorative.

### 2.2 Why full sweeps are schedule-only

**Chosen:** no "audit everything now" button, and no `run_full_sweep` MCP tool.

Not a product preference — arithmetic. 1,000 pages × 2 strategies = 2,000 PSI
calls. The API sustains roughly 0.75 req/s before it starts returning
intermittent 500s, so a sweep takes **~44 minutes at best**. A button that
appears to do something and then does nothing visible for 45 minutes is a worse
interface than no button.

This is also why the MCP surface deliberately omits the tool, and why
`run_group_audit`'s description will tell the model that sweeps are
schedule-only — otherwise an agent will try to fake one by looping over every
group, which is the same 2,000 calls with none of the progress tracking.

### 2.3 Worker concurrency 20, not 2

**Chosen:** `concurrency: 20`, `limiter: { max: 3, duration: 4000 }`.

An earlier draft of the plan said concurrency 2, reasoning that a low number
keeps us under the rate limit. **That was wrong**, and it is the single most
consequential correction made during planning.

The limiter already caps the *rate*. Concurrency controls how many requests are
in flight, and by Little's Law that needs to be `rate × latency`. Measured PSI
latency is **11–24 seconds** (confirmed on real calls, not estimated), so
`0.75 × ~25 ≈ 19` requests must be in flight to sustain 0.75 req/s at all. At
concurrency 2 the achieved rate is ~0.08 req/s and a sweep takes **seven hours**
instead of 44 minutes — with no error, no warning, and a progress bar that simply
crawls.

Related and equally quiet: `lockDuration` (120 s) **must exceed**
`PSI_TIMEOUT_MS` (90 s). BullMQ's default lock is 30 s, shorter than a slow PSI
call, so a still-running job gets marked stalled and re-delivered — correctness
is saved by the DB unique constraint, but quota burn silently doubles.
`lib/env.ts` hard-fails at boot if this invariant is violated rather than
trusting anyone to remember it.

### 2.4 Postgres + Redis in containers, not SQLite

**Chosen:** Docker Compose (Postgres 17 + Redis 7), OrbStack as the runtime.

The machine had no Docker, Postgres, or Redis, so three options were weighed:

| Option | Why it lost |
|---|---|
| Hosted dev services (Neon + Upstash) | **Upstash is not reliably BullMQ-compatible** — BullMQ needs Lua scripting plus blocking commands (`BZPOPMIN`) on a dedicated connection, which the serverless tier doesn't support. You'd debug queue infrastructure instead of building the product. Also puts internal page data on third-party services. |
| SQLite + in-process queue for dev | Prisma's `provider` isn't runtime-switchable (two schemas, two migration histories); `mode: 'insensitive'` silently behaves differently; no jsonb; SQLite is single-writer against 20 concurrent audit transactions. Worst of all, **it substitutes away exactly the parts that carry the most risk** — the rate limiter, resumability, stalled-job recovery — leaving them untested in dev. |
| Docker Compose | **Chosen.** ~10 minutes of setup, zero dev/prod drift, and the Compose file is a deployment deliverable anyway. |

**OrbStack over Docker Desktop** because Docker Desktop requires a paid
subscription for companies over 250 employees or $10M revenue, which plausibly
applies here. `docker compose` is identical against OrbStack or Colima, so this
costs nothing.

The dev Compose file deliberately **excludes the Next app**: Ship Studio runs
`next dev` on the host, and containerizing it would break the live preview.

### 2.5 The `AuditIssue` side table

**Chosen:** write one normalized row per failing audit at ingest time.

The "Top issues across the site" widget groups the latest result of every page by
audit id. Doing that over the `rawJson` column means detoasting ~240 MB and
running `jsonb_each` over ~180 audit objects per row **on every dashboard load** —
and no index can help, because GIN accelerates containment lookups, not grouped
aggregation over dynamic keys. It would be seconds-to-minutes per page view and
unfixable without this table.

With it, the query is one indexed `GROUP BY` targeting under 50 ms. The
`@@unique([auditResultId, auditId])` constraint makes "row count == distinct page
count" a real invariant, which is what lets Prisma's `groupBy._count` be correct
without `COUNT(DISTINCT)` (which Prisma cannot express).

### 2.6 Group score is the mean, not the worst page

**Chosen:** arithmetic mean of the latest mobile performance score, with the
worst page shown beside it.

The plan originally said worst-page, on the reasoning that an average lets one 95
hide a 30. **That was reversed during review.** Across 500–1,000 pages in 10–30
groups, worst-page pegs nearly every group to red the moment a single page
regresses, and — the fatal part — **it never moves when work lands**. A metric
that can't show progress turns the home page into an undifferentiated alarm.

The hiding objection is answered structurally instead of by changing the
aggregate: every group card carries the worst page as a chip linking straight to
it, a pass/needs-improvement/fail distribution bar, and the regression count.
Mean for triage, tail for panic.

### 2.7 Polling, not SSE, for run progress

**Chosen:** adaptive polling of a route handler.

SSE looks like the sophisticated answer and isn't. The run executes in a
**separate worker process** that writes progress to Postgres, so a Next SSE
handler has no push channel — it would poll Postgres and re-emit, i.e. identical
query load plus a long-lived connection that reverse proxies dislike. Real push
would mean building `LISTEN/NOTIFY` plumbing.

At ≤10 internal users a 2-second poll of one indexed row is ~5 queries/second,
and polling gets reconnection, tab-backgrounding, and error backoff for free.
The upgrade path preserves the hook signature if it's ever actually needed.

### 2.8 No charting library

**Chosen:** hand-rolled SVG for the score gauge and sparkline.

Recharts is ~100 KB gzipped and client-only. Every sparkline in an 800-row group
table would force a client boundary, turning a page that currently ships ~0 KB of
data JS into a multi-hundred-KB hydration payload. The actual requirement is a
polyline in a 72×20 box and an arc — about 40 lines of arithmetic.

There's also a credibility argument: shipping a slow performance dashboard
undermines the tool's entire premise. The plan sets a CI check that runs the
auditor **against its own dev server**, requiring accessibility 100 and
performance ≥ 90.

### 2.9 Stateless JWT session, and `proxy.ts`

**Chosen:** signed httpOnly cookie verified with `jose`.

The deciding constraint is the Edge runtime: `jose` runs there, `jsonwebtoken`
doesn't, and Prisma can't either — so a DB-backed session would leave no way to
protect every route from one place.

Two things that are easy to get wrong and are therefore written down:

- **Next 16 renamed `middleware.ts` to `proxy.ts`.** Verified in the installed
  build (`PROXY_FILENAME = 'proxy'` in `next/dist/lib/constants.js`). The old name
  still resolves, but the new one is the convention.
- **`proxy.ts` is a UX redirect layer, not the authorization boundary.** Server
  Actions are public HTTP endpoints reachable by a crafted POST regardless of the
  matcher, so **every action calls `requireSession()` as its first statement**.
  Relying on the proxy alone would leave every mutation unauthenticated.

Honest tradeoff: stateless tokens can't be revoked before expiry. A
`tokenVersion` claim on `User` fixes that for one extra read if it ever matters.

### 2.10 Scope: stages 1–2 first

**Chosen:** build ingestion + PSI + queue + storage + dashboard, then stop for
review. Scheduling, notifications, trends, AI recommendations and MCP wait.

The reason isn't caution for its own sake — it's that **M3 is a gate**. The
entire design rests on 0.75 req/s being achievable. Building scheduling and
notifications on top of an unvalidated throughput assumption means potentially
rewriting them. The throughput dry-run proves or disproves it in ~4 minutes at
zero quota cost.

### 2.11 Reaching Claude without an API key (stage 5, undecided)

The user has no Anthropic API key and asked whether Claude could be reached the
way Ship Studio does. Two routes exist:

1. `ant auth login` stores an OAuth profile the Anthropic SDK picks up from a
   zero-arg `new Anthropic()` — no key needed. Cleanest fit, since the
   recommendation generator is one plain API call, not an agent loop.
2. The Claude Agent SDK / `claude -p` with a long-lived `CLAUDE_CODE_OAUTH_TOKEN`
   from `claude setup-token`. This is what Ship Studio itself uses.

Two caveats on the subscription route in a server context: it shares interactive
Claude Code usage limits (an automated sweep can lock you out of your own
editor), and consumer plans are aimed at interactive use. **Deliberately left
open** — it's built behind a `RecommendationProvider` interface so the choice is
config, not a rewrite.

---

## 3. Corrections made after checking reality

These are cases where a documented assumption turned out to be wrong. Each was
caught by testing rather than reasoning, which is the argument for the
fixture-first approach in M1.

| Assumption | Reality | How it would have failed |
|---|---|---|
| PSI works without a key for light dev use | Keyless endpoint returns **429**, shared quota permanently exhausted | No way to develop; would have looked like our bug |
| Lighthouse groups perf audits as `load-opportunities` | **That group doesn't exist in LH 13.4.1**; it's `insights` / `diagnostics` / `metrics` / `hidden` | Opportunities list empty on every page — would read as a healthy site, not a bug |
| `details.overallSavingsMs` is the savings signal | Null or 0 almost everywhere in LH13; `metricSavings` is the real one | Every opportunity ranked at zero savings |
| `weight` can rank diagnostics | `weight` is **0** for every insight and diagnostic | Sort key is a silent no-op |
| `full-page-screenshot` is an audit to prune | It's `fullPageScreenshot`, a **top-level** key | Prune matches nothing; 43–78 KB kept per row |
| A Lighthouse content failure arrives as 200 + `runtimeError` | Arrives as **HTTP 400** with `reason: 'lighthouseUserError'` | Classified as a malformed request and discarded, instead of stored as a legitimate "page won't render" result |
| Prisma puts `url` in the datasource block | **Prisma 7 removed it** — it moves to `prisma.config.ts` + a driver adapter | `P1012` at first migration |
| `next lint` runs ESLint | **Removed in Next 16** | Lint script silently unusable |
| npm installs run postinstall scripts | **npm 12 blocks them by default** | Prisma silently has no query engine |

---

## 4. Things deliberately NOT done

Listed because each looks like an omission and isn't.

- **No "run full sweep" button or MCP tool.** See §2.2.
- **No canonical-tag resolution during ingestion.** Would mean fetching all 1,000
  pages just to read `<link rel="canonical">`. The sitemap is the source of truth
  for v1; tracking-param and fragment stripping handles the real duplicates.
- **No nested sub-groups.** First path segment only. Flagged in the spec: if the
  site ever adds `/en/`, `/fr/` folders this groups by language instead of content
  type. Not a live problem; noted so it isn't a surprise.
- **Pages are never deleted**, only `isActive: false` when they leave the sitemap.
  The audit history is the product.
- **No argon2.** bcryptjs cost 12 instead — argon2 needs node-gyp or platform
  binaries, which is real Docker/CI friction for a credential checked a handful of
  times a day. Written down so nobody "upgrades" it without knowing the cost.
- **`AuditResult` keeps error rows** (`status: 'error'`, null scores) so a failed
  job still lets a run finalize. The consequence — every aggregate must filter
  `status: 'ok'` — is a real footgun and is called out in the README.

---

## 5. Decisions made after seeing real data

### 5.1 The 42 single-page groups — fixed in presentation, not in the data model

Ingesting the real site produced 68 groups from 747 pages: `blog` alone holds
324 (43% of the site), and **42 groups hold exactly one page**. A home screen
rendering 68 cards, most of them one page, is not usable.

Three options were on the table: leave it and merge by hand (42 manual merges —
unreasonable), auto-fold small groups into an "Other" group at ingest time
(changes the spec-locked grouping rule and loses the path information), or fix
it in the dashboard.

**Chosen: fix it in the dashboard.** The data model stays exactly as the spec
locks it — first path segment, one `Group` row per segment, manual merge still
available. The home view sorts groups by page count, renders groups at or above
a threshold (default 3 pages) as normal cards, and collapses the remainder into
a single expandable "Small groups (42)" card.

Why this rather than changing ingestion: it is reversible (a display constant,
not a migration), it loses no information, group URLs keep working, and if the
team later merges the obvious pairs by hand the tail shrinks on its own. It also
keeps the spec's locked rule genuinely intact rather than nominally intact.

Merge candidates visible in the real data, for whenever someone wants them:
`ebooks` (26) + `ebook` (5); and `author`, `blog-topic`, `event-type` look like
taxonomy pages rather than content.

---

## 9. Ordering, run control and answer history (20 Aug 2026)

### 9.1 One section list, not primary + collapsed tail

Splitting the overview into a grid of large sections and a `<details>` of small
ones made the visible order differ from the sweep order, which would have made
dragging a card meaningless. One list, numbered by position.

Rejected: keeping the split and putting the drag handle only on the primary
grid. That leaves 42 of 68 sections unorderable on this site — precisely the
long tail somebody would want to push to the back.

### 9.2 Manual order lives in `Group.priority`, sitemap position is the default

`priority` non-null wins; otherwise `sitemapIndex`. A site owner's sitemap order
is already a statement of priority, so the default should follow it and manual
ordering should be an override, not a requirement.

`reorderGroupsAction` resolves slugs to ids **within the caller's organisation**
before writing. Slugs are unique per site, not globally, so an `updateMany`
keyed on slug would silently reorder another tenant's sections.

### 9.3 Dragging is disabled while sorted or filtered

Reordering a list that is currently sorted by score would persist an order the
reader cannot see, and the next page load would look like the change was
discarded. Under a sort or a search, the drag affordance and the ↑ ↓ buttons are
withheld rather than left to misbehave.

Every draggable row also carries ↑ ↓ buttons. This order decides what a
34-minute job measures first; drag-only would put that out of reach of anyone
not using a mouse.

### 9.4 Pause pauses the queue, not the run

BullMQ has no per-job hold, and the overlap guard already allows only one sweep
in flight, so pausing the queue and pausing the run are the same thing here.

Two consequences are surfaced in the UI rather than hidden:
- Jobs already dispatched finish. Up to `WORKER_CONCURRENCY` more results land
  after the hold. Aborting them would burn the quota they had already spent and
  return nothing for it.
- Queued jobs stay queued, so Continue resumes rather than restarts.

### 9.5 Stopped is `cancelled`, not `failed`

A run that someone stopped and a run that broke need to look different in the
history a month later. `cancelled` keeps every result collected and records how
far it got.

Two guards make this stick:
- `finalizeRun` treats `cancelled` as terminal. Without it the last in-flight
  job crosses the completion threshold after the stop and finalizes the run back
  to `completed`, erasing the fact that it was stopped.
- `findActiveRun` counts `paused` as active, so a second sweep cannot start
  beside a held one and double the quota spend.

### 9.6 Recommendations version instead of overwrite

`Recommendation` was `auditResultId @unique`. Someone regenerates precisely when
they disagree with what they got, and comparing old against new is the point of
doing it again — overwriting destroyed exactly the thing they wanted.

Now `@@unique([auditResultId, version])`, last ten kept per measurement.

The atomic claim survived without an extra lock table: two callers both compute
the same next version and race on the same insert; `skipDuplicates` (ON CONFLICT
DO NOTHING) lets exactly one through, and `count === 1` means this caller owns
the generation. Trimming to ten runs inside the write transaction so a crash
cannot skip it.

Rejected: a separate `RecommendationClaim` table. It would need its own cleanup
and its own stale-claim policy, for a mutex the unique index already provides.

### 9.7 Chart payload is columnar

`{ performance: 84, accessibility: 91, … }` per page is mostly field names, and
this site has ~1,500 pages appearing in both the HTML and the RSC flight data.
Tuples with an interned section table took the overview from 682 KB to 556 KB.

A tool that reports page weight does not get to ship a bloated page.

### 9.8 Chart preferences via `useSyncExternalStore`, not an effect

`localStorage` read in an effect means one render with the default chart, then a
swap — a visible flash on every load, plus a lint rule against setState in an
effect that exists for good reason. The server snapshot is null, so the first
client render matches the HTML and the saved choice applies on the next one. The
getSnapshot cache is load-bearing: returning a fresh object each call re-renders
forever.

### 9.9 Both-device markdown is one file

An agent handed mobile and desktop separately has to correlate them; handed one
document it can see immediately which findings are device-specific (an image
size, a viewport-conditional script) and which are the page itself.

---

## 10. The interface rebuild (20 Aug 2026)

### 10.1 The shell belongs to the layout, not to every page

This is the one that mattered. Every page called `<AppShell>` itself, so each
navigation re-ran `listGroupsWithAggregates` over ~1,500 results, re-serialised
~200 KB of sidebar into the RSC payload, remounted the rail — throwing away its
search text, sort choice and scroll position — and restarted the run poller.

App Router preserves a layout across navigation between its children. Moving the
shell into `app/(dash)/layout.tsx` is what makes the app feel like an
application rather than a series of documents. Measured after: a 25-page section
opens in **293 ms** on a client navigation, and the rail's search box still
holds what you typed.

The cost is that the shell can no longer receive per-route props. `GroupRail`
and `RailActiveMark` read the active route from `usePathname` instead, and
page-specific chrome moved into `<PageHeader>`, which each page renders as its
first block. That is a better place for it anyway: actions belong beside the
content they act on.

### 10.2 Loading, error and not-found boundaries are not optional

There were none. Without a `loading.tsx` there is no route-level Suspense
boundary, so a click leaves the previous page on screen with no acknowledgement
until the server answers — 530 ms on the overview, 3.3 s on Settings. That dead
interval was the entire "it doesn't feel smooth" complaint.

Skeletons match the shape of what is arriving, so the layout does not jump.

### 10.3 A tenant miss is a 404; a broken report is not

`app/(dash)/p/[pageId]` wrapped both `requirePageAccess` and `getPageReport` in
one `catch { notFound() }`, so any failure inside the report builder rendered
the framework's unstyled 404 claiming the page did not exist — for pages linked
from our own table. Only the ownership check maps to "not found" now; everything
else reaches `error.tsx`, which keeps the shell and offers a retry.

### 10.4 Nested scrollers: only the list scrolls

The rail was `overflow-y-auto` over its whole 2,213px height inside a 900px
viewport, so wheeling anywhere near the left edge scrolled the rail instead of
the page. 3,600px of wheel input moved the page 2,100px. The rail is now
`overflow-hidden` with the brand, search and account links pinned, and only the
bounded section list scrolls.

### 10.5 Tuples on the wire for large lists

`/g/blog` shipped **4.3 MB** of HTML for 324 rows and took 1.7 s. Rows now cross
as a tuple array and the table renders 50 at a time: **691 KB and 277 ms**. The
same reasoning as the chart payload in 9.7 — repeated JSON field names dominate
at this row count, on the one tool that has no business shipping a heavy page.

### 10.6 Top Issues ranks by impact, not by reach

`pagesAffected / max` was 100% on every row, because on this site nearly every
issue affects nearly every page — so every bar was full width and the ranking
carried no information. It now ranks and bars by Lighthouse's estimated saving
*per page*, and states reach as a percentage in words. Reach decides whether a
fix is a template change; impact decides whether it is worth making.

### 10.7 Score gauges, not naked numerals

The overview showed four bare numbers. The arc gauge is the one piece of
Lighthouse's visual language the team reads without thinking, so the overview is
the wrong place to be original — `ScoreTiles` reuses the same `ScoreGauge` the
report uses.

### 10.8 The signed-out screens are one set

`AuthCard` rendered its own `<main>` inside `app/(auth)/layout.tsx`'s `<main>`:
two nested mains, two competing centring contexts, and a sign-in form squeezed
to about 180px wide. The layout now owns the page and the card owns only the
card. The h1 is the task ("Sign in"), never the product name — the product name
lives in the layout so it stays put between screens.

The left panel exists because a form alone tells a first-time visitor nothing
about what they are signing in to. `BrandTrace` is explicitly an illustration —
no numbers, no axis, `aria-hidden` — so it can never be read as a measurement of
anyone's site.

### 10.9 Chrome autofill

Chrome paints its own pale blue over any field it filled, so a returning user
saw a visibly different form from everyone else. No `background-color` wins;
the fix is a 1000px inset shadow in the colour we actually want.

### 10.10 Not React Query

Considered and rejected. This app's reads are Server Components calling the
service layer directly, and its writes are Server Actions — there is no HTTP
API for a client cache to sit in front of, and building one would mean
duplicating every DTO, turning data-heavy Server Components into client
components, and shipping their rows twice. On a tool that reports page weight
that is the wrong trade.

The two places it would genuinely fit — the run progress poller and the active
run bar — already have an adaptive poller with backoff, visibility handling and
abort-on-unmount, which is most of what React Query would provide for them.

### 10.11 CWV columns carry their own severity

A 12-second LCP rendered in the same grey as a 1-second one. The table now
colours LCP and CLS against Google's published thresholds (2.5s/4s and
0.1/0.25). Those numbers are not ours to invent either.

The path cell no longer uses `direction: rtl` to clip long URLs — that reorders
the separators in a Latin string. Paths split into a quiet parent and an
emphasised final segment, which is the part that actually differs.

## 11. BullMQ worker replaced with Vercel Workflow (20 Aug 2026)

**Chosen:** delete `lib/queue/*` (the standalone `npm run worker` process,
BullMQ, ioredis-as-a-queue) and replace it with `lib/workflows/*` on Vercel
Workflow DevKit — one durable workflow run per `AuditRun`, dispatched from
Server Actions, the MCP server, and a new `/api/cron/schedule-tick` route
instead of an in-process 60s ticker.

Two independent reasons pushed this, not one:

1. **Vercel can't host a standalone process.** The whole point of deploying to
   Vercel was to stop needing a separate always-on host (Fly.io was the plan
   until it turned out to require a credit card, which the deploy was
   explicitly trying to avoid).
2. **Upstash was never reliably BullMQ-compatible** — §2.4 already flagged
   this as a known dev-only limitation ("BullMQ needs Lua scripting plus
   blocking commands (BZPOPMIN) on a dedicated connection, which the
   serverless tier doesn't support") back when the plan was local Docker
   Redis. Pointing the real worker at Upstash in production would have hit
   this for real, not hypothetically.

**What did NOT change:** `auditPage()`/`recordAuditResult()` in
`audit.service.ts`, the DB unique constraint as the actual idempotency
guarantee, the shared `PsiRateLimiter` token bucket (plain `INCR`/`PEXPIRE`
via `EVAL` — no blocking commands, so it stays on Upstash unchanged), the
concurrency-20 / rate-3-per-4s math, the record-an-error-row-on-retry-
exhaustion behaviour, and `controlRun()`'s pause/resume/stop state machine in
`run.service.ts` (same function, same test, new backing implementation of its
`queue` parameter in `lib/workflows/runControl.ts`).

**What did change:**

- **Retries move inside one step.** BullMQ re-ran the whole job on its own
  backoff schedule; now `auditOnePageStep` loops internally up to
  `PSI_MAX_ATTEMPTS`, calling the same `backoffMs()`. Workflow's own
  automatic step-retry is left as an unused extra safety net for genuinely
  unexpected throws, not the primary mechanism.
- **Pause is a status poll, not a queue primitive.** Vercel Workflow has no
  "pause the whole queue" analog. `auditRunWorkflow` processes pages in
  batches (replacing `WORKER_CONCURRENCY`) and reads `AuditRun.status` from
  Postgres between batches; if paused, it `sleep()`s in a loop (free while
  suspended) until resumed or stopped. `pause()`/`resume()`/`drain()` on the
  new queue shim are no-ops — `controlRun()` already writes the status
  itself, and that status is exactly what the workflow is polling. Trade-off:
  resume latency is up to ~20s (the poll interval) instead of instant.
- **No more BullMQ delayed-job introspection.** `/api/runs/active` used to
  report how many jobs were waiting out a 429 backoff. That queue no longer
  exists to inspect; a retrying page now just looks like a normal in-flight
  one until it succeeds or exhausts its attempts.
- **Worker liveness → scheduler heartbeat.** There's no process to ask "are
  you alive" anymore. `/api/cron/schedule-tick` stamps the same kind of
  Redis heartbeat key the old worker did, once per invocation instead of
  every 20s from a `setInterval`. The Settings → Automation copy changed from
  "background worker" to "scheduler" accordingly — there's nothing left to
  start with `npm run worker`.
- **Scheduling moved to Vercel Cron**, with a real constraint: this account
  is on the Hobby plan, which only allows cron jobs **once per day** (±59 min
  precision) — a sub-daily cron expression fails at deploy time, full stop.
  `vercel.json` schedules the tick once daily as a baseline. Per-site
  schedules configured more frequently than daily will only actually fire
  once a day regardless, until either the account upgrades to Pro or
  `/api/cron/schedule-tick` (it's just `CRON_SECRET`-authenticated HTTP, not
  exclusively tied to Vercel's own Cron feature) is triggered by a free
  external scheduler like GitHub Actions' own cron trigger instead.
- **`lib/mcp/server.ts` and `lib/services/run.service.ts` now depend on**
  `lib/workflows/*`, which itself depends on the Next.js-integrated Workflow
  SDK (`"use workflow"`/`"use step"` require `withWorkflow()` in
  `next.config.ts`). `run.service.ts` takes the dispatcher as an injected
  parameter (`AuditDispatcher`) rather than importing `startAuditRun`
  directly, specifically to avoid a circular import between
  `run.service.ts` → `auditRun.ts` → `finalize.ts` → `run.service.ts`.
- **`CLAUDE.md` Rule 1 (the framework-free zone) no longer covers `lib/queue`**
  — that directory doesn't exist anymore. It still applies to `lib/services`,
  `lib/psi`, `lib/report`, and `lib/sitemap`, none of which import
  `lib/workflows/*` or anything Next-specific.
- **`scripts/canary.ts` and `scripts/queue-audit.ts`** (manual CLI verification
  tools) no longer start a Workflow run — `start()` needs a live app instance
  with its routes registered, which a bare `tsx` script doesn't have. They
  call `auditPage()` directly in a sequential loop instead, through the same
  rate limiter every production run uses.

**Not fully verified before deploy:** local `next dev` testing hit an
unresolved issue in Workflow's local execution transport (steps queued but
never executed, with a repeating `TypeError: fetch failed` in the dev log).
The SDK's own docs say it "currently work[s] best when deployed to Vercel,"
so this was treated as a local-dev-only wrinkle rather than chased further —
verify a real run end-to-end against a Vercel **preview** deployment before
promoting to production.

## 12. `prisma migrate deploy` moved into the build script (20 Aug 2026)

**Chosen:** `"build": "prisma generate && prisma migrate deploy && next build"`
— pending migrations now apply automatically on every Vercel deploy, instead
of someone having to remember to run them against production by hand.

**Why, not just "convenience":** `vercel env pull --environment=production`
returns `DATABASE_URL=""` for this project — genuinely empty, confirmed with
`vercel env ls production` showing it as a normal (Encrypted) project-scoped
variable, not a special one. The deployed app plainly works, so *something*
supplies Vercel's build/runtime with a real connection string; it just isn't
retrievable through the CLI the way the rest of this project's env vars are.
That means **a local machine cannot reliably run `prisma migrate deploy`
against production at all** — not "shouldn't," genuinely can't get a working
value to point it at. Vercel's own build step is the one place that
demonstrably has a working `DATABASE_URL`, so that is where the migration
has to run.

**Safety:** `migrate deploy` only applies forward migrations already
committed to `prisma/migrations/` — it never generates a new one, never
prompts, and is idempotent (a build with nothing pending is a no-op). If a
migration fails, the build fails with it, which is the correct failure mode:
shipping code that expects a column the database doesn't have yet is worse
than a red deploy.

**What this replaces:** the previous expectation (`CLAUDE.md`, and the
instructions given after the `roleTourSeenAt` migration) that someone would
`vercel env pull` + `prisma migrate deploy` by hand before/after a deploy.
That path is now understood to not reliably work for this project's
production database regardless of who runs it, not just inconvenient.

## 13. `AuditResult.rawJson` moved to Vercel Blob (20 Aug 2026)

**Chosen:** new audit results store the pruned Lighthouse JSON in Vercel
Blob (`lib/blob.ts`) instead of inline in Postgres. `AuditResult.rawJson`
stays as a column (legacy rows still use it) but every new row writes
`rawJson: null` and points `rawJsonBlobKey` at the Blob pathname instead.

**Why:** raised directly — "one whole-site sweep is ~200 MB, how does Neon
survive three of them, and at $5/month will the infra cost more than the
revenue." The real numbers (fetched live, not memorized): Neon storage
**$0.35/GB-month**, free tier only 0.5 GB; Vercel Blob storage
**$0.023/GB-month** — ~15× cheaper for the exact same bytes — plus
$0.40/1M read ops and $5/1M write ops. `rawJson` (the pruned Lighthouse
payload) is the dominant contributor to the 154.8 MB one full sweep
already costs on disk (`pg_column_size`, confirmed via Settings → Site).
Moving it doesn't just cut the Neon bill; it also shrinks what Postgres has
to TOAST/detoast on every write and on the one read path that touches it
(`report.service.ts`'s single-report page), which is the more likely driver
of Neon *compute* cost, not just storage.

**Not a backfill.** Existing rows keep their inline `rawJson` exactly as
they are — no migration script rewrote history. `pruneSiteHistory`'s
existing 10-per-page retention window ages the old inline rows out within
weeks on its own, so a backfill would have been risk for no real payoff.
The read path (`report.service.ts`) checks `rawJsonBlobKey` first and falls
back to the inline column, so both generations of row render identically.

**Pathname, not the row's id.** `lib/blob.ts` keys each blob by
`audit-raw-json/{runId}/{pageId}-{strategy}.json` — the same
`@@unique([auditRunId, pageId, strategy])` triple the DB already treats as
unique — uploaded *before* the `$transaction` in `recordAuditResult`, not
after. The row's own id only exists once the DB assigns it on insert; using
it would mean uploading after the transaction and a second `UPDATE` to
attach the key, a two-phase write for no real benefit. Trade-off accepted:
a transaction that rolls back (a replayed job racing the unique constraint)
leaves one orphaned blob object, costing a fraction of a cent — not worth
building cleanup for.

**Private access, not public.** This is performance data about an internal
site, read only through the app's own session auth (`report.service.ts`),
never a bare public URL — `access: 'private'` on both `put` and `get`.

**Cleanup follows the row, not just the cascade.** Postgres cascades
(`AuditIssue`/`Recommendation` from `AuditResult`, `AuditResult` from
`AuditRun`) can't reach a separate object store. Both places that delete
`AuditResult` rows (`pruneSiteHistory`'s age-based prune, and `deleteRuns`'
operator-picked delete) now collect `rawJsonBlobKey` **before** deleting and
call `deleteRawJsonBlobs()` **after** — best-effort, since a leaked blob
costs a fraction of a cent and isn't worth failing either operation over.

**Not retrievable locally, same as `DATABASE_URL` (§12), and no local
fallback either:** `vercel env pull --environment=production` returns a
near-empty `BLOB_READ_WRITE_TOKEN` for this project, the same pattern as
`DATABASE_URL` — and local `.env` has no `BLOB_*` variables of its own
(no separate dev store was ever provisioned). So unlike the DB migration,
which at least runs correctly inside Vercel's build, **the actual
`put`/`get`/`del` round trip could not be exercised locally at all** — not
via `next dev` (no token), not standalone (no script has one either).

**Verified for real against the Vercel deployment this shipped in**,
immediately after: triggered a live "Measure again" on
`https://www.zuddl.com/`, watched the run's own `start`/`ok` events (the
terminal feature from earlier the same day) confirm both strategies
completed, then reloaded the report page and confirmed Opportunities (6),
Diagnostics (4), Passed audits (76) and Not applicable all rendered with
real, specific findings — every one of those sections is derived from
`rawJson` via `report.service.ts`, and this was a brand-new row (fresh
timestamp, changed scores), so there was no legacy inline `rawJson` for it
to be silently falling back to. That is the full write-then-read-back
round trip, observed working, not inferred from types.

## 14. Per-organisation SMTP override, but not for password resets (20 Aug 2026)

**Chosen:** `Organization` gets five nullable columns (`smtpHost`,
`smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`) — an admin-editable
override for where invitation and sweep-notification emails send from,
same shape as `Site.psiApiKey`: null means "use the shared `SMTP_*` env
vars," a real connection check (`verifySmtpConnection`, nodemailer's
`transporter.verify()`) runs before saving, and the password is never
sent to the browser.

**Why:** asked directly, by analogy to the PSI key ("make it configurable
per tenant like we did for the PSI key"). Requested while fixing a real
production bug: `/forgot` was exposing the raw password-reset link
directly in the page response because the shared `EMAIL_TRANSPORT`
wasn't actually set to `smtp`, and separately `SMTP_PASS` had never been
added to production at all — a mailbox with no password configured.

**Not applied to password resets, on purpose.** `requestPasswordReset`
resolves a user by email address alone (`prisma.user.findUnique({where:
{email}})`), before any organisation is in scope — and a `User` can hold
`Membership` in more than one `Organization`. There is no single tenant
to attribute that email to, so there is no sound choice of *which* org's
mailbox should send it. Password resets keep using the shared `SMTP_*`
env vars unconditionally; only `inviteMemberAction` (which already has
`ctx.organizationId`) and `dispatchSweepNotification` (which resolves
`Site.organizationId`) look up and pass an override.

**Verify-before-save, not verify-before-send.** `sendEmail()` skips the
shared-default's `emailConfigProblem()` check whenever an override is
passed — that check describes the *shared* config, not the override,
and the override was already connection-tested at save time. This
mirrors `updatePsiKeyAction`'s probe call to Google before storing a key,
for the same reason: a wrong credential should fail at the moment it can
still be corrected, not silently on the next real invite or notification.

**Verified:** `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138),
`npm run build` all clean. The override code path itself (`sendEmail`
with an explicit override, `verifySmtpConnection`) was exercised for
real with a one-off script against the mailbox already named in local
`.env` — which surfaced a real, previously-unknown fact: `SMTP_PASS` is
empty in **both** local `.env` and production, not just production. Only
`SMTP_HOST`/`SMTP_USER`/`SMTP_PORT`/`SMTP_FROM` were ever actually filled
in, in either place. The script was deleted after use; it never became
part of the repo, and no password was fabricated to make the check pass.

## 15. Settings tabs are visible to every role; editing is what's gated (21 Aug 2026)

**Chosen:** `SettingsNav` shows Profile/Team/Site/Automation to every
role, always. Each of the three admin-only pages now uses
`requireSession()` rather than `requireCapability(X)`, computes
`canEdit = can(ctx.role, X)`, and threads it into every form on the page,
each of which wraps its controls in `<fieldset disabled={!canEdit}>` and
shows a plain "only an admin can change this" note.

**This reverses this same session's own earlier stance.** Not long
before, `SettingsNav` was deliberately written to hide a tab entirely
when a role couldn't use it, with the reasoning "hiding is presentation,
not protection... offering a viewer a Team tab that rejects them on
arrival is a worse experience than not offering it." That reasoning
wasn't wrong on its own terms -- it's just answering a different
question than the one actually asked afterward. Direct instruction:
every role should be able to SEE what's configured (the current
schedule, who's on the team, the site's API key is set), even if only
some roles can change it. A hard `ForbiddenError` on arrival answers
neither need; a read-only render of the real, current state answers
both. Don't re-flip this back to hiding tabs without a similarly direct
instruction -- it was tried, and changed on purpose.

**Backend was already correct going in.** Every action under these
pages already calls `requireCapability` and, since the same day's
earlier "role-gated controls" pass (see `docs/BUILD_LOG.md`), already
rejects cleanly rather than throwing uncaught. This decision only changes
what renders; nothing about what the backend accepts.

**Not touched:** `AutomationStatus`/`RunHistoryList`'s existing
`canDelete`/`canRetry` props, which already worked this exact way --
visible always, gated per-action against their own specific capability
(`site:manage`, `audits:run`) rather than `automation:manage`. That
pattern predates this decision and is what this one generalizes to the
rest of the settings pages, not a new invention.

## 16. Redis removed entirely; the PSI rate limiter, scheduler heartbeat, and live run log all moved to Postgres (21 Aug 2026)

**Chosen:** `lib/redis.ts` is deleted. `Organization`-unrelated but
app-wide: `RateLimitBucket`, `KeyValue`, and `RunLogEvent` (three new,
small Postgres tables) replace everything Redis was doing. `ioredis` is
no longer a dependency; `REDIS_URL`/`QUEUE_PREFIX` no longer exist as env
vars; the local `docker-compose.dev.yml` no longer runs a redis container.

**Why, immediately:** a live incident. Upstash's Redis free tier
(500,000 requests/month) was exhausted by exactly two full sweeps. Root
cause (found before being asked to fix it, then fixed the same day,
earlier in `lib/psi/rateLimiter.ts`'s own history): `acquire()` retried
against the denied response's Redis-key PTTL rather than the real,
deterministic window boundary, and with `WORKER_CONCURRENCY=48` workers
contending for `PSI_RATE_MAX` permits per window, nearly all of them are
denied at any moment — hundreds of thousands of Redis round trips over
one 30-40 minute sweep. That specific bug was fixed first (a smaller,
same-day patch). This decision is the second, larger conclusion drawn
from the same incident: fixing the polling interval prevents *repeating*
the incident, but doesn't remove the underlying fragility of depending on
a request-metered service for something that never needed to be metered
in the first place.

**Why this was even possible now, and wasn't a rash removal:** Redis's
entire justification in this codebase was BullMQ, specifically its
blocking commands (`BZPOPMIN` on a dedicated connection) that Postgres
cannot do. BullMQ was removed months earlier for Vercel Workflow (§11).
Nothing that remained afterward -- the PSI token bucket, a heartbeat
timestamp, a few hundred lines of live-run log -- ever needed Redis's
actual differentiating capability; they used it because it was already
there, not because Postgres couldn't do the job. Once BullMQ left, Redis
became a service kept alive by inertia, with its own separate
request-metered free tier and its own way to fail that had nothing to do
with anything the app's data actually needed.

**Same atomicity, different engine.** The Lua script's whole point was
an atomic check-and-increment so concurrent callers can't both read "2
used" and both write "3". Postgres's `INSERT ... ON CONFLICT DO UPDATE
... RETURNING` gives the identical guarantee for a single row, with no
explicit transaction needed -- verified directly, not assumed: 30 fully
concurrent `tryAcquire()` calls against a fresh bucket granted exactly 3,
every time.

**Verified for real, not just unit-tested.** `npm run throughput-dryrun`
(real Postgres, real token bucket, fake PSI latency matching the live
API's observed 11-24s, zero quota spent) is the same gate this project
has used since before Redis was ever removed to validate the ~0.75
req/s sustained-rate assumption every duration estimate rests on. At
`JOBS=60` it read 0.911 req/s and failed its own tolerance check --
investigated rather than dismissed, and traced to the script's own
"steady state" sample being only 12 data points at that size, not a
limiter bug (confirmed separately: 30 concurrent `tryAcquire()` calls
granted exactly 3). At `JOBS=200`, a statistically meaningful sample,
steady-state measured 0.755 req/s against a 0.750 target -- PASS.

**What did NOT move to Postgres:** the login rate limiter
(`lib/auth/rate-limit.ts`) already had a memory-only fallback for
whenever Redis was slow or down, specifically because a hung Redis
client must never be able to lock everyone out of signing in. Once
Redis stopped existing at all, that fallback simply became the only
behaviour -- correct as-is, nothing to port.

**Live run log's lifetime changed slightly.** Redis expired old log
lines with a 1-hour TTL. The Postgres version deletes a run's log rows
outright in `finalizeAndNotify`, the moment the run goes terminal --
tighter than a TTL, and correct for what this log is for (a live
terminal view of something IN PROGRESS; once a run ends there's nothing
live left to show).

## 17. "Continue with Google" alongside passwords, not instead of them (21 Aug 2026)

**Chosen:** an optional Google OAuth2 sign-in path on login, signup, and
accept-invite, additive to the existing email+password system rather than
replacing it. `User.passwordHash` became nullable (a Google-only account
never sets one); everything else about the `Organization`/`Membership`
multi-tenant model is untouched.

**Why additive, not a migration:** asked directly which of the two.
Replacing passwords outright would mean every existing account needs a
path to gain a Google identity (or be locked out), and forces every
future sign-in through Google even for someone who'd rather not link a
personal account to a work tool. Coexistence costs nothing extra to
maintain once both paths share the same `User`/`Membership` tables, which
they do.

**No domain restriction:** asked directly, chose open to any Google
account. The existing invitation-token system is what actually grants
access to an organisation; a Google *account* proves an email address,
the same thing a password proves, no more and no less.

**Hand-rolled OAuth2, not a library.** `lib/auth/google.ts` implements the
authorization-code flow directly: a signed, short-lived `state` JWT
(`jose`, the same library and pattern `lib/auth/session.ts` already uses
for the session cookie) carries which of the three intents (login/
signup/accept) initiated the redirect, and the id_token Google returns is
verified against Google's own published JWKS (`jose`'s
`createRemoteJWKSet`) -- signature, issuer, and audience all checked, not
just base64-decoded and trusted. No new dependency: `jose` was already
here.

**The invited address is still authoritative for accept-invite.**
`acceptInvitationWithGoogle` requires the Google-verified email to exactly
match the invitation's email, the same invariant `acceptInvitation`
(password path) already enforces -- an intercepted invite link must not
become a way to join as somebody else, regardless of which credential
system does the accepting.

**Login does not create an account for an unrecognized Google email.**
Signup and accept-invite both have an organisation to attach a new user
to; a bare "sign in" attempt for an email with no existing `User` row
does not, and creating one anyway would be a dead-end account nobody
could act on. It fails with a message pointing at signing up or asking
for an invite instead.
