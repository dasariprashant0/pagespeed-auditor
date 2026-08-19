<!--
  SOURCE OF TRUTH. This file is authoritative and lives in the repo on purpose.

  It was approved on 2026-08-19 and is not tied to any single tool or session --
  Claude Code, Antigravity, Codex, or a human can all pick the work up from here
  plus docs/BUILD_LOG.md. Do not look for a copy anywhere else; there isn't one
  that matters.

  Scope of this plan: stages 1-2 only (ingestion + PSI + queue + storage, then
  the dashboard). Stages 3-6 are deliberately out of scope pending review.

  If a decision here turns out to be wrong, change it HERE and note why in the
  Session Log of docs/BUILD_LOG.md. Don't let the two drift.
-->

# Internal PageSpeed Auditor — Build Plan (Stages 1–2)

## Context

The team needs to know how every page of one company website (~500–1,000 pages) performs, and whether it is getting better or worse. Today that means running pages through pagespeed.web.dev by hand, one at a time, with no history — so systemic problems (one shared image CDN dragging down 40 pages) stay invisible, and regressions are only caught when someone happens to re-check a page.

This builds an internal tool that audits every page via the Google PageSpeed Insights API on both mobile and desktop, stores every run as history, and presents it in a dashboard modelled on pagespeed.web.dev's report page. A second front door — an MCP server — will expose the same backend to AI agents so a team member can ask "what should we fix on /pricing" from inside Claude. Both front doors call one shared service layer; there is no separate logic path for either.

The build spec locks the important decisions (Next.js + Postgres, shared-password auth, schedule-only full sweeps, on-demand cached AI recommendations, first-path-segment grouping). This plan implements them and covers **stages 1–2 of the spec's six-stage build order**: sitemap ingestion, PSI integration, the rate-limited queue, storage, and the dashboard's group/page/report views. Stages 3–6 come after review, but the schema and service seams below are laid out so they attach without rework.

The constraint that shapes everything: a full sweep is 1,000–2,000 PSI calls at a sustainable ~0.75 req/sec. Stage 1 must prove that number holds before anything is built on top of it.

## Environment findings

- Repo is an empty Ship Studio Next.js starter: **next 16.1.2, react 19.2.3, Tailwind v4** (CSS-first — no `tailwind.config.js`), TypeScript 5, App Router at repo root `app/`, alias `@/*` → `./*`. Nothing to reuse but the `@theme inline` tokens in `app/globals.css` and the `next/font` setup in `app/layout.tsx`. `app/page.tsx` is a placeholder to be replaced.
- Node v26.5.0 (so `node --test --experimental-strip-types` covers testing — no jest/vitest needed), npm 12.0.2.
- **No Docker / Postgres / Redis.** User chose to install Docker and run the spec's Compose stack.
- **Ship Studio runs `next dev` on the host**, not in a container — so local dev must not containerize the Next app or the live preview breaks.
- **A PSI API key is mandatory.** I tested the keyless endpoint: it returns `429 Quota exceeded ... Queries per day` — the shared anonymous project is exhausted. There is no keyless mode to develop against.
- No `ANTHROPIC_API_KEY`, no `ant` CLI, no `~/.config/anthropic`. Claude Code CLI 2.1.235 is installed with `setup-token` and `-p`.
- **Next 16 uses `proxy.ts`, not `middleware.ts`.** Verified in the installed build: `next/dist/lib/constants.js` defines both `PROXY_FILENAME = 'proxy'` and the legacy `MIDDLEWARE_FILENAME = 'middleware'`. `proxy.ts` at the repo root is the current convention; `middleware.ts` still resolves, so this is a naming choice, not a blocker.
- **MCP SDK v2 exists** — verified on npm: `@modelcontextprotocol/server@2.0.0` and `mcp-handler@2.1.1`, alongside the older `@modelcontextprotocol/sdk@1.30.0`. The v2 line is stateless (no sessions, no Redis), which removes the main argument for running MCP as a separate process. Stage 6 concern; recorded now so the decision isn't re-derived later.

## Confirmed with the user

| Question | Answer |
|---|---|
| Local infra | Docker Compose exactly as spec'd |
| Container runtime | **OrbStack** (avoids the Docker Desktop business-subscription question) |
| CLAUDE.md | **Rewrite it** for this tool — the Ship Studio marketing template misleads here |
| Sitemap URL | User has it — needed at build start |
| PSI API key | User has it — needed at build start |
| Anthropic key | None; asked whether Claude can be reached the way Ship Studio does |
| Scope this pass | Stages 1–2, then review |

### On reaching Claude without an API key

Yes — two routes, but this only matters at **stage 5**, so it is not a blocker now.

