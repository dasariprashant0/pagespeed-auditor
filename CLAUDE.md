# Internal PageSpeed Auditor

> This file replaced the Ship Studio marketing-site template, which told agents to
> run `/onboarding` and build a landing page. This is an internal data tool for
> engineers — that guidance was actively misleading. The original is kept at
> `docs/CLAUDE.shipstudio-original.md` for reference.

## Read these before doing anything

| File | What it is |
|---|---|
| **`docs/RESUME_HERE.md`** | **Read first.** Current state, next action, and the traps that cost time. |
| `docs/PLAN.md` | The approved build plan. **Source of truth** for architecture, schema, and verification. |
| `docs/BUILD_LOG.md` | Current state: what's built, what's next, what's blocked. Update it as you work. |
| `docs/DECISIONS.md` | Why things are the way they are, and what was rejected. Read before changing a design. |
| `docs/SPEC.md` | The original brief. |

Everything needed to continue lives in the repo. Nothing depends on a particular
tool's session.

## What this is

Audits every page of one website (~500–1,000 pages) via the Google PageSpeed
Insights API on mobile and desktop, keeps every run as history, and shows it in a
dashboard modelled on pagespeed.web.dev. A later stage adds an MCP server over the
same service layer.

**Current scope: stages 1–2** — ingestion, PSI, queue, storage, dashboard.
Scheduling, notifications, trends, AI recommendations, and MCP are deliberately
out of scope until this pass is reviewed. Don't build ahead.

## Rules that will bite you

**1. Framework-free zone.** Nothing in `lib/services`, `lib/psi`, `lib/queue`,
`lib/report`, or `lib/sitemap` may import `next/*`, `react`, or `server-only`. The
worker is a bare Node process that imports these directly; one stray import breaks
it at load time. ESLint enforces this. If you change the rule, re-verify it still
fails on a deliberate bad import — an unenforced boundary is decorative.

**2. `AuditResult` contains error rows.** Failed jobs write `status: 'error'` with
null scores so a run can still finalize. **Every average, trend, and aggregate
query must filter `status: 'ok'`** or the numbers are silently wrong.

**3. Never write TBT into the `inp` column.** INP is field-only; Lighthouse lab
runs don't produce it (verified across all fixtures). `inp` is nullable and comes
only from CrUX. `tbt` has its own column as the lab proxy.

**4. Field CLS percentile is CLS × 100.** Raw `11` means CLS `0.11`. Divide.

**5. Worker concurrency is 20, not 2.** The limiter caps the rate; concurrency must
sit *above* what it needs (Little's Law: 0.75 req/s × ~25 s latency ≈ 19). Lowering
it turns a 44-minute sweep into seven hours with no error. Likewise
`QUEUE_LOCK_DURATION_MS` must exceed `PSI_TIMEOUT_MS` — `lib/env.ts` hard-fails at
boot if it doesn't.

**6. Full sweeps are schedule-only.** No "audit everything now" button, ever, and
no `run_full_sweep` MCP tool. See `docs/DECISIONS.md` §2.2.

## Environment gotchas (all verified, all cost time to find)

- **Next 16 uses `proxy.ts`, not `middleware.ts`.** `next lint` was also removed —
  use `npm run lint`.
- **Prisma 7 removed `url` from the datasource block.** It lives in
  `prisma.config.ts`; the runtime client uses the `PrismaPg` driver adapter.
  Prisma reads `.env`, **not** `.env.local`.
- **npm 12 blocks install scripts.** A fresh clone needs
  `npm install-scripts approve prisma @prisma/engines sharp unrs-resolver esbuild fsevents`
  or Prisma silently has no query engine.
- **A PSI API key is mandatory** — the keyless endpoint's shared quota is
  exhausted and returns 429.
- **Ship Studio runs `next dev` on the host.** Don't containerize the web app
  locally; it breaks the preview. `docker-compose.dev.yml` is Postgres + Redis only.
- **Lighthouse 13 dropped the `load-opportunities` group** — it's now `insights` /
  `diagnostics` / `metrics` / `hidden`, `weight` is 0 everywhere, and
  `metricSavings` replaced `details.overallSavingsMs`. See `docs/PLAN.md`.

## Working style

- Tailwind v4, CSS-first. There is no `tailwind.config.js` and there should not
  be one — tokens go in the `@theme inline` block in `app/globals.css`.
- Tests are `node --test --experimental-strip-types`. No jest, no vitest.
- Verify before claiming. Run `npm run typecheck && npm run lint && npm test`, and
  quote real output rather than asserting success.
- Append to the Session Log in `docs/BUILD_LOG.md` after meaningful changes. If you
  change a decision, change it in `docs/PLAN.md` and note why — don't let them drift.
