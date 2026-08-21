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

Reference-format companions to the above (current-state, not a second plan —
where they disagree with the files above, the files above win):

| File | What it is |
|---|---|
| `docs/PRD.md` | Product requirements: problem, roles, current feature set, success criteria. |
| `docs/TRD.md` | Technical requirements: stack, deployment topology, the two things that can't be pulled locally. |
| `docs/APP_FLOW.md` | Every navigable path through the app, with diagrams. |
| `docs/UI_UX.md` | Design system, theming, component inventory. |
| `docs/BACKEND_SCHEMA.md` | The Prisma schema, explained model by model. |
| `docs/IMPLEMENTATION_PLAN.md` | Status by stage, open items, the verification bar. |

Everything needed to continue lives in the repo. Nothing depends on a particular
tool's session.

## What this is

Audits every page of one website (~500–1,000 pages) via the Google PageSpeed
Insights API on mobile and desktop, keeps every run as history, and shows it in a
dashboard modelled on pagespeed.web.dev. An MCP server exposes the same service
layer to an AI agent.

**Everything is built: stages 1–6 plus MCP.** Ingestion, PSI, durable
execution (Vercel Workflow, not the original BullMQ queue), storage,
dashboard, scheduling, notifications, trends/regressions, AI
recommendations, and a 9-tool MCP server are all live — see
`docs/IMPLEMENTATION_PLAN.md` for the current status table and
`docs/PRD.md`/`docs/TRD.md`/`docs/APP_FLOW.md`/`docs/UI_UX.md`/
`docs/BACKEND_SCHEMA.md` for the rest of the reference doc suite. This
paragraph used to say "current scope: stages 1–2, MCP deliberately out of
scope" — that was stale by 20 Aug 2026 and is corrected here rather than
left for the next reader to discover the hard way. MCP is feature-complete
and, per direct instruction, not being extended further for now — that's a
pause, not a scope boundary to re-derive.

## Rules that will bite you

**1. Framework-free zone.** Nothing in `lib/services`, `lib/psi`, `lib/report`, or
`lib/sitemap` may import `next/*`, `react`, or `server-only`. ESLint enforces this.
If you change the rule, re-verify it still fails on a deliberate bad import — an
unenforced boundary is decorative. `lib/queue` used to be in this list; it no
longer exists (see below) — `lib/workflows/*` replaced it and is deliberately
NOT framework-free, since it needs the Next.js-integrated Workflow SDK.

**2. `AuditResult` contains error rows.** Failed jobs write `status: 'error'` with
null scores so a run can still finalize. **Every average, trend, and aggregate
query must filter `status: 'ok'`** or the numbers are silently wrong.

**3. Never write TBT into the `inp` column.** INP is field-only; Lighthouse lab
runs don't produce it (verified across all fixtures). `inp` is nullable and comes
only from CrUX. `tbt` has its own column as the lab proxy.

**4. Field CLS percentile is CLS × 100.** Raw `11` means CLS `0.11`. Divide.

**5. Audit batch size (`WORKER_CONCURRENCY`) is 48, not 2 and not 20.** The
limiter caps the rate; the batch must sit *above* what it needs (Little's Law:
in-flight = rate × latency). Measured against the real site, not a guess:
www.zuddl.com averages ~60s per PSI call, so 0.75 req/s × 60s ≈ 45 in flight,
and 48 gives headroom — see `.env.example`. (An earlier version of this rule
said 20, from a rougher ~25s latency assumption before the real site was
measured; that number is stale, not a floor to preserve.) Lowering it below
what the measured latency needs turns a sub-hour sweep into many hours with no
error. This used to also gate BullMQ's `lockDuration`; there's no queue lock
anymore (see `docs/DECISIONS.md` §11) — retries now live inside one Workflow
step.

**6. Full sweeps are schedule-only.** No "audit everything now" button, ever, and
no `run_full_sweep` MCP tool. See `docs/DECISIONS.md` §2.2.

