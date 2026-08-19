# Internal PageSpeed Auditor

Audits every page of one website through the Google PageSpeed Insights API on
mobile and desktop, keeps every run as history, and surfaces it in a dashboard
modelled on pagespeed.web.dev.

## Start here

| Doc | What it is |
|---|---|
| **`docs/RESUME_HERE.md`** | **Picking this up cold? Start here.** Current state, the next action, and the gotchas that cost time. |
| **`docs/PLAN.md`** | The approved build plan. Architecture, schema reasoning, verification steps. **Read this first.** |
| **`docs/BUILD_LOG.md`** | What's built, what's next, what's blocking. Updated as work lands. |
| `docs/DECISIONS.md` | Why it's built this way, and what was rejected. Read before changing a design. |
| `docs/SPEC.md` | The original brief the plan was derived from. |

Everything needed to continue this work is in the repo. If the plan and the code
disagree, the plan is probably right and the code is behind — check the Session
Log in `docs/BUILD_LOG.md` before assuming otherwise.

**All six stages are built**: ingestion, PSI integration, the rate-limited
queue, the dashboard, scheduling, notifications, regression detection, on-demand
AI recommendations, and the MCP server.

## Setup

Requires **OrbStack** (or any `docker compose` runtime) and Node 26+.

```bash
brew install orbstack        # then launch it once
npm install                  # see the install-scripts note below
cp .env.example .env         # fill in PSI_API_KEY and SITE_SITEMAP_URL
npm run db:up                # Postgres 17 + Redis 7
npm run db:migrate
npm run dev                  # web app (Ship Studio may already be running this)
npm run worker               # queue worker, separate terminal
```

A **PSI API key is mandatory** — the keyless endpoint's shared quota is
permanently exhausted and returns `429`. Get one from
[Google's PSI docs](https://developers.google.com/speed/docs/insights/v5/get-started).

### npm 12 blocks install scripts

Prisma downloads its query engine in a postinstall script, so a fresh clone needs:

```bash
npm install-scripts approve prisma @prisma/engines sharp unrs-resolver esbuild fsevents
npm install
```

Without this Prisma silently has no engine and fails at first use.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run worker` | Long-running PSI queue worker (cannot be serverless) |
| `npm run db:up` / `db:down` | Postgres + Redis via Docker Compose |
| `npm run db:migrate` / `db:studio` | Prisma migrate / data browser |
| `npm test` | `node --test` with native TS stripping — no jest/vitest |
| `npm run lint` / `typecheck` | ESLint (incl. the architecture boundary) / tsc |
| `npm run throughput-dryrun` | Validates the ~0.75 req/s sweep assumption without spending quota |
| `npm run audit:queue -- <group>` | Queue a group through the worker |
| `npm run canary -- 50` | Bounded real slice before ever scheduling a full sweep |
| `npm run set-password -- '...'` | Set the login password (writes to .env) |
| `npm run inspect-sitemap` | Crawl/normalize/group report, writes nothing |

## Two rules worth knowing before you edit

**1. `lib/services`, `lib/psi`, `lib/queue`, `lib/report`, `lib/sitemap` are a
framework-free zone.** No `next/*`, no `react`. The worker imports them as plain
Node, and the same boundary lets the MCP server reuse them later. ESLint enforces
this; if you change the rule, re-verify it still fails on a deliberate bad import.

**2. `AuditResult` contains error rows** (`status: 'error'`, null scores) so that
failed jobs still let a run finalize. Every average, trend, and aggregate query
must filter `status: 'ok'` or the numbers will be wrong.

## Architecture

```
Next.js app ──┐
              ├──> lib/services/* ──> Postgres (Prisma 7 + pg adapter)
MCP server ───┘         │
                        └──────────> BullMQ + Redis ──> PSI API
                                          ▲
                              worker process (long-running)
```

Full sweeps are **schedule-only** by design — 1,000–2,000 PSI calls at a
sustainable ~0.75 req/s takes 30 minutes to a few hours. There is no "audit
everything now" button and no `run_full_sweep` MCP tool.


## Agent access (MCP)

Nine read/write tools at `/api/mcp`, authenticated by `MCP_BEARER_TOKEN` from
`.env`. Point a Claude client at it:

```json
{
  "pagespeed-auditor": {
    "url": "http://localhost:3000/api/mcp",
    "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
  }
}
```

There is deliberately no `run_full_sweep` tool — sweeps are schedule-only, and
`run_group_audit`'s description says so, because an agent will otherwise loop
over every group to imitate one.
