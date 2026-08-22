# Product Requirements Document — Internal PageSpeed Auditor

> This is a reference-format companion to `docs/SPEC.md` (the original brief) and
> `docs/DECISIONS.md` (why things are the way they are). Where they disagree with
> this document, **they win** — this file describes the product in PRD shape for
> onboarding and planning, not a new source of truth. Written 20 Aug 2026,
> reflecting the app as it actually runs today, not the original stage plan.

## 1. Problem

Zuddl's marketing site (zuddl.com, ~750 pages) has no way to see performance
across the whole site at once. Google's own PageSpeed Insights measures one URL
at a time, with no history, no way to compare pages, and no record of what
changed after a fix shipped. Nobody knew whether performance was improving or
regressing site-wide, only anecdotally page-by-page.

## 2. Who this is for

Built for one internal team (Zuddl marketing/eng), multi-tenant in
implementation (`Organization` → `Site` → `Page`) but single-tenant in
practice today. Four roles, least to most privileged — see
`lib/auth/roles.ts`:

| Role | Can do |
|---|---|
| **Viewer** | Read every report, section, and page. Download the `.md` report. |
| **Editor** | Everything a Viewer can, plus run audits on demand and reorganise sections. |
| **Developer** | Everything an Editor can, plus the MCP token and the raw PSI JSON behind a report. |
| **Admin** | Everything a Developer can, plus teammates, the PSI API key, site config, and the schedule. |

A person's role is per-organisation (`Membership`), not global — the same
person could be a Viewer in one org and an Admin in another, though today
there is one real org.

## 3. What it does (current state, not aspirational)

1. **Ingests** a sitemap into `Page` rows, grouped into `Group`s by URL
   structure (first path segment), with manual rename/merge/reorder.
2. **Audits** every (page, strategy) pair through the real Google PageSpeed
   Insights API — lab metrics (Lighthouse) and field metrics (CrUX), never
   estimated or synthesized.
3. **Keeps history** — the last 10 audits per (page, strategy), old ones
   pruned automatically (`retention.service.ts`), not an unbounded log.
4. **Shows a dashboard**: sitewide overview, per-section drill-down,
   per-page report (scores, Core Web Vitals pass/fail, opportunities,
   diagnostics, passed/not-applicable audits, score history).
5. **Schedules** a whole-site sweep (weekly by default), with email/Slack
   notification on completion or failure.
6. **Generates AI recommendations** — a prioritised fix list per report,
   versioned (never overwritten, so a regeneration can be compared against
   the last one).
7. **Shows live activity** while a sweep runs — which page is being
   measured right now, not just a percentage bar (`RunTerminal`, added
   20 Aug 2026).
8. **Exposes an MCP server** (`lib/mcp/server.ts`) so an AI agent can read
   reports, trends, and top issues, and trigger a page/group audit — never
   a full sweep (see §4).
9. **Onboards a teammate by role** — a dismissible "here's what your role
   can do" banner once per person, and a role-aware waiting state instead
   of an admin-only checklist when there's nothing to look at yet.

## 4. Deliberately out of scope / refused by design

These are load-bearing decisions, not gaps — see `docs/DECISIONS.md` §2.2
and §11 for the reasoning:

- **No "audit everything now" button, ever.** A full sweep is
  schedule-only. There is no `run_full_sweep` MCP tool and never will be —
  it would let one click burn the entire daily PSI quota.
- **No SSE/WebSocket push.** Every live view (`ActiveRunBar`, `RunTerminal`)
  polls. The run executes in Vercel Workflow and writes to Postgres;
  a stream would still just be polling that state and re-emitting it.
- **MCP is feature-complete but explicitly not being extended right now**
  (per direct instruction, 20 Aug 2026) — 9 tools exist (`list_groups`,
  `list_pages`, `get_report`, `get_trend`, `top_issues`,
  `get_recommendation`, `run_page_audit`, `run_group_audit`,
  `get_run_status`); no new MCP surface is planned this pass.

## 5. Success criteria

- A full-site sweep completes within its measured throughput budget
  (~0.75 req/s against Google's PSI quota — see `docs/PLAN.md` §3) without
  manual intervention, on schedule, unattended.
- A person can answer "did this page get faster after the fix" without
  leaving the dashboard.
- Storage cost scales sub-linearly with sweep count (retention window +
  raw JSON stored in Cloudflare D1, not Postgres — see `docs/DECISIONS.md`
  §18, and now per-organisation rather than shared, §19), not linearly
  forever.
- A new teammate understands what their role lets them do without asking
  someone else first.

## 6. Known documentation drift (flagged, not silently carried forward)

`CLAUDE.md`'s "What this is" section still says *"Current scope: stages
1–2... scheduling, notifications, trends, AI recommendations, and MCP are
deliberately out of scope."* That is stale. `docs/RESUME_HERE.md` (the more
recently written of the two) already says stages 1–6 plus MCP are done, and
this session directly exercised scheduling, notifications, AI
recommendations, and the MCP tool list — all real, all working. Left
uncorrected in `CLAUDE.md` itself rather than edited as a side effect of
writing this document; whoever next touches that file's scope section
should reconcile it against reality.

## Related documents

- `docs/SPEC.md` — the original brief
- `docs/PLAN.md` — the approved stage 1–2 build plan
- `docs/DECISIONS.md` — why things are the way they are, numbered §1–§13
- `docs/BUILD_LOG.md` — chronological session log
- `docs/TRD.md`, `docs/BACKEND_SCHEMA.md`, `docs/APP_FLOW.md`, `docs/UI_UX.md`,
  `docs/IMPLEMENTATION_PLAN.md` — the rest of this document suite
