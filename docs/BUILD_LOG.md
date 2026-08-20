# Build Log — Internal PageSpeed Auditor

> **Purpose of this file.** A running, tool-agnostic record of what has been built,
> what is in progress, and what comes next — so this work can be picked up by any
> agent or person (Claude Code, Antigravity, Codex, or a human) without replaying
> the original conversation.
>
> **Read `docs/PLAN.md` first.** It is the approved build plan and the source of
> truth for architecture, schema, and verification steps. `docs/SPEC.md` is the
> original brief it was derived from, and `docs/DECISIONS.md` records why each
> direction was chosen and what was rejected. This file only tracks *state*:
> what is done and what is not.
>
> Nothing needed to continue this work lives outside the repo.
>
> **Keep this updated.** Append to the Session Log at the bottom after every
> meaningful change. Do not rewrite history in it.

---

## What this project is

An internal tool that audits every page of one company website (~500–1,000 pages)
through the Google PageSpeed Insights API on both mobile and desktop, stores every
run as history, and surfaces it in a dashboard modelled on pagespeed.web.dev.
A second front door (an MCP server, stage 6) exposes the same backend to AI agents.

Full context, locked decisions, and reasoning: `docs/PLAN.md`.

**Current scope: stages 1–2 only** (ingestion + PSI + queue + storage, then the
dashboard). Stages 3–6 are explicitly out of scope until this pass is reviewed.

---

## Milestone status

Milestone definitions and their verification steps are in `docs/PLAN.md`
("Build order"). Status here only.

| ID | Milestone | Status |
|----|-----------|--------|
| M0 | Foundation — deps, schema, env, db, logger, eslint boundary | **done** (migration pending Docker) |
| M1 | PSI extraction (pure, fixture-driven) | **done** — 47 tests passing against real fixtures |
| M2 | Markdown report (pure) | **done** — 17 tests |
| M3 | PSI client + rate limiter + throughput dry-run | **done** — gate PASSED |
| M4 | Sitemap ingestion | **done** — 747 real pages ingested, invariants verified |
| M5 | Queue, idempotency, resumability | **done** — audit path verified against the live API |
| M6 | Services for the dashboard | **done** (from the workflow) |
| M7 | Auth + routes | **done** (from the workflow) |
| M8 | Dashboard | **done** — all four routes rendering real data |
| M9 | Real 50-page canary | **done** |
| M10 | SITE.md | **done** |

**M3 is the gate.** It validates the ~0.75 req/s sustained-throughput assumption
that every duration estimate in the plan depends on. If it fails, stop and
re-plan rather than building on top of it.

---

## Blockers / needed from the user

| Item | Why | Status |
|---|---|---|
| OrbStack installed + launched | Provides Postgres 17 + Redis 7. | **done** — installed, running, both containers healthy |
| `PSI_API_KEY` in `.env` | Mandatory — the keyless PSI endpoint returns `429 Quota exceeded` (verified). Note: Prisma reads `.env`, not `.env.local`. | **done** — key present and verified working |
| `SITE_SITEMAP_URL` in `.env` | Needed for M4 ingestion. | **done** — set to `https://www.zuddl.com/sitemap.xml` |
| Anthropic credentials | Only needed at stage 5 (AI recommendations). Not a blocker now. | deferred |

Work that does **not** need any of the above: M0 file scaffolding, M1 and M2
(both are pure functions tested against committed fixtures), and most of M3's
client logic (injectable `fetch`).

---

## Environment facts (verified, not assumed)

- Next **16.1.2**, React 19.2.3, Tailwind **v4** (CSS-first; there is no
  `tailwind.config.js` and there should not be one), TypeScript 5.9.3.
- Node **v26.5.0** — `node --test --experimental-strip-types` runs TS tests
  directly. No jest/vitest is installed and none is needed.
- App Router lives at the **repo root** `app/`, not `src/app/`. Path alias
  `@/*` → `./*`.
- **Next 16 uses `proxy.ts`, not `middleware.ts`.** Confirmed in
  `node_modules/next/dist/lib/constants.js`: both `PROXY_FILENAME = 'proxy'`
  and the legacy `MIDDLEWARE_FILENAME = 'middleware'` are defined. Use `proxy.ts`.
- **Ship Studio runs `next dev` on the host**, not in a container. Local dev must
  therefore NOT containerize the Next app — only Postgres, Redis, and the worker.
  Containerizing the web app breaks the live preview the user watches.
- **npm 12 blocks install scripts by default.** Prisma's engine download is a
  postinstall script, so it must be approved or Prisma silently has no engine:
  `npm install-scripts approve prisma @prisma/engines sharp unrs-resolver`
  (already done; recorded here because a fresh `npm ci` on another machine will
  hit the same wall).
- **Prisma 7 removed `url` from the `datasource` block.** It now lives in
  `prisma.config.ts` (used by the CLI: migrate/studio/generate), and the runtime
  client takes a **driver adapter** instead — `PrismaPg` from
  `@prisma/adapter-pg`, wired in `lib/db.ts`. Prisma reads `.env`, not
  `.env.local`. Following a Prisma 6-era tutorial here will fail with P1012.
- **`next lint` was removed in Next 16.** Use `npx eslint .` / `npm run lint`.
- `msgpackr-extract` remains unapproved — it is an optional native accelerator
  for BullMQ's serializer and falls back to pure JS. Not a blocker.

---

## Decisions that are settled — do not re-litigate

These were argued through and approved. Changing one means re-reading the
reasoning in `docs/PLAN.md` first, not just preferring something else.

