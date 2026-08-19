# Resume here

> Written 2026-08-19 because the session's usage was running out. This is the
> single page to read if you are picking this up cold — a different tool, a new
> session, or a different person.

## Read order

1. **This file** — current state and the exact next action
2. `docs/PLAN.md` — the approved plan (source of truth for design)
3. `docs/DECISIONS.md` — why things are this way; read before changing a design
4. `docs/BUILD_LOG.md` — full history of what was built and what was learned
5. `docs/SPEC.md` — the original brief

Nothing needed to continue lives outside this repo.

## State as of the last commit

**All stages complete, and rebuilt as a multi-tenant SaaS.** 137 unit tests
plus two integration checks (`npm run verify:tenants`, `npm run verify:ingest`).

Sign up at `/signup` — the first account becomes admin of a new organisation.
Everything is configured in the app; `.env` holds only infrastructure.

```
git log --oneline
```
should show 5 commits ending at "Shared service DTOs and the small-group
display decision".

| Thing | State |
|---|---|
| Postgres + Redis | Running via OrbStack. `npm run db:up` if not. |
| Database | Migrated, seeded. **747 real zuddl.com pages, 68 groups.** |
| PSI API key | Set in `.env` and verified working |
| Tests | 96 passing (`npm test`) |
| Typecheck / lint | Both clean |
| Throughput gate | **PASSED** — 0.695 req/s, ~33 min for a full 1,494-call sweep |

## Everything is built

Stages 1–6 plus the canary are done: ingestion, PSI, queue, dashboard,
scheduling, notifications, regressions, AI recommendations, and MCP. What
remains is operational — schedule the sweep, and decide whether the AI provider
should stay on the Claude Code CLI or move to an API key.

## Historical note: the multi-agent workflow (finished)

A background multi-agent workflow (`psa-stages-5-8`) building three lanes in
parallel, each adversarially verified, then integrated:

- **M5** — BullMQ queue, worker, processors, audit write path
  (`lib/queue/**`, `lib/services/audit.service.ts`, `run.service.ts`)
- **M6** — dashboard read services
  (`lib/services/{results,issues,site,report}.service.ts`)
- **M7** — auth, session, `proxy.ts`, login page
  (`lib/auth/**`, `lib/http/**`, `proxy.ts`, `app/(auth)/**`, `app/actions/auth.ts`)

**Check whether it landed:**

```bash
git status --short          # uncommitted agent output?
npx tsc --noEmit            # must be clean
npx eslint .                # must be clean
npm test                    # must pass
```

**If the working tree has uncommitted changes**, the workflow wrote code that
was never verified by a human. Run the three commands above before trusting it.
If it is broken and not worth salvaging:

```bash
git checkout -- . && git clean -fd    # discard, back to the last good commit
```

That is safe — the last commit is green.

## The next action

If the workflow output is green: commit it, then **M8 — the dashboard**
(see `docs/PLAN.md` → "Dashboard (stage 2)"). Build order within M8 is specified
there: tokens/shell/login first, then `ScoreGauge` + `Sparkline` against
fixtures, then `/g/[slug]` **before** `/`, then `/p/[pageId]`.

If it is not green: fix it or discard it and rebuild M5 alone, which is the
piece everything else needs.

## Things a fresh agent WILL get wrong unless told

These each cost real time to discover. They are all verified, not guessed.

1. **Next 16 uses `proxy.ts`, not `middleware.ts`.** `next lint` is also gone —
   use `npm run lint`.
2. **Prisma 7 removed `url` from the datasource block.** It lives in
   `prisma.config.ts`; the runtime client uses the `PrismaPg` driver adapter.
   Prisma reads `.env`, **not** `.env.local`.
3. **npm 12 blocks install scripts.** A fresh clone needs
   `npm install-scripts approve prisma @prisma/engines sharp unrs-resolver esbuild fsevents`
   or Prisma silently has no query engine.
4. **`lib/` must not use the `@/` alias.** Node's native TS stripping does not
   resolve it, so `node --test` and the bare worker both break. Use relative
   imports with explicit `.ts` extensions. ESLint enforces this.
5. **Lighthouse 13 has no `load-opportunities` group** — it is `insights` /
   `diagnostics` / `metrics` / `hidden`. `weight` is 0 everywhere, and
   `metricSavings` replaced `details.overallSavingsMs`.
6. **`AuditResult` holds error rows** (`status:'error'`, null scores) so failed
   jobs still let a run finalize. Every aggregate MUST filter `status:'ok'`.
7. **Never write TBT into `inp`.** INP is field-only. Field CLS percentile is
   CLS × 100 (raw `11` = `0.11`).
8. **Worker concurrency is 20, not 2–4.** Measured: at 4 the rate collapses to
   0.225 req/s and a sweep goes from 48 to 148 minutes, silently.
   `QUEUE_LOCK_DURATION_MS` must exceed `PSI_TIMEOUT_MS`; `lib/env.ts` refuses
   to boot otherwise.
9. **Ship Studio runs `next dev` on the host.** Do not containerize the web app
   locally — it breaks the live preview. `docker-compose.dev.yml` is DB + Redis
   only.
10. **tsx scripts need an async `main()`** — top-level await fails because the
    package is CJS.

## Outstanding, in priority order

| # | Item | Notes |
|---|---|---|
| 1 | Verify/commit the workflow output | See above |
| 2 | M8 dashboard | The last piece of stages 1–2 |
| 3 | `AUTH_PASSWORD_HASH` is empty | `npm run hash-password -- 'your-password'`, paste into `.env`. Login cannot work until then. |
| 4 | `SITE_NAME` is `"Company Site"` | Cosmetic; probably want `Zuddl` |
| 5 | Two PSI fixtures never captured | A page with NO CrUX data, and one with `origin_fallback: true`. Every URL sampled had page-level data. Grab from low-traffic deep pages during the M9 canary. |
| 6 | M9 canary before any full sweep | 50 pages first, watch the Google quota dashboard, spot-check 3 reports against pagespeed.web.dev |
| 7 | Stages 3–6 | Scheduling, notifications, trends/regressions, AI recommendations, MCP. All deferred by design. |

## Useful commands

```bash
npm run db:up              # Postgres + Redis
npm run db:migrate         # apply migrations
npm run db:studio          # browse the data
npm run ingest             # re-ingest the sitemap (idempotent)
npm run ingest -- --dry    # crawl and report, write nothing
npm run inspect-sitemap    # crawl/normalize/group report, no DB writes
npm run verify:ingest      # 15 DB invariant checks on a throwaway site
npm run throughput-dryrun  # re-prove the 0.75 req/s gate, zero quota cost
npm test                   # 96 tests, offline
npm run worker             # the long-running queue worker (once M5 lands)
```

## Decisions that are settled — do not re-litigate

Full reasoning in `docs/DECISIONS.md`. In brief: Postgres + Prisma + BullMQ (no
SQLite fallback); worker concurrency 20; full sweeps are schedule-only with no
manual button and no `run_full_sweep` MCP tool, ever; group aggregate is the
mean with the worst page shown beside it; the `AuditIssue` side table (never
aggregate over `rawJson`); `GroupAlias` so merged groups don't reappear; pages
are deactivated not deleted; Server Actions for all UI mutations with
`requireSession()` first in every one; no charting library; OrbStack as the
container runtime; and the 42 single-page groups are collapsed in the
dashboard rather than changed in the data model.