**7. There is no standalone worker process anymore.** `npm run worker` doesn't
exist. Audit dispatch is `lib/workflows/auditRun.ts` (Vercel Workflow), triggered
from Server Actions, the MCP server, and `/api/cron/schedule-tick`. See
`docs/DECISIONS.md` §11 for why and what changed.

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
  locally; it breaks the preview. `docker-compose.dev.yml` is Postgres only —
  there is no Redis anywhere in this app; see `docs/DECISIONS.md` §16.
- **Lighthouse 13 dropped the `load-opportunities` group** — it's now `insights` /
  `diagnostics` / `metrics` / `hidden`, `weight` is 0 everywhere, and
  `metricSavings` replaced `details.overallSavingsMs`. See `docs/PLAN.md`.
- **`npm run build` must run `prisma generate` first.** A fresh `npm install`
  (Vercel, CI) never generates the Prisma client on its own — there's no
  `postinstall` hook for it — so `next build`'s own type-check sees an
  untyped client and fails on code that's fine locally, where the client was
  already generated by an earlier `db:migrate`/`db:generate`.
  `"build": "prisma generate && prisma migrate deploy && next build"` in
  `package.json` is load-bearing — see `docs/DECISIONS.md` §12 for why
  `migrate deploy` is in there too, not just `generate`.
- **`vercel env pull` cannot get a working production `DATABASE_URL` for
  this project.** It comes back as a genuinely empty string
  (`vercel env ls production` shows it as a normal Encrypted variable, not a
  special one) even though the deployed app plainly has a working
  connection. This means a schema change **cannot** be applied to production
  by pulling env and running `prisma migrate deploy` locally, from any
  machine — the migration has to run inside Vercel's own build (see the
  `package.json` line above), which is the one place that demonstrably has
  the real value.
- **`AuditResult.rawJson` lives in Cloudflare D1 now** (`lib/blob.ts`,
  `docs/DECISIONS.md` §18) — it was on Vercel Blob for one day first
  (§13), moved off after Blob's free write-operation allowance turned out
  smaller than one full sweep of this site. Needs `CLOUDFLARE_ACCOUNT_ID`
  / `CLOUDFLARE_D1_DATABASE_ID` / `CLOUDFLARE_API_TOKEN`. Unlike the Blob
  token this replaced, these work identically from local dev, CI, or
  Vercel — D1's query API is a plain authenticated `fetch()`, not
  something only Vercel's runtime can reach.
- **Deploying pulls in more blocked install scripts.** `workflow`/
  `@workflow/core` need `@swc/core` and `cbor-extract`'s native builds — add
  them to `package.json`'s `allowScripts` (`npm install-scripts approve
  "@swc/core@<version>" "cbor-extract@<version>"`) the same way the original
  gotcha below describes, or the Workflow SDK silently misbehaves.
- **Vercel Cron on the Hobby plan runs at most once per day** (±59 min
  precision) — a sub-daily cron expression fails at deploy time outright.
  `vercel.json` schedules `/api/cron/schedule-tick` once daily; a free
  external pinger (GitHub Actions' own schedule trigger, cron-job.org) can
  hit the same `CRON_SECRET`-authenticated route more often if finer
  scheduling is needed before upgrading to Pro.
- **Vercel Workflow's local dev transport is flaky.** Steps can get queued
  but never execute, with a repeating `TypeError: fetch failed` in the `next
  dev` log. Not resolved as of the BullMQ→Workflow migration — verify audit
  runs against a Vercel **preview** deployment, not just `next dev`, before
  trusting a change to `lib/workflows/*`.

## Working style

- Tailwind v4, CSS-first. There is no `tailwind.config.js` and there should not
  be one — tokens go in the `@theme inline` block in `app/globals.css`.
- Tests are `node --test --experimental-strip-types`. No jest, no vitest.
- Verify before claiming. Run `npm run typecheck && npm run lint && npm test`, and
  quote real output rather than asserting success.
- Append to the Session Log in `docs/BUILD_LOG.md` after meaningful changes. If you
  change a decision, change it in `docs/PLAN.md` and note why — don't let them drift.
