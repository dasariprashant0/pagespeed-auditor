<!--
  The ORIGINAL BRIEF, reproduced verbatim as given on 2026-08-19.

  This is the requirements document. docs/PLAN.md is the approved implementation
  plan derived from it and is what you should actually build against -- where the
  two differ, the plan wins, because its deviations were reasoned through and
  approved (see "Schema changes to the spec's reference model" there).

  Kept in the repo because the plan references "the spec" throughout.
-->

# Build Specification: Internal PageSpeed Auditor

## 1. What this is

An internal tool for a single company to audit every page of one website
(~500–1,000 pages) using Google's PageSpeed Insights (PSI) API, on both mobile
and desktop, and track Performance / Accessibility / Best Practices / SEO scores
plus Core Web Vitals over time. It has two front doors onto one shared backend:

1. **A web dashboard** — the primary interface, styled similarly to
   pagespeed.web.dev's report page (score gauges, mobile/desktop toggle, Core Web
   Vitals cards, expandable diagnostics/opportunities sections).
2. **An MCP server** — a thin wrapper exposing the same backend as tools an AI
   agent can call (e.g., "what's the recommendation for /pricing" from inside
   Claude).

Both interfaces call into the same internal service layer and database. There is
no separate logic path for "web version" vs "agent version" of anything.

## 2. Confirmed decisions (do not re-derive these)

| Decision | Choice |
|---|---|
| Interfaces | Web dashboard + MCP server, both wrapping one backend |
| PSI data source | Google PageSpeed Insights API (official, hosted) |
| Users | Internal team only, single site, no multi-tenancy |
| Scale | 1 site, ~500–1,000 pages |
| Auth | Simple shared username/password login, no SSO, no complex RBAC |
| Full-site sweep trigger | **Scheduled only** — no "audit everything now" button |
| Page / small-group trigger | On-demand allowed, synchronous where feasible |
| AI recommendations | Generated **on-demand** when a report is first opened, then cached |
| Trend tracking | Always-on: every audit is stored historically, regressions flagged |
| Grouping | Automatic from URL path structure, with manual rename/merge afterward |
| Scheduling | Fully configurable (custom cron), not a fixed nightly/weekly default |
| Notifications | Email and Slack, both **off by default**, toggleable in Settings |
| Stack | Next.js (TypeScript, App Router) + PostgreSQL |

## 3. The one constraint that shapes everything: PSI throughput

- 500–1,000 pages × 2 strategies = **1,000–2,000 PSI calls per full sweep**.
- The daily quota (25,000/day with an API key) is **not** the limiting factor.
- The limiting factor is **sustained throughput**: the API is rated around
  1 request/second, and empirically returns intermittent 500s if hit continuously
  for more than a few minutes. Design for **~0.7–0.8 requests/second sustained**,
  with exponential backoff on 429/500.
- At that rate a full sweep takes **30 minutes to a few hours**. This is why full
  sweeps are schedule-only and async everywhere.
- **On-demand runs:** a single page is fast (2 calls). A *group* run must not be
  assumed small — apply a threshold (e.g. 15 pages / 30 calls): below it run
  synchronously with a spinner; at or above it, convert to the same
  async job-with-progress pattern used for scheduled sweeps.

## 4. Architecture

```
Next.js App (dashboard + API routes)   MCP Server (same tools, HTTP/Streamable)
                  \                     /
                   Service Layer (shared TS lib)
                (sites, pages, groups, audits,
                 recommendations, schedules)
                  /          |          \
           Postgres    Job Queue     PSI API
                     (BullMQ+Redis)  + Claude API
```

**Deployment note:** the queue worker is a long-running Node process — it
**cannot** run as a Vercel serverless function. Default to a single Docker
Compose stack (Next.js app, worker, Postgres, Redis) on one small VPS.

**MCP transport:** Streamable HTTP (not stdio), authenticated with the same team
login, hosted alongside the Next.js app, so any team member's Claude client
connects to the *same* shared data.

## 5. Data model (Prisma-style reference schema)

Models: `User`, `Site`, `Group`, `Page`, `AuditRun`, `AuditResult`,
`Recommendation`, `Schedule`, `NotificationSetting`.

