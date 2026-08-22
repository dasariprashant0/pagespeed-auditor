# Technical Requirements Document — Internal PageSpeed Auditor

> Companion to `docs/PLAN.md` (the original architecture plan) and
> `docs/DECISIONS.md` (why each piece is the way it is, numbered). This
> document is the current-state technical reference; it does not re-litigate
> anything already decided there. Written 20 Aug 2026.

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | `proxy.ts`, not `middleware.ts` — Next 16 renamed it |
| Language | TypeScript, React 19 | `useOptimistic`, `useSyncExternalStore` used deliberately, not `useEffect` + `setState` |
| Database | Postgres via Neon (Vercel Marketplace) | Prisma 7, `PrismaPg` driver adapter — no `url` in the datasource block, see `prisma.config.ts` |
| Rate limiter / ops state | Postgres (`lib/opsState.ts`) | Token bucket for PSI pacing, live run-log events, scheduler heartbeat. Was Redis via Upstash until 21 Aug 2026 — removed after a real incident, see `docs/DECISIONS.md` §16 |
| Raw JSON storage | Cloudflare D1 (`lib/blob.ts`, over its HTTP query API) | Pruned Lighthouse JSON (`AuditResult.rawJson` replacement). Was Vercel Blob until 21 Aug 2026 — moved after its free write-op allowance turned out smaller than one full sweep, and Cloudflare R2 (the obvious replacement) requires a card to enable even for free-tier use. See `docs/DECISIONS.md` §13 and §18 |
| Durable execution | Vercel Workflow DevKit (`workflow`, `@workflow/core`) | Replaced BullMQ, 20 Aug 2026 — see `docs/DECISIONS.md` §11 |
| Auth | Session cookie (JWT via `jose`), bcrypt password hashes | `proxy.ts` is a UX layer only; `requireSession()`/`requireCapability()` in every Server Action is the real boundary |
| Styling | Tailwind v4, CSS-first (`@theme inline` in `globals.css`) | No `tailwind.config.js` |
| AI | `@anthropic-ai/sdk` | Recommendations generation, versioned per audit result |
| Testing | `node --test --experimental-strip-types` | No jest, no vitest |

## 2. Deployment topology

```mermaid
flowchart LR
  subgraph Vercel
    web[Next.js app<br/>Server Components + Actions]
    wf[Vercel Workflow<br/>auditRunWorkflow]
    cron[Vercel Cron<br/>/api/cron/schedule-tick]
    mcp[/api/mcp]
  end
  neon[(Neon Postgres)]
  d1[(Cloudflare D1<br/>raw JSON, via HTTP query API)]
  psi[Google PageSpeed<br/>Insights API]

  web --> neon
  web --> d1
  wf --> neon
  wf --> d1
  wf --> psi
  cron --> web
  mcp --> web
```

No Redis: removed entirely 21 Aug 2026 (`docs/DECISIONS.md` §16). The rate
limiter, scheduler heartbeat, and live run log all live in Neon Postgres
now, alongside everything else.

