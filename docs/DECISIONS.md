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
