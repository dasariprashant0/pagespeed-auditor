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
| M4 | Sitemap ingestion | **next** |
| M5 | Queue, idempotency, resumability | not started |
| M6 | Services for the dashboard | not started |
| M7 | Auth + routes | not started |
| M8 | Dashboard | not started |
| M9 | Real 50-page canary | not started |
| M10 | SITE.md | not started |

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
| No sitemap fixtures | **Expected** — M4. |
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