Cloudflare D1 is the one piece of infrastructure that lives outside
Vercel/Neon entirely -- a separate Cloudflare account, reached over plain
HTTPS (D1's REST query API), not through the Workers runtime. See
`docs/DECISIONS.md` §18 for why (Vercel Blob's free tier, R2's mandatory
card).

There is **no standalone worker process**. `npm run worker` does not exist.
Audit dispatch is `lib/workflows/auditRun.ts`, triggered from Server Actions,
the MCP server, and the cron route — never a long-running Node process, which
is why the migration off BullMQ happened (Vercel can't host one; see
`docs/DECISIONS.md` §11).

## 3. The framework-free boundary

`lib/services`, `lib/psi`, `lib/report`, and `lib/sitemap` may not import
`next/*`, `react`, or `server-only`. Enforced by ESLint — verify the rule
still fails on a deliberate bad import before trusting it; an unenforced
boundary is decorative. `lib/workflows/*` is deliberately **outside** this
boundary (it needs the Next-integrated Workflow SDK). `lib/opsState.ts` and
`lib/blob.ts` are also outside it structurally, but neither actually imports
anything framework-specific — both just use Prisma and plain-Node SDKs.

## 4. The one constraint that shapes the audit path

Google's PSI API sustains roughly **0.75 requests/second** before returning
429s (measured, not documented by Google — see `docs/PLAN.md` §3). Every
throughput decision traces back to this:

- `PSI_RATE_MAX` / `PSI_RATE_WINDOW_MS` (default 3 per 4s) — the actual
  token-bucket pace, enforced in Postgres (`PsiRateLimiter`, an atomic
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, the same
  check-and-increment guarantee a Redis Lua script gave until 21 Aug 2026 —
  see `docs/DECISIONS.md` §16 for why it moved).
- `WORKER_CONCURRENCY` (48 in production, tunable) — the *batch* size
  `auditRunWorkflow` dispatches at once. Must sit **above** what the rate
  limiter needs (Little's Law), or a sweep that should take 34 minutes
  silently takes hours. Verified regression: dropping to 2–4 collapsed
  throughput to 0.225 req/s.
- A **retry loop inside one Workflow step** (`auditOnePageStep`), not
  Workflow's own step retry and not BullMQ's job re-run — see §11.

## 5. Durable execution — Vercel Workflow

`lib/workflows/auditRun.ts`:

- `auditRunWorkflow` (`'use workflow'`) — orchestrates in batches, checks
  `AuditRun.status` between batches for pause/stop, runs in a sandboxed VM
  with no Node built-ins. All real work happens in `'use step'` functions.
- `auditOnePageStep` (`'use step'`) — one (page, strategy) measurement, its
  own retry loop up to `PSI_MAX_ATTEMPTS`, records an error row (not a bare
  throw) on the last attempt **regardless of exception type** — a real bug
  fixed 20 Aug 2026 (see `docs/archive/BUILD_LOG-2026-08-19-20.md`, same
  date): a generic
  exception used to vanish silently via `Promise.allSettled` instead of
  showing up as a tracked failure.
- Every step's start/ok/retry/error also writes a `RunLogEvent` row
  (`lib/opsState.ts`'s `pushRunLogEvent`) for the live terminal view —
  **awaited**, not fire-and-forget, because a serverless container frozen
  right after a step returns can silently drop an un-awaited call.

**Known unresolved limitation:** Vercel Workflow's local `next dev`
transport is flaky — steps get queued but sometimes never execute, with no
error and no log line. Confirmed again in this session (20 Aug 2026): a
locally-triggered audit produced zero PSI/job-logger activity. **Any change
to `lib/workflows/*` must be verified against a real Vercel deployment**,
never trusted from local dev alone.

## 6. One thing that can't be pulled locally

Discovered 20 Aug 2026, load-bearing for anyone touching this project:

- **`DATABASE_URL`** — `vercel env pull --environment=production` returns
  an empty string for this project specifically (confirmed with
  `vercel env ls production`: a normal Encrypted variable, not a special
  one — just empty). No local machine can run `prisma migrate deploy`
  against production. Fixed structurally: `"build": "prisma generate &&
  prisma migrate deploy && next build"` — migrations now apply inside
  Vercel's own build, the one place that demonstrably has a working value.

This used to be two things — `BLOB_READ_WRITE_TOKEN` had the identical
problem when raw JSON storage was on Vercel Blob. It no longer applies:
Cloudflare D1 (`docs/DECISIONS.md` §18) is reached over a plain
authenticated HTTP API, so its credentials work identically from local
dev, CI, or production — there's nothing Vercel-specific to fail to pull.

## 7. Multi-tenancy

`Organization` → `Membership` (role) → `Site` → `Group`/`Page` →
`AuditRun`/`AuditResult`. Every service function that reads or writes
tenant data takes an `organizationId`/`siteId` and every Server Action calls
`requireSiteAccess`/`requireRunAccess` before touching a caller-supplied id —
a Server Action is a public endpoint reachable by a crafted POST no matter
what `proxy.ts`'s matcher says. Per-site PSI API key (not one shared key),
so tenants don't share or starve each other's Google quota.

## 8. Non-functional requirements

- **Cost**: Postgres storage must not scale linearly with sweep count.
  Two independent controls: the 10-per-page retention window
  (`retention.service.ts`), and Blob-backed raw JSON storage (~15× cheaper
  per GB than Neon for the same bytes — `docs/DECISIONS.md` §13).
- **Idempotency**: `@@unique([auditRunId, pageId, strategy])` on
  `AuditResult` is the durable dedupe guarantee — it survives Redis
  eviction, which a BullMQ jobId dedupe could not.
- **Accessibility**: the tool reports accessibility scores; it has to pass
  its own audit. One focus ring, everywhere, including inside SVG.
- **Theming**: explicit System/Light/Dark, not just OS-following — added
  20 Aug 2026 after "the whole app followed the OS setting with no
  override" was raised directly.

## Related documents

`docs/PRD.md`, `docs/BACKEND_SCHEMA.md`, `docs/APP_FLOW.md`, `docs/UI_UX.md`,
`docs/IMPLEMENTATION_PLAN.md`, and the numbered decisions in
`docs/DECISIONS.md` (§1–§13) for the reasoning behind every choice above.
