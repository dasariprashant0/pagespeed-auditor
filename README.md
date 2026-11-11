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
| `docs/PRD.md` / `docs/TRD.md` / `docs/APP_FLOW.md` / `docs/UI_UX.md` / `docs/BACKEND_SCHEMA.md` / `docs/IMPLEMENTATION_PLAN.md` | Reference-format current-state doc suite — start with `IMPLEMENTATION_PLAN.md` for status by stage. |
| `docs/INTEGRATIONS.md` | Connecting an AI agent over MCP, the `.md`/CSV exports, and the HTTP routes. |
| `docs/PER_TENANT_ARCHITECTURE.md` | The central-DB / per-organisation-DB split. Read before touching auth or `lib/db/*`. |

Everything needed to continue this work is in the repo. If the plan and the code
disagree, the plan is probably right and the code is behind — check the Session
Log in `docs/BUILD_LOG.md` before assuming otherwise.

**All six stages are built**: ingestion, PSI integration, durable audit
execution (Vercel Workflow, not a queue worker), the dashboard, scheduling,
notifications, regression detection, on-demand AI recommendations, and a
9-tool MCP server. Each organisation keeps its audit data in its own
Neon + Cloudflare D1, connected from Settings → Database.

## Setup

Requires **OrbStack** (or any `docker compose` runtime) and Node 26+ for local
dev. Production runs on Vercel with Neon (a central identity database plus
one database per organisation) and Cloudflare D1 (raw JSON storage) — see
`docs/TRD.md` §1–2 and §7 for the full deployment topology. No
Redis: the rate limiter, scheduler heartbeat, and live run log all live in
Postgres — see `docs/DECISIONS.md` §16.

```bash
brew install orbstack        # then launch it once
npm install                  # see the install-scripts note below
cp .env.example .env         # then: npm run env -- PSI_API_KEY <your-key>
npm run db:up                # Postgres 17
npm run db:migrate
npm run dev                  # web app (Ship Studio may already be running this)
```

> **Before running `db:migrate` against an existing local database**, read
> `docs/PER_TENANT_ARCHITECTURE.md` — a central migration drops the old
> shared tables, and local dev may still hold historical data in them.

There is no separate worker process to start — audits run as a durable
Vercel Workflow, dispatched from Server Actions, the MCP server, and the
cron route. `npm run worker` doesn't exist.

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
| `npm run build` | `prisma generate && prisma migrate deploy && next build` — migrations apply as part of the build itself, see `docs/DECISIONS.md` §12 |
| `npm run db:up` / `db:down` | Postgres via Docker Compose |
| `npm run db:migrate` / `db:studio` | Prisma migrate (central schema) / data browser |
| `npm run db:migrate:tenant` | Create a tenant-schema migration and rebuild the bundled tenant migrations |
| `npm run db:generate` | Generate both Prisma clients (central and tenant) |
| `npm run verify:tenants` | Check one organisation can't read another's data |
| `npm test` | `node --test` with native TS stripping — no jest/vitest |
| `npm run lint` / `typecheck` | ESLint (incl. the architecture boundary) / tsc |
| `npm run throughput-dryrun` | Validates the ~0.75 req/s sweep assumption without spending quota |
| `npm run audit:queue -- <group>` | Runs a group through the real audit path sequentially, outside the dashboard |
| `npm run canary -- 50` | Bounded real slice before ever scheduling a full sweep |
| `npm run reset-password -- you@x.com '...'` | Reset a real user's password from the CLI (locked-out admin recovery) |
| `npm run env` | Show every setting, secrets masked |
| `npm run env -- KEY value` | Change one setting without opening the file |
| `npm run inspect-sitemap` | Crawl/normalize/group report, writes nothing |

## Two rules worth knowing before you edit

**1. `lib/services`, `lib/psi`, `lib/report`, `lib/sitemap` are a
framework-free zone.** No `next/*`, no `react`. This is what lets the MCP
server and `lib/workflows/*` both reuse them. ESLint enforces this; if you
change the rule, re-verify it still fails on a deliberate bad import.
`lib/queue` used to be in this list; it no longer exists — see
`docs/DECISIONS.md` §11.

**2. `AuditResult` contains error rows** (`status: 'error'`, null scores) so that
failed jobs still let a run finalize. Every average, trend, and aggregate query
must filter `status: 'ok'` or the numbers will be wrong.

## Architecture

```
Next.js app ──┐
              ├──> lib/services/* ──> Postgres (Prisma 7 + pg adapter)
MCP server ───┤         │              (also: rate limiter, live run log, heartbeat)
Vercel Cron ──┘         ├──> Cloudflare D1 (pruned Lighthouse JSON)
                        └──> Vercel Workflow (lib/workflows/auditRun.ts) ──> PSI API
```

No standalone worker process. Audits run as a durable Workflow, not a queue
a long-running Node process drains — see `docs/DECISIONS.md` §11 for why
(Vercel can't host one) and `docs/TRD.md` §2 for the full deployment
topology diagram.

A full sweep is 1,000–2,000 PSI calls at a sustainable ~0.75 req/s — 30
minutes to a few hours. It starts from the schedule or from the Overview's
"Measure whole site" button (`audits:run` only, refused while another run is
active). "Measure changed pages" re-audits only pages whose sitemap `lastmod`
moved. There is deliberately no `run_full_sweep` MCP tool.


## Agent access (MCP)

Nine read/write tools at `/api/mcp`. A developer or admin creates a token in
**Settings → Agent access**; it is shown once, with a ready command:

```bash
claude mcp add --transport http pagespeed http://localhost:3000/api/mcp \
  --header "Authorization: Bearer psa_..."
```

Tokens are per organisation, stored hashed, and revocable from the same
page. There is deliberately no `run_full_sweep` tool, and
`run_group_audit`'s description says so, because otherwise an agent will
loop over every group to imitate one. Full details: `docs/INTEGRATIONS.md`.


## Where the settings live

`.env` holds every secret. It is a **dotfile and gitignored on purpose**, so it
will not appear in Finder or in any git-backed file browser — that is what keeps
the API key out of the repository. You never need to find it:

```bash
npm run env                          # show everything, secrets masked
npm run env -- SMTP_PASS abcd1234    # change one value
open -e .env                         # or just open it directly
```

`.env.example` is the committed template documenting every variable.