1. **`ant auth login`** stores an OAuth profile under `~/.config/anthropic/` that the Anthropic SDK reads automatically from a zero-arg `new Anthropic()`. Cleanest fit: the recommendation generator is one plain API call, not an agent loop.
2. **Claude Agent SDK** / `claude -p` with a long-lived `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. This is what Ship Studio itself uses, running on the Claude subscription.

Build it behind a `RecommendationProvider` interface so the credential choice is config, not a rewrite. Two honest caveats about the subscription route on a server: it shares your interactive Claude Code usage limits (an automated sweep can lock you out of your own editor), and consumer plans are aimed at interactive use — worth checking it fits your plan's terms. Decide at stage 5. Model id is **`claude-sonnet-5`** (the spec says Sonnet).

## Stack additions

Versions verified against npm today:

| Package | Version | Stage | Why |
|---|---|---|---|
| `prisma` / `@prisma/client` | 7.9.1 | 1 | Spec's schema is Prisma-shaped |
| `bullmq` + `ioredis` | 6.1.2 / 6.0.0 | 1 | Rate-limited, persistent, resumable queue |
| `fast-xml-parser` | 5.11.0 | 1 | Sitemap + index parsing; no native deps |
| `zod` | 4.4.3 | 1 | Env validation + service input contracts |
| `pino` + `pino-pretty` | latest | 1 | Structured logs, child logger per run/job |
| `tsx` | latest | 1 | Runs the worker (`next build` doesn't build it; plain `node` won't resolve `@/*`) |
| `jose` + `bcryptjs` | 6.2.9 / 3.0.3 | 2 | Edge-compatible JWT session + password hash |
| `cron-parser`, `nodemailer` | 5.10.0 / 9.0.5 | 3 | Deferred |
| `@anthropic-ai/sdk` | 0.117.1 | 5 | Deferred |
| `@modelcontextprotocol/server` + `mcp-handler` | 2.0.0 / 2.1.1 | 6 | Deferred — v2 is stateless, so MCP is a route handler, not a process |

**No charting library.** The only visuals are four PSI-style arc gauges and per-score sparklines. Recharts is ~100 KB gzipped to draw two shapes expressible in ~40 lines of inline SVG, and every chart would become a client island. Hand-roll both as pure SVG in Server Components.

**`next.config.ts` needs** `serverExternalPackages: ['@prisma/client','prisma','bullmq','ioredis','fast-xml-parser']` — without it Next 16 tries to bundle the Prisma engine and BullMQ's Lua scripts and fails at runtime with unhelpful errors.

## Architecture boundary

Everything under `lib/services/`, `lib/psi/`, `lib/queue/`, `lib/report/`, `lib/sitemap/` is plain Node/TypeScript — no `next/*`, no `react`, no `server-only`. The worker is a bare process that imports these directly; one stray Next import breaks it at load time. Next-aware adapters live in `lib/http/` (cookies via `next/headers`) and the route handlers.

Enforce it mechanically in `eslint.config.mjs` with `no-restricted-imports` patterns on those directories, and **verify the rule bites** by adding a deliberate bad import once and confirming lint fails. An unenforced boundary is decorative — and this boundary is exactly what lets stage 6's MCP server reuse the service layer untouched.

```
prisma/schema.prisma, migrations/, seed.ts
lib/env.ts            # zod-validated, frozen, throws at boot
lib/db.ts             # PrismaClient singleton (HMR-safe + worker-safe)
lib/logger.ts, lib/errors.ts

lib/psi/       types.ts client.ts extract.ts opportunities.ts buckets.ts prune.ts rateLimiter.ts
lib/report/    markdown.ts aiSection.ts format.ts
lib/sitemap/   fetch.ts normalize.ts group.ts
lib/services/  auth sitemap page group audit run results issues site (.service.ts)
lib/queue/     connection.ts names.ts queues.ts jobs.ts producers.ts worker.ts
               processors/{planSweep,auditPage,finalizeRun,maintenance}.processor.ts
lib/http/      session.ts auth-guard.ts respond.ts     # Next-aware
proxy.ts       # Next 16's renamed middleware; Edge runtime, jose only
scripts/       hash-password.ts throughput-dryrun.ts seed-fixture.ts record-psi-fixture.ts
test/fixtures/psi/*.json  test/fixtures/sitemap/*.xml
```

## PSI client and extraction

Request: `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed` with `url`, `strategy`, `key`, `locale`, and **four repeated `category` params** — comma-joining them silently returns Performance only. Note `BEST_PRACTICES` in the request maps to the response key `best-practices`.

Calls take **10–40 s**, occasionally more; use `AbortSignal.timeout(90_000)`. That latency drives the concurrency math below.

Error classification is the point of the client: 429 (read `Retry-After`), 5xx, network errors, and *200-with-a-body-that-fails-the-shape-guard* are **retryable**; 400/403/404 are **permanent** (403 = bad key or exhausted quota, which is an operator alarm, not a retry). A 200 carrying `lighthouseResult.runtimeError.code` (`ERRORED_DOCUMENT_REQUEST`, `NO_FCP`, …) is a permanent *content* error — store an error row, don't retry.

**Scores** from `lighthouseResult.categories.*.score` (0–1 float), stored as `Math.round(score * 100)`. The score **can be null** on a partial run — store null, not 0; they mean opposite things on a trend chart.

**Lab metrics** from `lighthouseResult.audits[id].numericValue`: `largest-contentful-paint`, `cumulative-layout-shift`, `first-contentful-paint`, `server-response-time` (→ TTFB), `total-blocking-time`, `speed-index`.

**Three extraction traps worth calling out**, because each fails silently:

1. **INP is a field-only metric.** Lighthouse lab runs don't produce it. `AuditResult.inp` must be nullable and populated only from field data; `tbt` gets its own column as the lab proxy, always labelled as such in the UI ("INP — not available in lab; TBT 410 ms is the lab proxy"). Writing TBT into the `inp` column is the tempting shortcut and it poisons every trend and regression comparison invisibly.
2. **Field CLS percentile is CLS × 100.** `CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile: 8` means CLS 0.08. Divide by 100. Every other metric's percentile is in its natural unit.
3. **`loadingExperience.origin_fallback: true`** means CrUX substituted origin-wide data because the page lacks traffic. Rendering that as page data makes a low-traffic page look great on borrowed homepage numbers. Derive one discriminator — `fieldSource: 'page' | 'origin_fallback' | 'none'` — and render `'none'` as "Not enough real-user data for this URL" (a normal state, never an error) and `'origin_fallback'` as "Showing site-wide real-user data".

Also note the two vocabularies in the same object: per-metric `category` is `GOOD | NEEDS_IMPROVEMENT | SLOW` while `overall_category` is `FAST | AVERAGE | SLOW`. Normalize both to internal `good | ni | poor`.

**Opportunities vs diagnostics — CORRECTED against real Lighthouse 13.4.1 responses (2026-08-19).** The plan originally specified the `load-opportunities` group. **That group no longer exists.** Recorded fixtures show `categories.performance.auditRefs[].group` takes exactly four values:

| Group | Count | What it is |
|---|---|---|
| `metrics` | 5 | LCP/CLS/FCP/TBT/SI — already stored as columns, **skip** |
| `insights` | 16 | LH13's new primary actionable surface (`render-blocking-insight`, `cls-culprits-insight`, …) |
| `diagnostics` | 11 | The classic list (`unused-css-rules`, `unminified-css`, …) |
| `hidden` | 15 | Mostly screenshots/debugdata — but **not blanket-skippable**, see below |

Three consequences, each of which would have produced silently wrong output:

1. **Map `insights` → our `opportunity` kind and `diagnostics` → `diagnostic`.** Filtering on `load-opportunities` would have returned an empty opportunities list on every single page, and it would have looked like a healthy site rather than a bug.
2. **`weight` is `0` for every insight and diagnostic** — only `metrics` carry weight. Any ranking by weight is a no-op; rank by savings, then score ascending.
3. **`details.overallSavingsMs` is null or 0 almost everywhere in LH13**; the real signal is `metricSavings: { LCP, FCP, CLS, TBT }`. So the fallback becomes the primary: `savingsMs = max(metricSavings.LCP, metricSavings.FCP, metricSavings.TBT) ?? details.overallSavingsMs`. CLS savings are unitless and must not be mixed into a millisecond total.
4. **`hidden` holds real failing audits** — `layout-shifts` scores 0 with `metricSavings.CLS`. Skipping the whole group loses signal, but keeping it drags in `screenshot-thumbnails` and `debugdata`. Filter `hidden` by `details.type` instead: keep `table`/`opportunity`, drop `filmstrip`/`screenshot`/`treemap-data`/`debugdata`.

Inclusion filter is unchanged and verified working: `scoreDisplayMode ∈ {binary, numeric, metricSavings}` and `score !== null && score < 0.9`. On a real page this caught 7 genuine issues and no noise.

**Accessibility / best-practices / SEO have no flat group** — they use many sub-groups (`a11y-aria`, `a11y-color-contrast`, `seo-crawl`, `best-practices-trust-safety`, …). Don't try to map them; the `scoreDisplayMode === 'binary' && score === 0` filter works directly and found real failures (`color-contrast`, `html-has-lang`, `meta-description`).

**`rawJson` must be pruned before storage.** Measured on real LH13 responses: 202 KB (a near-empty desktop page) to 584 KB, and any accidental `SELECT *` becomes catastrophic. Prune targets confirmed by measurement rather than guessed:

- `audits['screenshot-thumbnails']` — **259 KB on one page**, by far the largest single item
- `lighthouseResult.fullPageScreenshot` — 43–78 KB. Note this is a **top-level key, not an audit**; the plan previously listed it as `audits['full-page-screenshot']`, which would have matched nothing.
- `audits['final-screenshot']` (5–33 KB), `audits['script-treemap-data']`, plus `i18n`, `timing`, `stackPacks`, and capped `network-requests` items.

That removes ~70% of the payload on the fixtures measured. Pair with retention (null out `rawJson` older than the last 5 runs per page) and a shared `AUDIT_RESULT_SUMMARY_SELECT` constant used by every list query.

**Verified against real responses on 2026-08-19** (Lighthouse 13.4.1, four recorded fixtures). Confirmed correct: the four-repeated-`category` param shape; all four category scores present as 0–1 floats; `best-practices` needing bracket access; every lab metric audit id; **lab INP absent on every page** (the nullable-INP ruling holds); and **field CLS percentile as an integer 100× the real value** (raw `11` → CLS `0.11`).

Two corrections the fixtures forced, both recorded above: the `load-opportunities` group does not exist in LH13, and `fullPageScreenshot` is a top-level key rather than an audit.

One correction to error handling: a Lighthouse content failure comes back as **HTTP 400 with `error.errors[0].reason === 'lighthouseUserError'`** (message `Lighthouse returned error: NO_FCP`), *not* as a 200 carrying `lighthouseResult.runtimeError`. Since the plan classifies all 400s as permanent-and-don't-store, that would have thrown away a legitimate "this page won't render" result. Split it: a 400 with `lighthouseUserError` is a permanent **content** error that writes an error row; any other 400 is a malformed request and is a bug on our side.

**Still unverified** — two fixtures could not be captured because all three sampled URLs returned page-level field data: a URL with **no** `loadingExperience` at all, and one with `origin_fallback: true`. The extraction code handles both paths and they are unit-tested against hand-built fixtures, but they have not been seen in the wild. Capture them from the real site during M9 (low-traffic deep pages are the natural candidates). Note also that `origin_fallback` is **absent rather than `false`** on page-level data, so the discriminator must treat `undefined` as "not a fallback".

## Schema changes to the spec's reference model

The spec invites additions. None of these restructure the given models.

**`AuditResult`** — `@@unique([auditRunId, pageId, strategy])` *(load-bearing: it is the durable idempotency guarantee)*; `inp` made nullable; new `tbt`, `speedIndex`, `fieldSource`, `fieldOverall`, `fieldLcp/Inp/Cls/Fcp/Ttfb`, `fieldJson` (the ~2 KB trimmed `loadingExperience` blob, not the full response), `runtimeError`, `status` (`ok`|`error`), `finalUrl`, `lighthouseVersion`; `@@index([pageId, strategy, createdAt])`, `@@index([auditRunId, status])`.

Field metrics get real columns rather than being derived from `rawJson` at read time: a 90-day group trend pulls thousands of rows, and per-row JSON path extraction can't use an index or be pushed into a `groupBy`. Nullable floats are free.

**`AuditRun`** — `failedJobs`, `finishedAt`, `skipReason`; `skipped` added to the status vocabulary.

**`Page`** — `isActive` (pages dropped from the sitemap are deactivated, **never deleted** — the audit history is the product), `isManuallyGrouped`, `lastmod`, `latestResultMobileId` / `latestResultDesktopId` denormalized pointers (these turn the 1,000-row page table from a correlated subquery per row into two plain joins).

**New `AuditIssue`** — one row per failing audit per result (`auditResultId`, `auditRunId`, `pageId`, `strategy`, `auditId`, `category`, `group`, `title`, `score`, `savingsMs`, `weight`), with `@@unique([auditResultId, auditId])` and `@@index([auditRunId, strategy, auditId])`.

This is the most important addition. The "Top issues" widget groups the latest result of every page by failing audit id; doing that over `rawJson` means detoasting ~240 MB and running `jsonb_each` over ~180 audit objects per row on every dashboard load, and no index helps — GIN accelerates containment, not grouped aggregation over dynamic keys. With the side table it is one indexed `GROUP BY` (target < 50 ms over 60 k rows, confirmed with `EXPLAIN ANALYZE`). Volume is ~30–60 k rows per sweep, pruned on a retention window.

**New `GroupAlias`** (`slug @unique` → `groupId`) — easy to miss and it breaks merging without it. When `/blog` and `/blogs` are merged into "Blog", the `blogs` slug is gone, so tomorrow's ingest recreates it and pulls the pages back out. Merge and rename must both leave an alias behind.

**`Regression`** table is designed but deferred to stage 4 with the rest of trend tracking.

## Queue, rate limiting, resumability

**The concurrency math is the thing to get right.** By Little's Law, in-flight requests = rate × latency = 0.75 × ~25 s ≈ **19**. So:

```
concurrency: 20                      // NOT 2–4
limiter: { max: 3, duration: 4000 }  // 0.75 req/s, Redis-backed, global
lockDuration: 120_000                // must exceed PSI_TIMEOUT_MS (90 s)
```

Two failure modes here, both quiet. Setting concurrency to 4 gives 0.16 req/s and turns a 44-minute sweep into 3.5 hours — the limiter caps the rate, so concurrency must sit *above* what the limiter needs, not below. And BullMQ's default 30 s `lockDuration` is shorter than a slow PSI call, so the job gets marked stalled and re-delivered while still in flight: the DB constraint saves correctness but you burn double quota.

Expected: 2,000 jobs ÷ 0.75/s ≈ **44 minutes**, matching the spec's estimate.

**Backoff:** 5 attempts, exponential from 30 s capped at 15 min, with jitter. On a 429, call `worker.rateLimit(retryAfterMs)` to pause the **whole queue** and re-queue without consuming an attempt — retrying one job while 19 siblings keep hammering makes a 429 storm worse. Permanent errors throw `UnrecoverableError` to skip remaining attempts.

**Idempotency:** deterministic job ids (`a:${runId}:${pageId}:${strategy}`) dedupe in Redis, but only while the job exists — `removeOnComplete` evicts it eventually, so the DB unique constraint is the real guarantee. The result insert, the `AuditIssue` rows, and the `completedJobs` increment share **one interactive transaction** (timeout 15 s — the 5 s default is tight with 20 concurrent writers). A P2002 means replay: log and return **without** incrementing. Prisma's `{ increment: 1 }` compiles to an atomic `SET x = x + 1`, so no row locking is needed even at 20-way concurrency.

**Failures still count.** An exhausted or permanently-failed job writes an *error row* through the same path (`status: 'error'`, null scores) so `completedJobs` can reach `totalJobs` and the run can finalize. Consequence to remember everywhere: `AuditResult` now contains null-score rows, so every average, trend, and top-issues query must filter `status: 'ok'`. That filter belongs in the shared select constants, not in each call site.

**Finalize without FlowProducer** — a parent with 2,000 children is heavy and one permanently-failed child fails the parent. Instead the transaction's `update` returns the post-increment row; when `completedJobs >= totalJobs`, enqueue a finalize job with a deterministic `jobId`, which makes it idempotent even if two workers cross the threshold at once.

**Resumability, three layers:** (1) worker restart — BullMQ recovers waiting/delayed jobs itself and the stalled checker reclaims active ones, nothing to build; (2) Redis loss — `resumeRun()` re-enqueues only `(page, strategy)` pairs with no `AuditResult` for that run and corrects `completedJobs` from the true row count; (3) boot reconciliation — runs stuck in `running` are resumed, or failed if older than 12 h. Redis needs `--appendonly yes` and a volume, or a container restart silently drops the queue.

**On-demand paths.** A single page runs synchronously — but BullMQ's limiter only governs queued jobs, so the sync path would bypass it and push you over rate during a sweep. Both paths therefore go through a small **Redis token bucket** (`lib/psi/rateLimiter.ts`) that is the real limiter; BullMQ's is a coarse second layer. A group under 15 pages runs synchronously (~40 s) — set `maxDuration = 300` on the route and check the reverse proxy's read timeout, or drop the threshold to 8.

## Sitemap ingestion

`fast-xml-parser` with `removeNSPrefix: true`. **It collapses single-element arrays into objects**, so a one-`<url>` sitemap yields an object — normalize with `Array.isArray(x) ? x : [x]` everywhere. Recurse `<sitemapindex>` at concurrency 5 with a depth cap of 3, a 100-document cap, and a `visited` set (self-referencing indexes are common). Handle `.xml.gz`: detect via content-type or the `0x1f8b` magic bytes and `gunzip` — `fetch` does not auto-decompress those.

Normalization rejects non-http(s), cross-domain `<loc>`s, and asset extensions; lowercases host, drops default ports, clears the fragment, deletes `utm_*` plus `fbclid/gclid/gbraid/wbraid/msclkid/mc_eid/mc_cid/_hsenc/igshid/yclid/ref`, sorts remaining params, and strips the trailing slash except at root. One convention applied everywhere is what makes `Page.url @unique` actually deduplicate.

Grouping takes the first path segment, slugified; root → `General`.

**Two independent manual flags**, which are easy to conflate: `Group.isManual` means the group's *identity* is user-owned (never auto-renamed or deleted), while `Page.isManuallyGrouped` means *this page's assignment* is user-owned (never auto-moved). Renaming a group shouldn't pin every page inside it; moving one page should pin that page.

Ingest in batches of ~200 URLs per transaction, and return a summary DTO including a `rejected: {reason: count}` breakdown — that's what you actually stare at when a sitemap looks wrong.

## Markdown report

`lib/report/markdown.ts` is **pure** — no DB, no clock, no I/O; `generatedAt` is a parameter so snapshot tests are deterministic. Generated once at audit time inside the same transaction as the `AuditResult`, following the spec's template, with a "vs. previous" delta column sourced from one query for the prior successful result.

**The AI section uses HTML-comment sentinels, not heading matching.** The generator always emits `<!-- ai-recommendation:start -->` … `<!-- ai-recommendation:end -->` with placeholder text, so replacement is the only path that normally runs. `upsertAiSection` swaps the inner content using `indexOf` (not a regex — a greedy pattern over a 200 KB string is a needless backtracking hazard), appends a fresh block if the sentinels are missing, and strips any literal sentinel from the model output first.

Splitting on `## AI Recommendation` instead is the obvious approach and it's a trap: the AI body contains its own `##` headings ("## Quick wins"), so the first regeneration truncates the body and each subsequent one eats more of the document. There's an explicit test for this.

## Auth (stage 2)

Single seeded `User`; **bcryptjs cost 12** — argon2 is the better algorithm but needs node-gyp or platform binaries, which is real Docker/CI friction for a credential verified a handful of times a day. Note that reasoning in the README so nobody "fixes" it.

**Stateless JWT in an httpOnly cookie via `jose`.** The deciding reason is that `jose` runs on the Edge runtime, so `proxy.ts` can verify the session; `jsonwebtoken` cannot, and Prisma can't run there either, so a DB-backed session would leave no way to protect everything from one place. `proxy.ts` reads `process.env.SESSION_SECRET` directly — importing `lib/env.ts` there pulls in Node built-ins.

`proxy.ts` sends HTML requests to `/login?next=…` and returns `401` JSON for `/api/*` (not an HTML redirect — that's what makes API errors debuggable, and later what keeps MCP working, since a 302 is not a valid JSON-RPC response). `/api/mcp` is excluded from the matcher for that reason even though it lands in stage 6.

**The proxy is a UX redirect layer, not the authorization boundary.** `app/(dashboard)/layout.tsx` independently calls `requireSession()`, and — important — **every Server Action calls it as its first statement**. Server Actions are public HTTP endpoints reachable by a crafted POST regardless of what the proxy matcher says; relying on the proxy alone would leave every mutation unauthenticated.

Small hardening worth doing now: login rate limit (10 per 15 min per IP via Redis `INCR`), a constant-time dummy bcrypt compare for unknown usernames so response time doesn't leak username validity, and an `Origin` check on non-GET `/api/*` (Server Actions get this from Next for free).

Tradeoff stated honestly: stateless tokens can't be revoked before expiry. A `tokenVersion` claim on `User` fixes it for one extra read if that ever matters; skip for now, note in the README.

## Dashboard (stage 2)

| Route | File | Content |
|---|---|---|
| `/login` | `app/(auth)/login/page.tsx` | Shared username/password, bare layout |
| `/` | `app/(dashboard)/page.tsx` | Group grid + site-wide Top Issues + site header stats |
| `/g/[slug]` | `app/(dashboard)/g/[slug]/page.tsx` | Flat page table for the group |
| `/p/[pageId]` | `app/(dashboard)/p/[pageId]/page.tsx` | Report; `?strategy=mobile\|desktop` |
| `/p/lookup` | route handler | `GET ?url=` → resolves to a pageId and redirects, so an agent can hand a human a URL-addressed deep link |
| `/runs`, `/runs/[runId]` | `app/(dashboard)/runs/…` | Run history and live progress |
| `/settings` | `app/(dashboard)/settings/page.tsx` | Sitemap URL, PSI key, re-ingest (schedule/notifications in stage 3) |

Co-located `loading.tsx` / `error.tsx` on the four data-heavy routes, plus `not-found.tsx`.

**Mutations are Server Actions; route handlers exist only for polled reads, MCP, and cron.** Actions call `lib/services/*` directly — no serialization boundary, no hand-written fetch client, no zod schemas duplicated on both sides. `revalidatePath` re-renders the server component in the same round trip, Next validates `Origin` on action POSTs for free CSRF protection, and login/settings forms still work with JS off. The usual counter-argument — "agents need HTTP mutations" — is already answered by the MCP server calling the same services, so there is no second consumer needing REST.

**Client islands are the exception.** Everything rendering audit data is a Server Component: `ScoreGauge`, `Sparkline`, `CWVCard`, `PageRow`, `GroupCard`, `TopIssuesWidget`, `RegressionBadge`, `FieldDataPanel`. Client-side is limited to forms, dialogs, polling (`ActiveRunsBar`, `RunProgressBar`), action-pending state, and the trend-chart tooltip. Consequence: an 800-row group page ships roughly zero JS for its data. `StrategyToggle` is also server-rendered — two `<Link href="?strategy=…">` styled as tabs, so the strategy is shareable and bookmarkable.

No caching directives on audit routes. They read `cookies()` so they're dynamic anyway, and stale scores in a monitoring tool are a bug. Use `<Suspense>` so the shell paints while the Top Issues aggregate and the big page table stream in.

### Group aggregate: average, with the tail shown alongside

This reverses my earlier draft. Worst-page seemed right — an average lets one 95 hide a 30 — but across 500–1,000 pages in 10–30 groups, worst-page pegs nearly every group to red the moment one page regresses, and it never moves when work lands. That makes the home page an undifferentiated alarm rather than a prioritization surface.

Use the **mean of the latest mobile performance score** across audited pages, and answer the hiding objection structurally: every `GroupCard` also carries the worst page score as a chip linking straight to that page, a three-segment distribution bar of pass/needs-improvement/fail page counts, and the regression count. Mean for triage, tail for panic. Mobile only in the headline — that's what ranking uses; desktop lives behind the toggle.

**Top Issues scopes to the most recent completed full sweep** rather than true latest-per-page: one index range scan, and semantically what a person wants — a consistent site-wide snapshot, not yesterday's sweep mixed with a page someone re-ran ten minutes ago. Below ~10 audited pages it says so instead of ranking a misleading top three.

### Live progress: poll, don't SSE

`GET /api/runs/[runId]/progress` on an adaptive interval (3 s running, 1.5 s under 50 jobs remaining, 5 s queued, 15 s when the tab is hidden, stop at terminal state and fire one `router.refresh()`), with `AbortController` on unmount, skip-if-in-flight, and ×2 backoff to 30 s on network errors behind a "Reconnecting…" state. `GET /api/runs/active` at 10 s feeds a global `ActiveRunsBar` so a sweep started on one screen is visible on every screen.

SSE looks like the sophisticated choice and isn't: the run executes in a **separate worker process** writing progress to Postgres, so a Next SSE handler has no push channel — it would poll Postgres and re-emit, i.e. identical query load plus a long-lived connection that reverse proxies dislike. Real push means `LISTEN/NOTIFY` plumbing. At ≤10 internal users, a 2 s poll of one indexed row is ~5 queries/sec, and polling gives reconnection and backgrounding for free. The upgrade path preserves the `useRunProgress` hook signature if it's ever needed.

### Visual direction

CLAUDE.md pushes distinctive design; this tool is deliberately meant to read like a PSI report — the team pattern-matches on those conventions daily, so deviating costs them accuracy. Split the surface explicitly.

**Copy PSI exactly** where it carries meaning: the three score bands (<50 / 50–89 / 90+) with Lighthouse's own values — bright arcs `#FF4E42` / `#FFA400` / `#0CCE6B` and *separate darker text tones* `#C00000` / `#D04900` / `#068849`, because the bright green and orange fail AA on white; the circular arc gauge; the `▲ ■ ●` bucket glyphs (Lighthouse's colorblind affordance, so nothing is color-only); section order Scores → CWV (field first, then lab) → Opportunities → Diagnostics → Passed; and PSI's exact metric formatting ("2.4 s", "0.08", "180 ms").

**Make it our own** everywhere else: Space Grotesk for all numerals and headings (its wide technical numerals do real work in a number grid, and not being Google Sans is the biggest "this is our tool" signal at zero functional cost), DM Sans for prose. Dense sizing — 13 px base, 36 px rows, `6px 12px` cells, 20 px section gaps, one notch tighter than a marketing site. Flat hairline-bordered cards, **no shadows** except on true overlays. A persistent left rail with the group list plus a sticky bar carrying breadcrumbs, the strategy toggle, and the active-run pill — PSI has neither, being a one-report tool. `font-variant-numeric: tabular-nums` on every numeric cell.

The existing `--accent: #dc2626` gets **demoted** to destructive confirmations and regression badges only, rendered as border + tint rather than a solid fill — a solid red badge would be mistaken for a failing score.

Extend `app/globals.css` with tokens rather than hardcoding hex: surfaces, borders, the six score colors plus 10% tints, the dense type scale, and row/rail dimensions. Dark mode ships as a real `data-theme` toggle (ops people read this at 2 a.m.) with `prefers-color-scheme` as the default, keeping the existing media block as fallback. In dark mode the arcs stay bright for PSI recognition, the *text* tones flip lighter, and tints lift from 10% to 16% — 10% is invisible on near-black.

### Empty and failure states are designed, not spinners

The ones that matter most:

- **No sitemap yet** — the empty state *is* the setup flow: a sentence and an inline sitemap-URL input that submits the ingest action. No separate onboarding screen.
- **Ingested but nothing audited** — dashed-ring gauges and em-dashes, with "0 of 604 pages audited, first sweep runs <next scheduled>". A normal state, not an error.
- **Field data unavailable** — a neutral full-width card, never an error tone: "Chrome UX Report needs roughly 28 days of sufficient traffic before it reports on a specific page. Lab data below is still accurate." If origin data exists it renders underneath with an explicit "showing data for the whole origin" label and a distinct dotted border so it cannot be mistaken for page-level data. If neither exists, the CWV cards drop their field column rather than showing empty slots.
- **Sweep failed** — never discard partial results: "1,204 of 2,000 completed before the run failed — those results are saved", the first 20 failed URLs with errors, and "Retry failed pages only".
- **PSI rate-limited** — its own state, not generic failure: "Paused — PSI quota exceeded, retrying at 14:20." This is the most likely failure at 1,000+ pages/day and it self-resolves.
- **No PSI key** — run buttons disabled with a link to Settings and a persistent banner, rather than letting a run fail mysteriously.

### Accessibility

A tool that reports accessibility scores must pass its own audit, so the target is Lighthouse a11y 100 on every route, enforced by a CI check that runs the auditor against its own dev server.

Two specifics worth fixing now rather than retrofitting. **Expandable sections use native `<details>`/`<summary>`, not a button + `aria-expanded` div** — free keyboard operation and state announcement, works with JS off, and Chrome's find-in-page can search collapsed content, which matters when hunting an audit id across 40 sections. **The progress bar announces on a bucket, not on every tick** — `role="progressbar"` with `aria-valuetext`, plus a separate polite live region that fires only at 25/50/75/100% and terminal state; announcing every 2 s poll would make the page unusable with a screen reader.

Gauges are `role="img"` with a `<title>` giving "Performance: 84 out of 100. Needs improvement." — `role="meter"` was considered and rejected for patchy screen-reader support. The numeral span is `aria-hidden` to avoid a double announcement. Sparklines inside table rows are `aria-hidden` with the summary carried in the row's screen-reader text, so an 800-row table doesn't announce 800 chart labels. Plus the basics: skip link, one `<h1>` per route, global `:focus-visible` ring, real `<table>` semantics with `scope` and `aria-sort`, native `<dialog>` for focus trapping, and `prefers-reduced-motion` disabling the gauge sweep.

## Two Compose files

Ship Studio runs `next dev` on the host, so containerizing the web app locally would break the preview the user is watching.

- **`docker-compose.dev.yml`** — Postgres 17 + Redis 7 (`--appendonly yes`, volume) + the worker. Next stays on the host. This is the day-to-day stack.
- **`docker-compose.yml`** — the full four-service stack plus Caddy, for the VPS, with healthchecks and `depends_on: condition: service_healthy`.

**Runtime: OrbStack** (user's choice) — lighter and faster than Docker Desktop on macOS and sidesteps its business-subscription requirement, while the `docker compose` CLI stays identical. Setup docs target `brew install orbstack`. If containers ever turn out to be blocked entirely, the fallback is `brew install postgresql@17 redis`, not a SQLite abstraction layer: dual Prisma providers would cost days and leave the queue, the rate limiter, and resumability — the highest-risk parts of this build — untested in dev.

`.env.example` documents everything: `DATABASE_URL`, `REDIS_URL`, `PSI_API_KEY`, `PSI_TIMEOUT_MS`, `WORKER_CONCURRENCY`, `PSI_RATE_MAX`/`PSI_RATE_WINDOW_MS`, `SITE_BASE_URL`, `SITE_SITEMAP_URL`, `SYNC_GROUP_PAGE_LIMIT`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, retention knobs, and stage 3+ vars commented out. `lib/env.ts` parses once with zod and throws a readable list of missing keys at boot — both processes should refuse to start rather than fail mid-sweep at 2 a.m. Never prefix any of these `NEXT_PUBLIC_`.

**Put the PSI key in `.env.local` yourself rather than pasting it into chat.**

## Build order — each milestone verifiable without a real sweep

Three things make that possible: recorded PSI fixtures, a fake-PSI mode with simulated latency, and a fixture sitemap.

**M0 — Foundation.** Deps, schema + first migration, `env.ts`, `db.ts`, `logger.ts`, the eslint boundary rule, `serverExternalPackages`. *Verify:* migrate succeeds, Prisma Studio shows every table, typecheck clean, and a deliberate `import 'next/headers'` in a service file **makes lint fail**.

**M1 — PSI extraction (pure, zero network).** Record four fixtures with the real key: a high-traffic URL with full field data, a low-traffic URL with **no** `loadingExperience`, one with `origin_fallback: true`, and one with `runtimeError`. *Verify:* scores are 0–100 ints, `best-practices` resolves, lab INP is null while `tbt` is populated, field CLS `8` → `0.08`, the no-field fixture yields `fieldSource: 'none'` and **throws nothing**, the error fixture yields null scores, and `prune()` cuts payload >60% while still round-tripping.

**M2 — Markdown report (pure).** Snapshot tests over all four fixtures, plus four `upsertAiSection` tests — including the one that matters: an AI body containing `## AI Recommendation` and a literal end-sentinel must not corrupt the document.

**M3 — PSI client + rate limiter.** Injectable `fetch`; classification tested against 429-with-`Retry-After`, 500, 400, truncated body, and timeout. Then `scripts/throughput-dryrun.ts` runs the **real BullMQ worker** against fake PSI (fixture after a random 10–35 s delay), 200 jobs, asserting sustained **0.75 ± 0.05 req/s** and peak in-flight == concurrency. **This is the milestone that validates the assumption the whole system rests on**, in ~4 minutes at zero quota cost. If it fails, stop and report rather than building on it. Then one real PSI call to confirm the params and key work.

**M4 — Sitemap ingestion.** Fixture index → two children (one **gzipped**), 12 `<loc>`s including a cross-domain URL, a `.pdf`, a `?utm_source=` URL, a trailing-slash duplicate, the root, and a single-`<url>` sitemap (catches the array-collapse bug). *Verify:* 8 pages with expected groups; **re-running is a no-op**; after a rename + merge, re-ingest does **not** recreate the merged-away group; a manually-moved page stays put; a URL dropped from the sitemap goes `isActive: false`, not deleted.

**M5 — Queue, idempotency, resumability.** 20 fixture pages, fake PSI. Three separate tests: `kill -9` the worker mid-run (no duplicates, `completedJobs` correct, finalizes exactly once); `FLUSHALL` Redis mid-run then `resumeRun()` (only missing pairs re-enqueued); replay a used `jobId` (P2002 path taken, `completedJobs` unchanged). Plus five forced permanent failures still reaching `completed`.

**M6 — Services for the dashboard.** Latest-per-page, group summaries, top issues. *Verify:* `EXPLAIN ANALYZE` on `topIssues` over a synthetic 60 k-row `AuditIssue` table stays **under 50 ms**.

**M7 — Auth + routes.** *Verify* by curl script: login sets cookie → protected page 200 → `/api/*` without cookie is 401 **JSON** → HTML route 302s → logout clears → 11th login in 15 min rate-limited → foreign-`Origin` POST rejected.

**M8 — Dashboard**, built in dependency order: tokens + `globals.css` + app shell + `proxy.ts` + `/login`; then `scoreBucket` + `ScoreGauge` + `Sparkline` against fixtures (the three primitives everything composes); then `/g/[slug]` **before** `/` — the group view is the simplest real screen and exercises the list DTOs; then `/p/[pageId]`, the largest surface; then `/` with Top Issues; then runs and progress polling; then `/settings`.

*Verify* with the Ship Studio preview tools: home renders groups + Top Issues, group view lists pages, report view renders both strategies **including a page with no field data**, keyboard-only navigation reaches every expandable section, and the dark-mode toggle holds contrast. Then run the auditor **against its own dev server** — a11y must be 100 and performance ≥ 90. Shipping a slow, inaccessible performance dashboard is a credibility problem, not just a technical one.

**M9 — Real 50-page canary.** Real sitemap and key, limit 50 pages (100 calls ≈ 2.5 min). Watch the Google Cloud quota dashboard, confirm zero 429s, and spot-check three reports against the PSI web UI for the same URLs. **Only after this passes is the limit removed.**

**M10 — `SITE.md`** describing the tool in plain language, per CLAUDE.md.

## Highest-risk items

1. Worker concurrency set too low — the difference between a 44-minute and a 3.5-hour sweep. Caught by M3.
2. `lockDuration` below `PSI_TIMEOUT_MS` — silent duplicate PSI calls burning quota.
3. TBT written into the `inp` column — poisons every trend, invisibly.
4. Field CLS not divided by 100 — every page looks catastrophic on field CLS.
5. `rawJson` stored unpruned — ~500 GB/year and slow queries wherever `select` is omitted.
6. `GroupAlias` omitted — merged groups silently reappear on the next ingest.
7. jsonb aggregation for Top Issues — unusable dashboard loads, unfixable without the side table.

## Flagged, not silently decided

- **CLAUDE.md gets rewritten for this tool** (confirmed with the user). The Ship Studio template tells future sessions to run `/onboarding` and build a landing page, which actively misleads on an internal data tool. The replacement carries what matters here: the service-layer import boundary, the PSI extraction traps, the queue invariants (`status: 'ok'` filtering, idempotency), and how to run the stack. Useful habits from the original are kept — Tailwind for styling, no `.html` files, keep the docs current.
- **Localized URL folders** (`/en/`, `/fr/`) would make first-segment grouping group by language. Not a problem today; noted per the spec's addendum.
- **Schema additions** (nullable INP, TBT, field columns, `AuditIssue`, `GroupAlias`, `isActive`) are reasoned above, not assumed.
- **`AuditResult` now holds error rows**, so every aggregate query must filter `status: 'ok'`.

## Out of scope this pass

Stages 3–6: scheduling and the cron builder, email/Slack notifications, trend charts and regression flags, AI recommendations, and the MCP server. The schema, the service boundary, and the `RecommendationProvider` seam are laid out so these attach without rework.

Two decisions already settled for stage 6 so they aren't re-derived: MCP lives at `app/api/mcp/route.ts` **in-process**, not as a separate service — the v2 SDK is stateless, so the session-affinity argument that used to justify splitting it out no longer applies, and in-process means the tools call `lib/services/*` as ordinary functions with no network hop and no duplicated DTOs. And the surface stays schedule-only: there is deliberately no `run_full_sweep` tool, with a test asserting it never appears, plus wording in `run_group_audit`'s description telling the model that whole-site sweeps run only on the schedule — otherwise it will try to fake one by looping over every group.
