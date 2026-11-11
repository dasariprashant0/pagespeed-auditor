# Integrations — MCP, exports and HTTP endpoints

> How things outside the dashboard get data in and out: AI agents over MCP,
> the `.md` and CSV exports, and the internal HTTP routes. Written 11 Nov 2026.
> The code is the source of truth: `lib/mcp/server.ts`, `app/api/**`.

## 1. Connecting an AI agent (MCP)

The MCP server runs in-process at **`<APP_URL>/api/mcp`** (Streamable HTTP,
stateless). It authenticates by bearer token, not the session cookie, so
`proxy.ts` deliberately excludes it.

1. A **developer or admin** opens **Settings → Agent access**
   (`/settings/agents`) and creates a token with a label.
2. The token (`psa_…`) is shown **once** — only its SHA-256 hash is stored.
   The page also prints a ready command for Claude Code:

   ```sh
   claude mcp add --transport http pagespeed <APP_URL>/api/mcp \
     --header "Authorization: Bearer psa_…"
   ```

   Any MCP client works the same way: send `Authorization: Bearer <token>`.
3. Revoke from the same page. Revocation is immediate; `lastUsedAt` shows
   whether a token is still in use.

A token is scoped to **one organisation** and grants `audit:read` and
`audit:write`: read everything, queue page/group audits. It cannot change
settings or people, and it **cannot start a full sweep** — there is no
`run_full_sweep` tool, by design (`docs/DECISIONS.md` §2.2).

### Tools (9)

| Tool | Inputs | Returns |
|---|---|---|
| `list_groups` | `strategy` | Every group with average scores, worst page, coverage |
| `list_pages` | `group?`, `strategy`, `limit` (1–200, default 50) | Pages with latest scores |
| `get_report` | `url`, `strategy` | The stored markdown report for the page's latest result |
| `get_trend` | `url` or `group`, `strategy`, `limit` (2–90, default 20) | Score history |
| `top_issues` | `strategy`, `limit` (1–40, default 15) | Issues affecting the most pages in the latest complete run |
| `get_recommendation` | `url`, `strategy`, `refresh` | AI recommendations; generated on first request |
| `run_page_audit` | `url`, `strategy` (`mobile`/`desktop`/`both`) | A run id to poll |
| `run_group_audit` | `group`, `strategy` | A run id to poll |
| `get_run_status` | `runId` | Progress, including `paused` and `cancelled` |

`get_report` returns the markdown stored at audit time
(`lib/report/markdown.ts`). Rows written before 11 Nov 2026 still carry
the old "Overall" line from PSI's `overall_category`; newer rows state the
Core Web Vitals assessment on LCP, INP and CLS only.

## 2. Exports

All exports need a signed-in session (any role — `reports:read`).

| What | Where in the UI | Route |
|---|---|---|
| Agent fix report, one page | Page report → "Download .md" | `GET /api/reports/<pageId>?strategy=mobile\|desktop\|both` — add `&passed=0` to drop the passed / not-applicable lists |
| Agent fix report, a group | Group page → "Download .md" | `GET /api/reports/bulk?group=<slug>&strategy=…&limit=25` (max 50 pages) |
| Scores spreadsheet | Overview or group page → "Download CSV" | `GET /api/reports/csv` or `?group=<slug>` |

**The `.md` report** (`lib/report/agentMarkdown.ts`) is written for a coding
agent: run conditions and warnings, the CWV verdict, lab and field metrics
with good/needs-improvement/poor visit shares, the origin comparison, then
every failing audit with its measured cost, affected metrics, audit id,
stack-specific tips and evidence tables, then manual checks, passed and
not-applicable audits.

**The CSV** (`app/api/reports/csv/route.ts`) has one row per page per
strategy, from each page's latest result:

`url, path, group, strategy, status, runtime_error, measured_at,
performance, accessibility, best_practices, seo, lab_lcp_ms, lab_cls,
lab_fcp_ms, lab_ttfb_ms, lab_tbt_ms, lab_speed_index_ms, field_source,
cwv_assessment, field_lcp_ms, field_inp_ms, field_cls, field_fcp_ms,
field_ttfb_ms`

`cwv_assessment` is `passed`/`failed`/empty, recomputed from LCP/INP/CLS
so old rows are correct too. Cells that start with `= + - @` get a `'`
prefix so a spreadsheet won't run them as formulas.

## 3. Other HTTP routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/runs/active` | session | Up to 3 queued/running/paused runs — polled every 3 s by the active-run bar |
| `GET /api/runs/<runId>/progress` | session | One run's progress |
| `GET /api/runs/<runId>/log` | session | Live per-page log lines for the run terminal |
| `GET /api/cron/schedule-tick` | `CRON_SECRET` | Starts due scheduled sweeps; Vercel Cron (daily on Hobby) or an external pinger |
| `/api/auth/google/*` | — | Google sign-in |
| `/.well-known/workflow/*` | — | Vercel Workflow's own internal routes |

API routes answer an unauthenticated request with a 401 JSON body, never a
redirect to `/login`. Non-GET API requests from another origin get a 403.

## Related documents

`docs/APP_FLOW.md` (where these live in the UI), `docs/TRD.md`
(architecture), `docs/PRD.md` (roles), `docs/DECISIONS.md` §2.2 (why no
full sweep over MCP).