Key fields:

- **Group**: `name`, `slug`, `isManual` (true once user renames/merges —
  protects from auto-regroup overwrite)
- **Page**: `url @unique`, `path`, `groupId?`, `lastAuditedAt`
- **AuditRun**: `type` ("full_sweep" | "group" | "page"), `triggeredBy`
  ("schedule" | "manual"), `status` ("queued" | "running" | "completed" |
  "failed"), `totalJobs`, `completedJobs`
- **AuditResult**: `pageId`, `auditRunId`, `strategy` ("mobile" | "desktop"),
  `performanceScore`, `accessibilityScore`, `bestPracticesScore`, `seoScore`,
  `lcp`, `inp`, `cls`, `fcp`, `ttfb`, `rawJson` (full PSI response — keep for
  reprocessing/debugging), `markdownReport`, `createdAt`
- **Recommendation**: `auditResultId @unique`, `content`, `model`, `generatedAt`
- **Schedule**: `cronExpr?` (null = disabled), `enabled`
- **NotificationSetting**: `emailEnabled`, `emailTo`, `slackEnabled`,
  `slackWebhookUrl`

> See docs/PLAN.md for the approved additions to this model (nullable INP, TBT,
> field-data columns, `AuditIssue`, `GroupAlias`, `isActive`, and the
> `@@unique([auditRunId, pageId, strategy])` idempotency constraint).

## 6. Sitemap ingestion & grouping

- Fetch `sitemapUrl`. If it's a **sitemap index**, recurse and merge.
- Dedupe URLs, normalize trailing slashes, store as `Page` rows.
- **Default grouping:** first path segment after the domain (`/features/x` →
  `features`; root/top-level → `General`). Runs on ingest and on re-ingest for
  *new* pages only.
- **Manual overrides win permanently:** once a group has `isManual = true`,
  re-running ingestion must never silently reassign its pages.

## 7. Per-page markdown report (agent-readable output)

Every `AuditResult` gets a generated `.md`:

```markdown
# {url} — {strategy}
Audited: {timestamp}

## Scores
| Category | Score |
|---|---|
| Performance | XX |
| Accessibility | XX |
| Best Practices | XX |
| SEO | XX |

## Core Web Vitals
| Metric | Value | Rating |
|---|---|---|
| LCP | Xs | Good/Needs Improvement/Poor |
| INP | Xms | ... |
| CLS | X | ... |
| FCP | Xs | ... |
| TTFB | Xs | ... |

## Opportunities
- {diagnostic title}: {description, est. savings}

## Diagnostics
- {diagnostic title}: {description}

## AI Recommendation
{populated once generated on-demand; otherwise omitted/"not yet generated"}
```

Store in `AuditResult.markdownReport`; generate **once at audit time**, don't
regenerate on every read. The recommendation section is appended/updated
separately when the AI recommendation is generated.

## 8. Dashboard UI

Mirror pagespeed.web.dev's report page.

- **Home:** list of groups, each with an aggregate score and page count, plus a
  site-wide **"Top issues" widget** — the diagnostic/audit IDs occurring most
  often across the latest `AuditResult` for every page, ranked by pages affected
  ("Render-blocking resources — 32 pages"). Surfaces systemic fixes rather than
  chasing individual page scores.
- **Group view:** flat list of that group's pages with latest scores — pages are
  never nested further.