- **Postgres + Prisma; BullMQ + Redis.** No SQLite fallback, no in-process queue.
- **Worker concurrency 20, limiter 3 per 4 s (= 0.75 req/s).** Concurrency must
  sit *above* what the limiter needs (Little's Law: 0.75 × ~25 s latency ≈ 19).
  Setting it to 2–4 silently turns a 44-minute sweep into 3.5+ hours.
- **`lockDuration` (120 s) must exceed `PSI_TIMEOUT_MS` (90 s)** or in-flight jobs
  get marked stalled and re-delivered, doubling quota burn.
- **INP is field-only.** `AuditResult.inp` is nullable and comes only from CrUX.
  TBT gets its own column as the lab proxy. Never write TBT into `inp`.
- **Field CLS percentile is CLS × 100** — divide by 100 on extraction.
- **`AuditIssue` side table** for Top Issues. Never aggregate over `rawJson`.
- **`rawJson` is pruned before storage** and retention-capped.
- **`GroupAlias` table** so merged/renamed groups don't reappear on re-ingest.
- **Group aggregate = mean**, with worst-page chip + distribution bar alongside.
- **Full sweeps are schedule-only.** No manual "run everything" button, and no
  `run_full_sweep` MCP tool, ever.
- **Server Actions for all UI mutations**; route handlers only for polled reads,
  MCP, and cron. Every Server Action calls `requireSession()` as its first
  statement — `proxy.ts` is a UX redirect layer, not the auth boundary.
- **No charting library.** Hand-rolled SVG gauge + sparkline.
- **Container runtime is OrbStack** (avoids the Docker Desktop licence question).

---

## Architecture boundary (enforced, not aspirational)

Nothing under `lib/services/`, `lib/psi/`, `lib/queue/`, `lib/report/`, or
`lib/sitemap/` may import `next/*`, `react`, or `server-only`. The worker is a
bare Node process that imports these directly; one stray Next import breaks it at
load time, and this boundary is what lets the stage-6 MCP server reuse the
service layer untouched.

This is enforced by a `no-restricted-imports` rule in `eslint.config.mjs`.
If you change that file, re-verify the rule still bites by adding a deliberate
bad import and confirming `npm run lint` fails.

---

## Session log

Append newest entries at the bottom. One line per meaningful change.

### 2026-08-19

- Explored the repo: empty Ship Studio Next 16 starter, nothing reusable beyond
  the `@theme inline` tokens in `app/globals.css` and the `next/font` setup.
- Verified the keyless PSI endpoint is quota-exhausted (`429`), so an API key is
  mandatory for all development.
- Verified Next 16's `proxy.ts` convention and the existence of MCP SDK v2
  (`@modelcontextprotocol/server@2.0.0`, `mcp-handler@2.1.1`).
- Wrote and got approval on the build plan → `docs/PLAN.md`.
- **M0**: installed runtime deps — prisma 7.9.1, @prisma/client 7.9.1,
  bullmq 6.1.2, ioredis 6.0.0, fast-xml-parser 5.11.0, zod 4.4.3, pino,
  pino-pretty, jose 6.2.9, bcryptjs 3.0.3.
- **M0**: hit npm 12's blocked-install-scripts default; approved Prisma's engine
  postinstall. `npx prisma --version` now resolves cleanly.

- **M0 complete.** Written and verified:
  - `prisma/schema.prisma` — full model incl. the approved additions
    (`AuditIssue`, `GroupAlias`, nullable `inp`, `tbt`, field-data columns,
    `isActive`, `@@unique([auditRunId, pageId, strategy])`). Every deviation from
    the original spec is commented `SPEC+` with its reason, inline.
  - `prisma.config.ts` + `lib/db.ts` — Prisma 7 config/adapter split, plus the
    shared `AUDIT_RESULT_SUMMARY_SELECT` that keeps `rawJson` out of list queries.
  - `lib/env.ts` — zod-validated, frozen. Hard-fails at boot if
    `QUEUE_LOCK_DURATION_MS <= PSI_TIMEOUT_MS`, because that misconfiguration
    silently doubles PSI quota burn rather than erroring.
  - `lib/errors.ts`, `lib/logger.ts` — retryable/permanent split; per-run and
    per-job child loggers.
  - `eslint.config.mjs` — the architecture-boundary rule. **Verified by planting
    an `import 'next/headers'` in `lib/services/` and confirming lint fails**,
    then removing it. `.shipstudio/**` is ignored (vendored plugin source, 3
    pre-existing errors that are not ours).
  - `next.config.ts` — `serverExternalPackages` for Prisma/BullMQ/pg/pino.
  - `docker-compose.dev.yml` — Postgres 17 + Redis 7 only, `--appendonly yes`.
    Deliberately no web service: Ship Studio runs `next dev` on the host.
  - `.env.example` (committed) and `.env` (gitignored, seeded from it).
  - `package.json` scripts: `db:up`, `db:migrate`, `worker`, `test`,
    `throughput-dryrun`, `hash-password`.
  - Verification: `npx tsc --noEmit` exit 0, `npx eslint .` exit 0,
    `npx prisma validate` passes, `npx prisma generate` succeeds.
- **Not yet run:** `prisma migrate dev` — needs Postgres, which needs OrbStack.
  No migration files exist yet; the first one is created the moment Docker is up.

- **Docs restructured for tool-agnostic handoff**, at the user's request:
  `docs/PLAN.md` (authoritative), `docs/SPEC.md` (original brief),
  `docs/DECISIONS.md` (why each direction was chosen + what was rejected),
  `README.md`, and a rewritten `CLAUDE.md`. The Ship Studio marketing template
  that previously occupied `CLAUDE.md` is preserved at
  `docs/CLAUDE.shipstudio-original.md`.
- **M0 extras**: `prisma/seed.ts` (idempotent; user + site + disabled schedule
  and notification rows) and `scripts/hash-password.ts` (bcrypt cost 12, refuses
  passwords under 12 chars). `prisma/seed.ts` is wired into `prisma.config.ts`,
  so its absence would have broken the first `prisma migrate dev`.

### M1 — PSI fixtures recorded, and what they invalidated

Four real PSI calls recorded to `test/fixtures/psi/` (1.2 MB total) against
public, third-party URLs — no company data left the machine. Lighthouse **13.4.1**.

**Measured PSI latency: 11–24 s per call.** This is the number the whole
concurrency design rests on, and it confirms the Little's Law figure
(0.75 req/s x ~25 s = ~19 in flight). Concurrency 20 is right.

Confirmed correct, previously only assumed:
- Four repeated `category` params; all four category scores present as 0–1 floats.
- Every lab metric audit id resolves (`largest-contentful-paint`,
  `cumulative-layout-shift`, `first-contentful-paint`, `server-response-time`,
  `total-blocking-time`, `speed-index`).
- **Lab INP is absent on every single page** — the nullable-INP ruling holds.
- **Field CLS percentile really is CLS x 100** — observed raw `11` for CLS `0.11`.

**Four assumptions the fixtures proved wrong** (all now corrected in
`docs/PLAN.md`; each would have failed silently rather than loudly):

1. **The `load-opportunities` audit group does not exist in Lighthouse 13.**
   Performance groups are `metrics` (5), `insights` (16), `diagnostics` (11),
   `hidden` (15). Filtering on `load-opportunities` would have produced an empty
   opportunities list on every page — which reads as a healthy site, not a bug.
   Map `insights` -> opportunity, `diagnostics` -> diagnostic.
2. **`weight` is `0` for every insight and diagnostic** — only `metrics` carry it.
   Any ranking by weight is a no-op.
3. **`details.overallSavingsMs` is null or 0 almost everywhere**; `metricSavings`
   (`{LCP, FCP, CLS, TBT}`) is the real signal. The planned fallback becomes the
   primary. Don't add CLS (unitless) into a millisecond total.
4. **`fullPageScreenshot` is a top-level `lighthouseResult` key, not an audit.**
   The prune list had it as `audits['full-page-screenshot']`, which matches
   nothing — 43–78 KB kept per row. Biggest single item is actually
   `audits['screenshot-thumbnails']` at **259 KB**.

Also: the `hidden` group is **not** blanket-skippable — it contains real failing
audits (`layout-shifts`, score 0, with CLS savings) alongside the screenshots.
Filter it by `details.type` instead.

And one error-handling correction: a Lighthouse content failure comes back as
**HTTP 400 with `error.errors[0].reason === 'lighthouseUserError'`**
(`Lighthouse returned error: NO_FCP`), *not* a 200 carrying
`lighthouseResult.runtimeError`. The plan classified all 400s as
permanent-and-discard, which would have thrown away a legitimate "this page
won't render" result.

**Two fixtures still missing.** All three sampled URLs returned page-level field
data, so there is no fixture for (a) `loadingExperience` absent entirely, or
(b) `origin_fallback: true`. Both code paths will be unit-tested against
hand-built fixtures, but neither has been seen in the wild — capture them from
the real site during M9. Note `origin_fallback` is **absent rather than `false`**
on page-level data, so the discriminator must treat `undefined` as "not a
fallback".

### Audit of the repo (requested)

Checked and clean: `.env` is gitignored, `.env.example` holds no real key, no
`AIza` literal anywhere outside `.env`, and the recorded fixtures contain no key.

Gaps found, and their status:

| Gap | Status |
|---|---|
| **No git repository** | **Fixed** — `git init` + initial commit `aa6ccbe`, after verifying no `.env` and no API key were staged. |
| `prisma/seed.ts`, `scripts/hash-password.ts` referenced but missing | **Fixed** — both written and smoke-tested. |
| `CLAUDE.md` still the marketing-site template | **Fixed** — rewritten; original preserved. |
| `docs/DECISIONS.md` orphaned (unlinked) | **Fixed** — linked from README and this file. |
| `lib/queue/worker.ts`, `scripts/throughput-dryrun.ts`, `proxy.ts`, `docker-compose.yml`, `Dockerfile.*` referenced but missing | **Expected** — these belong to M3/M5/M8/M12. Listed here so the dangling references aren't mistaken for oversights. |
| `SITE.md` absent | **Deferred to M10**, per the plan. |
| Sitemap fixtures | **Done** — index, gzipped child, single-`<url>`, cross-domain, asset, utm and trailing-slash duplicates. |
| `prisma/migrations/` empty | **Blocked on Docker.** The first migration is created the moment the dev stack is up. |

### M1 complete — extraction written and tested

`lib/psi/{types,buckets,extract,prune}.ts`, with `test/{buckets,extract}.test.ts`.
**47 tests, all passing**, asserted against the recorded Lighthouse 13.4.1
responses rather than against documentation.

Prune measured on the real fixtures:

| Fixture | Before | After | Removed |
|---|---:|---:|---:|
| desktop-basic | 152 KB | 94 KB | 38% |
| mobile-field-full | 330 KB | 107 KB | 68% |
| mobile-no-field | 482 KB | 140 KB | 71% |

(The desktop fixture prunes least because a near-empty page has little
screenshot payload to begin with.)

Tests deliberately pin the things that would otherwise fail silently: lab INP is
null while TBT is populated; CLS field percentile 11 becomes 0.11; the
`insights` group produces a non-empty opportunity list; metric-group audits are
excluded so they don't double-count; CLS savings never enter a millisecond
total; `origin_fallback` absent still means page-level; and pruning does not
disturb extraction.

**One structural change worth knowing about:** `lib/` no longer uses the `@/*`
path alias — it uses relative imports with explicit `.ts` extensions. The alias
is a bundler/tsc concept that **Node's native type-stripping does not resolve**,
so `node --test` and the bare worker process both failed on it. Since the whole
point of the framework-free zone is that plain Node can run it, relative imports
are the correct form here. ESLint now restricts `@/lib/*` inside that tree so it
cannot silently regress. `app/` and `components/` still use `@/` normally.

Also set `allowImportingTsExtensions: true` in tsconfig (safe — `noEmit` was
already on) so tsc accepts the extensions Node requires.


### Infrastructure live

OrbStack installed and running; `docker-compose.dev.yml` up with Postgres 17 and
Redis 7 both healthy. First migration applied (`20260819122746_init`) — all 11
tables present. Seed run: the Site row points at `https://www.zuddl.com`.
`SESSION_SECRET` generated. `AUTH_PASSWORD_HASH` still empty (M7; the password is
the user's to choose — `npm run hash-password -- '...'`).

`SITE_NAME` is still the default `"Company Site"` — cosmetic, appears in the UI
header. Worth changing to `Zuddl`.

Git initialised and committed as `aa6ccbe`, after verifying the staged set
contained no `.env` file and no occurrence of the API key.

### M2 complete — markdown report

`lib/report/{format,aiSection,markdown}.ts`, 17 tests. Pure and deterministic
(`generatedAt` is a parameter). Two tests exist specifically for the failure mode
that motivated the sentinel design: an AI body containing its own `##` headings,
and a body echoing a literal sentinel. Both must leave the document splice-able
afterwards — the real hazard is a report that can never be updated again.

### M3 complete — THE GATE PASSED

`lib/psi/{rateLimiter,client}.ts`, `lib/queue/connection.ts`,
`scripts/throughput-dryrun.ts`, 13 client tests.

The rate limiter is a Redis token bucket implemented as a single Lua script, so
check-and-increment is atomic — with 20 concurrent workers a read-then-write in
JS would let several through at once. It is deliberately separate from BullMQ's
own limiter, because BullMQ's only governs *queued* jobs and a synchronous
single-page audit would bypass it.

**Measured against real Redis with PSI latency simulated at the observed 11–24 s:**

| | |
|---|---|
| Target | 0.750 req/s |
| **Steady-state achieved** | **0.695 req/s** (within the ±0.08 tolerance) |
| Peak in flight | 15 of 20 concurrency |
| Projected 2000-call sweep | **48 minutes** |

Peak in-flight of 15 against a concurrency of 20 is the important detail: it
confirms the *limiter* is the bottleneck rather than the worker pool, which is
the correct configuration. The steady-state sitting slightly under target comes
from fixed-bucket boundaries in the sliding window, and erring under the limit
is the safe direction.

**The 0.75 assumption holds. The schedule-only design and the ~44-minute sweep
estimate are sound.**

Client error classification is tested against the captured live 400 body: a
Lighthouse content failure (`lighthouseUserError` / `NO_FCP`) is classified
`content` and becomes a stored error row, while other 400s stay `permanent`.

### Counterfactual: why concurrency 20 and not 4

Ran the same dry-run at `WORKER_CONCURRENCY=4` -- the value my first draft
specified -- to check the correction empirically rather than trusting arithmetic:

| | concurrency 20 | concurrency 4 |
|---|---|---|
| Steady-state | **0.695 req/s** | 0.225 req/s |
| Peak in flight | 15 of 20 | **4 of 4 (pinned)** |
| 2000-call sweep | **48 min** | **148 min** |

In-flight pinned at the ceiling is the signature of the worker pool throttling
rather than the limiter. The original draft would have made every sweep roughly
three times slower, with no error and nothing in the logs to explain it.

### M4 complete -- sitemap ingestion

`lib/sitemap/{normalize,fetch,group}.ts`,
`lib/services/{ingest,group}.service.ts`, 19 unit tests plus a 15-assertion
database integration check.

**Real ingest of www.zuddl.com:**

| | |
|---|---|
| Pages discovered | **747** |
| Groups derived | 68 |
| Duplicates collapsed | 0 |
| Rejected | none |
| Sitemap documents | 1 (flat, no index) |
| Ingest time | 0.7 s |
| **Full sweep** | **1,494 PSI calls -> ~33 min** |

Re-running is a clean no-op: 0 created, 0 regrouped, 0 groups created,
0 deactivated.

`npm run verify:ingest` exercises the invariants against a throwaway Site row
served from fixtures, so real data is never touched. All 15 pass, including the
ones most likely to break silently:

- a merged-away group does **not** reappear on re-ingest and does not drag its
  pages back out (this is what `GroupAlias` is for);
- a renamed-away slug likewise does not reappear;
- a page with `isManuallyGrouped` is **not** moved back;
- a URL dropped from the sitemap is deactivated, **not deleted** -- all 6 rows
  survive when only 1 remains listed.

New scripts: `npm run inspect-sitemap` (crawl/normalize/group report, writes
nothing), `npm run ingest` (supports `-- --dry`), `npm run verify:ingest`.

### Finding for the user: 42 of 68 groups hold a single page

The spec's first-path-segment rule, applied to this site, produces a long tail.
`blog` alone holds 324 pages (43% of the site) while 42 groups hold exactly one.
The dashboard home would render 68 cards, most of them one page.

The fix mechanism exists and is tested -- manual merge -- but doing it by hand
42 times is not reasonable. Some pairs are already obvious (`ebooks` 26 /
`ebook` 5; `author`, `blog-topic`, `event-type` look like taxonomy pages rather
than content). **This is a product decision, not a bug**, and it is deliberately
not being changed unilaterally because the grouping rule is spec-locked. Options
to put to the user: leave it and merge by hand; fold groups under a page-count
threshold into "Other"; or add a merge-suggestion step to Settings.

### Multi-agent workflow for M5-M7 (in progress)

At the user's request, stages M5 (queue/worker), M6 (dashboard read services)
and M7 (auth) are being built by a background workflow -- three parallel lanes
on disjoint file sets, each adversarially verified as it lands, then a single
integration pass that typechecks all three together.

Coordination done up front, before launching, because parallel agents left to
themselves produce near-duplicate incompatible types: `lib/services/types.ts`
defines every shared DTO in one place, and the three lanes own strictly
non-overlapping file sets. Each agent was handed `docs/PLAN.md`,
`docs/DECISIONS.md` and the hard rules -- including "do not optimise the
concurrency numbers, they are measured" -- so it cannot quietly undo a decision
we already paid to learn.

**The session hit its usage limit mid-run and the workflow was resumed.** Two
things to know about that:

- Lane files that had already been written were swept into commit `45a3790`
  (the RESUME_HERE commit) by a `git add -A`, so they are committed but were
  never verified by the integration pass. They must not be trusted until
  typecheck, lint and tests are green.
- `lib/services/audit.service.ts` was absent at resume time, so the M5 lane had
  not finished. On resume, completed agents return cached results and only the
  unfinished work re-runs.

Verification gate before any of this is trusted:

```
npx tsc --noEmit && npx eslint . && npm test
```

The last fully green commit is `057c6b6`. If the workflow output cannot be made
green, `git checkout -- . && git clean -fd` from there is a safe reset.


### The multi-agent workflow: what it produced, and why it was stopped

**Stopped deliberately.** The journal showed 8 `started` entries and ZERO
completions: agents were doing real work, dying before returning their
structured result, and being respawned on the same cache key. Because nothing
was ever cached, each resume re-ran everything. Three generations of the same
three lanes ran without converging, so it was killed rather than left to churn.

Worth recording as a process lesson: background work writing files is not the
same as background work *completing*. The journal (`journal.jsonl` in the
workflow transcript dir) is the authoritative progress record and should be
checked early, not assumed.

What it did produce was good, and was kept:
- **M6 read services** — `results`, `issues`, `site`, `report` (~1,100 lines)
- **M7 auth** — password, session, `lib/http/*`, `proxy.ts`, login page, actions
- **M5 partial** — `lib/queue/{names,jobs,queues,producers}.ts` and a thorough
  `run.service.ts` (425 lines: run lifecycle, resume, reconcile, pure helpers)
- Test count went 96 -> 121, all passing

Finished by hand afterwards: `lib/services/audit.service.ts` (the write path),
the three processors, and `lib/queue/worker.ts`.

Two API details the lane agents had wrong, both caught by typecheck:
`Worker.RateLimitError()` is static on Worker, not Job; and `worker.rateLimit()`
is deprecated in BullMQ v6 in favour of `queue.rateLimit()`.

### M5 complete — verified against the live API

`npm run verify:audit` makes one real PSI call and checks 17 invariants.
16 passed first time. Real result for the homepage:

| | |
|---|---|
| Performance | **56** |
| Accessibility | 87 |
| Best Practices | 77 |
| SEO | 92 |
| LCP | 8.0 s |
| Issues extracted | 16 `AuditIssue` rows |

Confirmed by that run: lab INP is null while TBT is populated and NOT copied
into it; field CLS is a real value rather than x100; the markdown report and its
AI sentinel are generated; `Page.latestResult*Id` pointers are set; **a replayed
job writes no second row and does not increment `completedJobs`**; and finalize
is idempotent.

### Two findings from the real run that changed the configuration

**1. `rawJson` was under-pruned.** The one failing assertion. 50 items per audit
was too generous against a real marketing page — `target-size` alone was 36 KB
across only 28 items, because each item embeds a DOM node snippet. The item
*count* was never the problem; the per-item payload was. Prune now caps items at
10 and truncates strings inside them to 200 chars. Result: 157 KB per row,
~229 MB per sweep, ~1.1 GB steady state at 5-run retention.

**2. Real PSI latency is ~60 s, not the 11–24 s measured against test sites.**
This matters more. Little's Law says in-flight must equal rate x latency, so at
60 s the requirement is 0.75 x 60 = 45 concurrent, not 19. **At the old
concurrency of 20 the ceiling would have been 20/60 = 0.33 req/s — a 75-minute
sweep instead of 33, with the pool silently throttling and nothing in the logs
to say so.** This is the same failure mode corrected during planning, resurfacing
because the original latency figure came from light test pages rather than the
real site.

`WORKER_CONCURRENCY` is now **48**. Raising it does not hit PSI harder — the
Redis token bucket caps the request rate regardless; it only allows more calls
to be waiting at once.


### Throughput re-verified at REAL latency — gate still passes

The earlier gate used 11-24 s latency measured against light test pages. Re-run
at the ~60 s the real site actually takes, 240 jobs, concurrency 48:

| | |
|---|---|
| Steady-state | **0.724 req/s** (target 0.750) |
| Peak in flight | 48 of 48 |
| Projected 2000-call sweep | **46 min** (so ~34 min for this site's 1,494) |

Peak sitting exactly at the concurrency ceiling means there is no headroom left;
if page latency creeps above 60 s, raise `WORKER_CONCURRENCY` again. The token
bucket caps the request rate regardless, so raising it never hits PSI harder.

### Login: a real bug found by testing it, not by reading it

Login silently failed with "No password is configured" even though `.env`
contained a valid 60-character bcrypt hash that `dotenv` parsed correctly.

**Cause: Next loads `.env` through `dotenv-expand`, which treats `$` as variable
interpolation.** A bcrypt hash is `$2b$12$...`, so `$2b` and `$12` were expanded
to empty strings and the hash arrived as **29 characters instead of 60**.
Confirmed directly against `@next/env`:

```
@next/env sees length: 29
value: ".O0qeV5oCNHng4HJQwSsQOX9oHBlK"
```

Meanwhile the worker and every `tsx` script use plain `dotenv`, which does no
expansion and saw the correct value -- so the same `.env` behaved differently in
two halves of the same system. That is exactly the kind of bug that survives
code review: every individual file is correct.

**Fix:** the hash is stored escaped (`\$2b\$12\$...`). dotenv-expand unescapes
it; `lib/env.ts` unescapes it for everyone else. Both paths converge on the same
value, and a hand-pasted unescaped hash still works. `npm run set-password`
writes the escaped form directly into `.env` so there is nothing to copy by hand.

**Verified end to end in a real browser** (Playwright, not curl -- a Server
Action needs Next's own POST protocol, so the earlier curl test was meaningless):
`/` redirects to `/login?next=%2F`, correct credentials redirect back to `/`,
and a wrong password is rejected with a generic message.

Note for M8: after login you currently land on the Ship Studio placeholder page,
because the dashboard is the remaining milestone.


### M8 complete -- the dashboard

Routes: `/` (overview), `/g/[slug]`, `/p/[pageId]`, `/settings`, plus `/login`.
All render against real data; typecheck, lint and 121 tests green.

Everything that renders audit data is a Server Component -- `ScoreGauge`,
`ScorePill`, `PageTable`, `GroupCard`, `TopIssuesWidget`, `CWVGrid`,
`FieldDataPanel`, `AuditSection`. A 300-row group page therefore ships
essentially no JavaScript for its data, which is the whole reason no charting
library was added: Recharts would turn every sparkline into a client island, and
shipping a slow dashboard from a performance tool is a credibility problem.

`app/page.tsx` (the Ship Studio placeholder) was deleted -- it collided with
`app/(dash)/page.tsx` on the `/` route.

Design decisions carried through from the plan: Lighthouse's exact score colours
with separate darker tones for text (the bright green and orange fail AA on
white), the arc gauge, the `▲ ■ ●` band glyphs so nothing is colour-only, 13px
base with 36px rows, flat hairline cards and no shadows, and a left rail of
groups that PSI does not have because it is a one-report-at-a-time tool.

`AuditSection` uses native `<details>` rather than a button plus
`aria-expanded`: free keyboard operation, works without JS, and Chrome's
find-in-page can search collapsed content -- which is how someone actually hunts
for an audit id across forty sections.

The 42 single-page groups collapse into one expandable "Small groups" card, as
decided in DECISIONS.md 5.1. The data model is untouched.

### First real audit run: 10 pages of /platform

| | |
|---|---|
| Audited | 10 pages, mobile |
| Wall clock | 6.7 min |
| Performance range | **34 – 85** |
| Failed to render | **2 pages** (`FAILED_DOCUMENT_REQUEST`) |
| Issues extracted | 153 `AuditIssue` rows total |

The two failures are a real finding rather than a bug: those pages under
`/platform/event-registration-and-ticketing-software/` do not render for
Lighthouse at all. They are stored as error rows, which is exactly why
`completedJobs` could still reach 10/10 and the run finalized cleanly with
`failedJobs: 2`.

Worth flagging to the team: the homepage scores **56** with an **8.0 s LCP**, and
`/platform/ai-agents` scores **34** with a **14.5 s LCP**.

### Operational notes

- Turbopack's filesystem cache corrupted itself mid-session and made one route
  return `ERR_ABORTED`. `rm -rf .next` and restart fixes it; it is not a code
  fault, but it is worth recognising rather than debugging the route.
- `SITE_NAME` is now `Zuddl` in both `.env` and the database.
- A login password is set. Change it with `npm run set-password -- '...'`.


## Stages 3-6 and M9 complete

### Defects the user found that code review would not have

Six issues were reported after using the tool. Four were real defects; two were
questions. All are fixed or answered.

1. **No way to re-run an audit.** Added on-demand re-run for a page or a group,
   always queued rather than inline -- at ~50 s per call even one page in both
   strategies is a two-minute request no HTTP call should hold open.
2. **Audit details were invisible.** Descriptions were fetched behind an opt-in
   flag the page never passed, and the evidence tables were never extracted at
   all. Both now render, with Lighthouse's heading-shape drift flattened in the
   service and pruning-truncated tables labelled as such.
3. **"Why only mobile scores?"** The PSI API returns ONE strategy per call --
   pagespeed.web.dev shows both tabs because it makes two calls. The design
   always budgeted 2 per page; only my ad-hoc script defaulted to mobile.
   Everything now runs both by default.
4. **Not responsive.** The group rail collapses into a disclosure below `lg`,
   headers stack, gauges wrap, and tables scroll inside their own container.
5. **"Where is the data and how do I see history?"** Postgres, and every audit
   was already an immutable row -- what was missing was the UI. Added per-score
   history sparklines with the two PSI thresholds drawn in.
6. **No progress or ordering control.** Added live progress polled on every
   screen, linked to whatever it is auditing, plus a sweep-priority list.

### Estimates are measured, never invented

A `durationMs` column records the real PSI wall-clock of every call. Estimates
use this site's own rolling median -- currently **53 s**, against the 11-24 s
that light test pages suggested. A constant would have been wrong by ~3x.

Throughput models BOTH constraints, the rate limiter and concurrency/latency,
because ignoring the second is what made an earlier configuration silently
three times slower.

### Stage 3 -- scheduling and notifications
Cron in Postgres, ticked by the worker once a minute. Validation rejects
anything under an hour apart, since a sweep takes ~35 minutes and more frequent
schedules would mostly be skipped by the overlap guard. Email and Slack fire on
sweeps only and fail independently.

### Stage 4 -- regressions
Requires a 10+ point drop persisting across two audits, a 20+ single-run drop,
or a CWV band change that sticks. Twelve tests, most of which assert the rule
does NOT fire: simulated throttling makes single-run dips ordinary, and a flag
that cries wolf gets ignored.

### Stage 5 -- AI recommendations
On-demand and cached. Two providers; this machine has no API key but does have
Claude Code signed in, so the CLI adapter runs on the subscription. Verified
against the real homepage: 55 s, and it correctly named the blocking
stylesheets and identified Webflow's single-stylesheet model as the real
ceiling rather than listing micro-optimisations around it.

A self-inflicted bug worth remembering: the `createMany` + `skipDuplicates`
lock is a genuine atomic claim, but the caller that inserted the row was then
blocking on its own lock, so nothing ever generated. The insert count
distinguishes owning the claim from finding someone else's.

### Stage 6 -- MCP
Nine tools at `/api/mcp`, in-process. The v2 spec is stateless, so the
session-affinity reason for a separate service is gone. No `run_full_sweep`,
and `run_group_audit`'s description says so, because an agent will otherwise
loop over every group to imitate one. Verified: 401 without a token, nine tools
enumerate, real data returned.

### PSI parity
Screenshot restored (pruning was discarding the image PSI leads with, to save
5-33 KB while the real weight was the 259 KB filmstrip), passed and
not-applicable audit sections recovered from rawJson, CrUX distribution bars,
and a run-conditions panel -- a mobile score is a score under 4x CPU throttling,
and comparing it to desktop without that is meaningless.


## Rebuilt as a multi-tenant SaaS

The user asked for accounts, roles and multi-tenancy, then asked for a clean
database. Both were done: the schema was rebuilt from a single init migration
and the previous Zuddl data (747 pages, 153 results) was deliberately discarded.

### The security finding that mattered

The tenancy schema landed before the read paths were updated, which left a real
cross-tenant hole for a short window: every page resolved its site with
`findFirst()` and no organisation filter, so any signed-in user would have seen
whichever site was first in the table. Page, group and run ids appear in URLs
and were used unchecked.

Everything now resolves through `lib/services/tenant.service.ts`, which scopes
by the caller's organisation and reports "not found" rather than "forbidden" --
confirming an id exists is itself a disclosure. Actions are gated by
**capability**, not merely by being signed in: running audits spends the
organisation's Google quota, so a viewer cannot.

`npm run verify:tenants` proves this rather than asserting it -- two real
organisations, every cross-tenant access refused, the owner's still working,
and deleting one tenant leaving the other intact.

MCP's single `MCP_BEARER_TOKEN` was the same class of problem: whoever held it
reached whichever organisation a query resolved to. Tokens are now rows owned by
an organisation, stored hashed, individually revocable.

### Roles

viewer / editor / developer / admin, defined as named capabilities in
`lib/auth/roles.ts` rather than `role === 'admin'` scattered through the code.
A test asserts privilege only accumulates going up the order, so promoting
someone can never quietly remove a permission.

The session carries `userId` and `organizationId` but deliberately **not** the
role, which is re-read on every request -- otherwise removing or demoting
someone would not take effect until their 30-day token expired.

### Retention, as asked

`RAW_JSON_RETAIN_RUNS` and `ISSUE_RETAIN_RUNS` were configured and never
implemented -- dead settings. Now `RESULT_RETAIN_RUNS` keeps the last **10 runs
per page and strategy**, roughly two months of weekly checks, and a run's
results, markdown and AI recommendation are kept and removed **together**.
Hollowing out old rows was rejected: a report you can open whose evidence has
been deleted is worse than one that has plainly aged out.

### Design pass

The app's accent was `#dc2626` -- red -- sitting beside Lighthouse's red score
band, which is a genuine confusion rather than only an aesthetic one. The chrome
is now colourless and **score colour is the only saturated thing on screen**.

The signature element is a **spectrum strip**: every page sorted worst to best,
with bar height and colour both encoding score so it survives greyscale. It
shows what pagespeed.web.dev structurally cannot -- the shape of a whole site. A
long red shoulder means systemic; a thin red tail means a few bad pages.

### Onboarding

Derived from real data rather than a `hasOnboarded` flag, so it stays truthful:
clearing a key makes the checklist say so instead of insisting setup is done.
Only the next incomplete step gets a button, and a viewer is told who can do it
rather than handed a control that will reject them.

### Also closed

- Per-site PSI keys, verified against Google on save, never returned to the
  browser. Audits read the site's key, not the environment's.
- Teammates: invite, change role, remove, revoke. The last admin cannot be
  demoted or removed -- that locks everyone out of settings permanently.
- Password reset by email: hashed, single-use, 30-minute expiry, identical
  response for unknown addresses so the endpoint cannot enumerate accounts.
- Agent-targeted markdown export with real resource URLs and evidence tables,
  per page or per section, for handing to Cursor / Claude / Codex.
- Resend transport so notifications send as the app from a verified domain
  rather than from somebody's personal mailbox.

### Verified on a clean database

Sign up → add site → store key → read sitemap (747 pages, 68 sections) →
measure a section (8 audits, 0 failures) using the site's own key.

---

## 20 Aug 2026 — ordering, charts, run control, answer history

### Sections are one list you can reorder

The overview used to show a big grid of "primary" sections plus a collapsed
`<details>` of small ones. That split made the order you could see different
from the order the sweep actually ran in, which meant dragging a card would
have been meaningless. Both are now one `SectionGrid`, in sweep order, with the
position numbered on each card.

Order is stored in `Group.priority` and read back by
`listGroupsWithAggregates` (explicit priority first, then sitemap position).
`reorderGroupsAction` writes it inside a transaction, scoped to the caller's
organisation — an `updateMany` keyed on slug alone would have reordered another
tenant's sections, because slugs are only unique per site.

The same list is the sidebar, via `GroupRail`, so a drag in either place moves
both. Dragging is disabled while a search or a non-custom sort is active: saving
an order you cannot see would look like the change was thrown away on reload.
Every draggable row also has ↑/↓ buttons — this list decides what a 34-minute
job measures first, so it cannot be mouse-only.

The "Sections" label above the rail is gone; a search box and a sort selector
sit there instead. 68 sections is well past the point where scanning works.

### The overview chart is interactive and switchable

`OverviewCharts` replaces the static `ScoreSpectrum` with four views over the
same rows — every page, the ten-point spread, section averages, and load time
against score — plus a metric selector and a section filter. Hover for the page
and its number, click to open its report. The choice is remembered per browser.

Still hand-rolled SVG. A charting library is ~100 KB gzipped to draw bars, on
the page that reports page weight.

The payload is columnar (`[id, path, sectionIndex, …]` with section names
interned) because spelling `{ "performance": 84 }` out 1,500 times costs 40 KB
of the word "performance" in both the HTML and the RSC flight data. Overview
HTML went 682 KB → 556 KB on this site.

Preferences are read with `useSyncExternalStore`, not an effect: the server
snapshot is null, so the first client render matches the HTML and the saved
choice lands on the next one — no flash of the default chart, and no setState
inside an effect.

### A run can be held, continued or stopped

`controlRun()` plus `RunControls`, on the live progress bar and in the recent
checks list. Two things are stated in the UI rather than hidden:

- Pausing pauses the **queue**. Jobs already handed to a worker run to
  completion, so up to `WORKER_CONCURRENCY` more results land after the hold.
  Killing them would burn quota they had already spent and produce nothing.
- Stopping is `cancelled`, not `failed`, and keeps every result collected. A
  month later, "someone stopped this" and "this broke" must not look the same.

`finalizeRun` treats `cancelled` as terminal — otherwise the last in-flight job
would finalize the run back to `completed` and erase the stop. `findActiveRun`
counts `paused` as active, so a second sweep cannot start alongside a held one
and double the quota spend. Four tests pin the transition table.

### Recommendations keep their history

`Recommendation` was 1:1 with `AuditResult`, so regenerating overwrote the
previous answer. Someone regenerates precisely when they doubt what they got,
and the comparison is the point — so it now appends a `version`, keeps the last
ten per measurement, and the panel has an "Earlier answers" picker.

The atomic claim survived the change without an extra lock table: two tabs both
compute the same next version and race on the same `@@unique([auditResultId,
version])` insert, and `skipDuplicates` lets exactly one through. Trimming to
ten happens in the same transaction as the write, so a crash cannot skip it.

The prompt was rewritten for accuracy: audit ids, up to four evidence rows per
finding with their numbers (not just the first column), the previous
measurement's scores, and — on a regenerate — the answer being replaced, with
an instruction to go deeper rather than rephrase. The system prompt now leads
with the accuracy rules: use only the evidence given, never invent a filename
or number, never guess the stack, never present lab data as real-user data, and
say what to measure next when the data does not support a call.

### Markdown export asks which device

`Download .md` is a menu: this device, the other one, or both in one file.
Both-in-one is a single document rather than two downloads, because an agent
that can see mobile and desktop side by side can tell a device-specific problem
from a page-wide one. Strategies the page was never measured on are skipped
instead of emitted as empty sections.

---

## 20 Aug 2026 (later) — the interface rebuild

Triggered by "route transitions feel janky and the UI is average at best".
It was not a styling problem. Measurements before and after, warm, in dev:

| Route | Before | After | Payload |
|---|---|---|---|
| `/` | 530 ms | 611 ms | 714 → 712 KB |
| `/g/about` | 188 ms | 190 ms | 311 → 300 KB |
| `/g/blog` | 1,665 ms | **277 ms** | 4,358 → **691 KB** |
| `/g/platform` | 256 ms | 255 ms | 608 → 363 KB |
| `/settings/site` | 3,296 ms | **223 ms** | 340 → 344 KB |
| `/settings/automation` | 260 ms | 212 ms | 381 KB |

A client-side navigation to a 25-page section is now **293 ms**, and the rail
keeps its search text across the route change — it used to be wiped.

### What was actually wrong

- `AppShell` was called from every page instead of living in the layout, so the
  whole shell re-rendered and re-queried on every click. See DECISIONS 10.1.
- No `loading.tsx`, no `error.tsx`, no `not-found.tsx`, no `Suspense` anywhere.
- `/settings/site` summed `LENGTH("rawJson"::text)`, detoasting ~154 MB of
  stored PSI responses on every page load. `pg_column_size` reads the stored
  size instead: **6 ms**.
- `/g/blog` server-rendered all 324 rows as objects.
- The rail was a 2,213px scroll container competing with the page for the wheel.
- The report route turned every error into a bare framework 404.

### New

`components/ui/`: `Button`, `Panel`, `PageHeader`, `Skeleton`, `StrategyTabs` —
one definition each, replacing eleven hand-rolled button strings, three separate
`Panel` helpers and three copies of the strategy toggle.

`SpectrumRibbon` is the signature: the whole site's distribution, on the
overview as an interactive chart and on a section as a strip with the 90 line
drawn. `ScoreTiles` puts PSI's arc gauges on the overview, which showed four
naked numerals before.

Tokens gained an elevation scale, motion tokens (one curve, three durations),
`title-xl`/`title-sm`, and shimmer skeletons.

### Fixed while in there

- Report pages linked from our own table returned a bare 404 (DECISIONS 10.3).
- Top Issues bars were 100% on every row and meant nothing (10.6).
- The spectrum's median line looked like a rendering artefact; it is a labelled
  annotation now, over a drawn axis.
- Long paths were clipped with `direction: rtl`, which reorders the slashes.
- Chrome autofill repainted login fields pale blue (10.9).
- Grid children lacked `min-w-0`, so a long section name pushed the mobile
  layout 235px past the viewport.
- Gauges wrapped 3+1 on mobile; they are a 2×2 grid now.
- Copy says **Mobile**, never "Phone", everywhere.

### Failures are visible and retryable

The scheduled sweep finished 1,494/1,494 with 8 error rows, and there was no way
to see or re-run them. `failedResultsForRun` plus a `retry` scope pinned to that
run's failed pairs — so a retry cannot widen into a second full sweep — and a
`FailedPages` panel in Settings → Automation that names each page, explains the
Lighthouse code in words, and states the real attempt count from
`PSI_MAX_ATTEMPTS` (5, not 20).

### Verified

`npx tsc --noEmit` clean. `npm run lint` 0 errors. `npm test` 141/141.
21 route × breakpoint combinations (desktop 1440, tablet 834, mobile 390)
checked for horizontal overflow, runtime errors and missing headings: all clean.

## 20 Aug 2026 (later) — deployed to Vercel; BullMQ worker replaced with Vercel Workflow

Deployed the app: GitHub → Vercel, Neon (Postgres) + Upstash (Redis) via the
Marketplace, local dev data copied over with `pg_dump`/`psql`. Full reasoning
and what changed: `docs/DECISIONS.md` §11.

Short version: Vercel can't host `npm run worker` (a standalone process), and
Fly.io — the fallback plan for hosting it — turned out to need a credit card,
which the deploy was explicitly trying to avoid. Separately, `docs/DECISIONS.md`
§2.4 had already flagged Upstash as not reliably BullMQ-compatible. Both
problems go away by replacing `lib/queue/*` with Vercel Workflow
(`lib/workflows/*`) — one durable workflow run per `AuditRun`, dispatched from
Server Actions, the MCP server, and a new `CRON_SECRET`-authenticated
`/api/cron/schedule-tick` route instead of an in-process ticker.

What's unchanged: `audit.service.ts`, the DB-unique-constraint idempotency
guarantee, `PsiRateLimiter` (plain `INCR`/`PEXPIRE`, no blocking commands —
stays on Upstash fine), the concurrency/rate math, and `controlRun()`'s
pause/resume/stop state machine and its existing test (same function, new
backing implementation of the `queue` parameter).

What's new: retries loop inside one Workflow step instead of BullMQ
re-running the job; pause/stop are a Postgres status poll at each batch
boundary plus `sleep()` instead of a BullMQ queue primitive; worker liveness
became a scheduler heartbeat stamped by the cron route; scheduling moved to
Vercel Cron, constrained to once/day on this account's Hobby plan (a
sub-daily cron expression fails at deploy time) — a free external pinger
(GitHub Actions' schedule trigger) can hit the same route more often if
needed before upgrading to Pro.

Also fixed along the way: `npm run build` didn't run `prisma generate`, so a
fresh `npm install` (Vercel, CI) built with an untyped Prisma client and
failed `next build`'s type-check on code that passed locally, where the
client was already generated from an earlier `db:migrate`. Fixed by making
`prisma generate` part of the `build` script itself.

### Verified

`npx tsc --noEmit` clean. `npm run lint` 0 errors (2 new warnings from
generated `.well-known/workflow/*` files, gitignored). `npm test` 127/127
(14 fewer than before — `test/queue.test.ts` tested BullMQ job-id functions
that no longer exist, deleted). `npm run build` succeeds end-to-end
(`prisma generate && next build`), including Workflow's own compile step
("Compiled workflows... 1 workflow, 19 steps").

**Not fully verified:** local `next dev` testing of an actual audit run hit
an unresolved issue in Workflow's local execution transport — steps get
queued but the dev log repeats `TypeError: fetch failed` and nothing
progresses. The SDK's docs say it "currently work[s] best when deployed to
Vercel," so this was treated as a local-only wrinkle. **Before trusting any
change to `lib/workflows/*`, verify a real audit run completes against a
Vercel preview deployment** — this was not yet done as of this entry.
