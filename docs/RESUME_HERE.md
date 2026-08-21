# Resume here

> Rewritten 20 Aug 2026 — the previous version described a mid-flight state
> from 19 Aug 2026 (dashboard not yet built, a since-finished multi-agent
> workflow's verification checklist, `npm run worker` as a real command).
> Everything in that version is done now; this file describes what's
> actually true today, not a snapshot to reconcile against.

## Read order

1. **This file** — current state and what's actually open
2. `docs/IMPLEMENTATION_PLAN.md` — status by stage, open items, the
   verification bar for anything new
3. `docs/PLAN.md` / `docs/DECISIONS.md` — original architecture plan, and
   why things are the way they are (numbered, §1–§13)
4. `docs/BUILD_LOG.md` — full chronological history, most recent first
   read at the bottom
5. `docs/PRD.md`, `docs/TRD.md`, `docs/APP_FLOW.md`, `docs/UI_UX.md`,
   `docs/BACKEND_SCHEMA.md` — reference-format current-state doc suite
6. `docs/SPEC.md` — the original brief

Nothing needed to continue lives outside this repo.

## State as of the last commit

**Everything is built**: ingestion, PSI, durable audit execution (Vercel
Workflow, not a queue worker — see `docs/DECISIONS.md` §11), the
dashboard, scheduling, notifications, regressions, AI recommendations, a
9-tool MCP server, and a multi-tenant `Organization`/`Membership`/role
model throughout. Deployed to Vercel with Neon (Postgres) and Vercel
Blob (see `docs/TRD.md` §1–2). No Redis -- the rate limiter, scheduler
heartbeat, and live run log all live in Postgres (`docs/DECISIONS.md` §16).

Sign up at `/signup` — the first account becomes admin of a new
organisation. `.env` holds only infrastructure secrets; everything else
is configured in the app.

```bash
npx tsc --noEmit   # must be clean
npm run lint       # must be clean
npm test           # must pass — 138 tests as of this writing
```

## Two things that will cost you real time if you don't know them first

1. **Vercel Workflow's local `next dev` transport is flaky.** Steps get
   queued but sometimes never execute, no error, no log line. Confirmed
   again 20 Aug 2026. **Verify any change to `lib/workflows/*` against a
   real Vercel deployment, never trust local dev alone.**
2. **`DATABASE_URL` can't be pulled locally for this project's production
   environment** -- comes back empty from `vercel env pull`, with no local
   fallback. Migrations run inside the build itself now
   (`docs/DECISIONS.md` §12). The equivalent Blob-token problem this used
   to also name doesn't apply anymore: raw JSON storage moved off Vercel
   Blob to Cloudflare D1 (§18), which unlike Blob CAN be exercised fully
   from local dev.

## Things a fresh agent will get wrong unless told

Still-current gotchas, verified this session or earlier — see
`CLAUDE.md`'s own "Environment gotchas" section for the full list this
duplicates a few of intentionally, since this is the file someone reads
first:

1. **Next 16 uses `proxy.ts`, not `middleware.ts`.** `next lint` is gone —
   use `npm run lint`.
2. **Prisma 7 removed `url` from the datasource block.** It lives in
   `prisma.config.ts`. Prisma reads `.env`, **not** `.env.local`.
3. **npm 12 blocks install scripts** — see `CLAUDE.md` for the exact
   `install-scripts approve` command, which now also covers `@swc/core`
   and `cbor-extract` for the Workflow SDK.
4. **`lib/` must not use the `@/` alias** — `node --test`'s native TS
   stripping doesn't resolve it. Relative imports with explicit `.ts`
   extensions. ESLint enforces this.
5. **`AuditResult` holds error rows** (`status: 'error'`, null scores) —
   every aggregate query MUST filter `status: 'ok'`.
6. **Never write TBT into `inp`.** INP is field-only. Field CLS percentile
   is CLS × 100 (raw `11` = `0.11`).
7. **`WORKER_CONCURRENCY` must sit above what the rate limiter needs**, not
   below — see `docs/PLAN.md` §3 and `docs/TRD.md` §4 for the throughput
   math. There is no `QUEUE_LOCK_DURATION_MS` anymore; that was BullMQ-era
   and has been removed (retries live inside one Workflow step now).
8. **`tsx` scripts need an async `main()`** — top-level await fails
   because the package is CJS.

## Outstanding

See `docs/IMPLEMENTATION_PLAN.md` §4 for the current open-items table.
Nothing here is blocking; there is no unverified in-flight work the way
there was when this file was last written.

## Decisions that are settled — do not re-litigate

Full reasoning in `docs/DECISIONS.md` (§1–§18). In brief: Postgres +
Prisma + Vercel Workflow (BullMQ was replaced, not the original plan);
batch size sits above the rate limiter's throughput need, not below; full
sweeps are schedule-only with no manual button and no `run_full_sweep`
MCP tool, ever; group aggregate is the mean with the worst page shown
beside it; the `AuditIssue` side table (never aggregate over `rawJson`);
`GroupAlias` so merged groups don't reappear; pages are deactivated not
deleted; Server Actions for all UI mutations with `requireSession()`/
`requireCapability()` first in every one; no charting library; the pruned
Lighthouse JSON lives in Cloudflare D1 for new rows, not inline in
Postgres (moved there from Vercel Blob, §18, after Blob's free write-op
allowance turned out smaller than one full sweep).