- **Page report view:** mobile/desktop tab toggle, four score gauges (red <50,
  orange 50–89, green 90+, matching PSI's convention), Core Web Vitals cards,
  then Opportunities / Diagnostics / Passed audits as expandable sections. A
  small history sparkline per score. A "Generate recommendation" action if none
  is cached.
- **Settings:** sitemap URL, schedule (cron builder), notification toggles +
  destinations, PSI API key.

## 9. Job queue & rate limiting

- BullMQ + Redis. One rate-limited queue for PSI calls, ~0.7–0.8 req/sec with
  jittered exponential backoff.
- Every `AuditRun` tracks `totalJobs` / `completedJobs` for live progress.
- Runs must be **resumable**: a worker restart mid-sweep resumes from the last
  incomplete job.
- Single page → synchronous (still through the rate limiter).
- Group → sync under threshold (default 15 pages / 30 calls), else async.
- Full sweep → always async, always schedule-triggered (no manual button, no MCP
  tool).

## 10. AI recommendations (on-demand, cached)

- Triggered when a report is opened and no `Recommendation` exists for that
  `AuditResult`, or via explicit "regenerate".
- Pass the structured diagnostics/opportunities (not full raw PSI JSON) and ask
  for a prioritized, specific fix list.
- **Default model: Claude Sonnet.**
- Cache indefinitely per `AuditResult`.
- Optional group-level rollup recommendation — nice-to-have, not required for v1.

## 11. Trend tracking & regressions

- Every `AuditResult` is a historical row; trend charts query it over time.
- **Regression definition:** don't flag on a single run's fluctuation alone.
  Lighthouse lab scores have real run-to-run variance from simulated throttling.
  Flag only when (a) a 10+ point drop *persists* across two consecutive audits,
  or (b) a single-run drop of 20+ points, or (c) a Core Web Vital crosses into a
  worse bucket and stays there on the next run.

## 12. Scheduling & notifications

- Cron expression stored per site, editable in Settings, disabled until set.
- Notifications **off by default**, toggled independently, fire **on sweep
  completion or failure** only (not on every on-demand run). Both channels can be
  enabled at once.

## 13. MCP server — tool surface

Expose the same capabilities as the dashboard, nothing more (no
`trigger_full_sweep`, matching the schedule-only rule):

- `list_groups()` → groups with summary scores
- `list_pages(group?)` → pages with latest scores
- `get_report(url)` → latest markdown report for a page
- `get_trend(url | group)` → historical scores
- `get_recommendation(url)` → cached recommendation, generating if missing
- `run_page_audit(url)` → on-demand single-page audit
- `run_group_audit(group)` → sync if under threshold, else a job id to poll
- `get_run_status(runId)` → progress for an async run

## 14. Suggested build order

1. Sitemap ingestion + PSI integration + rate-limited queue + raw storage —
   prove the throughput math before building anything on top.
2. Dashboard: group/page list views + page report view.
3. Scheduling + Settings + notifications.
4. Trend tracking + regression flags.
5. On-demand AI recommendations.
6. MCP server wrapping the finished service layer.

## 15. Defaults stated explicitly

- Group-on-demand → async threshold: 15 pages.
- Regression definition: as in §11.
- Recommendation model: Claude Sonnet.
- Grouping depth: first path segment only (no nested sub-groups).
- Deployment: single Docker Compose stack on one VPS.
- Notification trigger: sweep completion/failure only.

## 16. Addendum — second discovery pass

Architecture verdict unchanged. Gaps caught and folded in:

1. **Lighthouse run-to-run variance.** Lab-mode Lighthouse fluctuates between
   identical runs because throttling is simulated. §11's rule requires a change
   to persist across two runs (or be unusually large in one) to avoid false
   positives.
2. **Lab data vs field data (CrUX).** PSI returns both in one response
   (`lighthouseResult` for lab, `loadingExperience` / `originLoadingExperience`
   for field). **Store and surface both** when field data is present — omitting
   it is a real parity gap with pagespeed.web.dev. Low-traffic pages won't have
   it; render as "not enough real-user data", not an error.
3. **Sitemap URL edge cases.** Beyond sitemap-index handling and trailing-slash
   normalization: strip tracking parameters (`utm_*`, `fbclid`, etc.) and URL
   fragments before treating a URL as unique. Full canonical-tag resolution isn't
   worth the complexity for v1 — the sitemap is the source of truth.
4. **Localized URL folders.** If the site adds `/en/`, `/fr/`-style folders, the
   first-path-segment grouping would group by language rather than content type.
   Not a live problem today; flagged so it isn't a surprise later.
5. **Site-wide issue aggregation.** The "Top issues" widget (§8), computed from
   the latest `AuditResult` per page grouped by diagnostic audit ID and ranked by
   pages affected. Catches one shared root cause behind dozens of pages.
