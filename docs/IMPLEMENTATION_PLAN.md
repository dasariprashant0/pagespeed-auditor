# Implementation Plan — Internal PageSpeed Auditor

> Status snapshot, not a new plan from scratch — `docs/PLAN.md` is the
> original stage 1–2 plan and stays as-is. This document tracks what's
> actually built against it, what was added beyond it, and what's still
> open. Written 20 Aug 2026. Cross-check against `docs/BUILD_LOG.md` (the
> chronological detail) before trusting any status here more than a few
> weeks old.

## 1. Status by stage

| Stage | Status | Notes |
|---|---|---|
| 1. Ingestion, PSI, queue, storage | **Done** | Queue is now Vercel Workflow, not BullMQ — `docs/DECISIONS.md` §11 |
| 2. Dashboard | **Done** | Full interface rebuild 20 Aug 2026 — `docs/DECISIONS.md` §10 |
| 3. Scheduling | **Done** | Vercel Cron, Hobby-plan daily-only limit — `docs/DECISIONS.md` §12 area |
| 4. Notifications | **Done** | Email (Resend/SMTP) + Slack, sweeps only |
| 5. Trends / regressions | **Done** | Score history per page, regression badges |
| 6. AI recommendations | **Done** | Versioned, Claude via `@anthropic-ai/sdk` |
| MCP server | **Done, not being extended this pass** | 8 tools, see `docs/TRD.md` §... and `docs/PRD.md` §4 |
| Multi-tenant rebuild | **Done** | `Organization`/`Membership`/role model throughout |

`CLAUDE.md`'s scope note ("current scope: stages 1–2... MCP deliberately
out of scope") is stale against this table — flagged in `docs/PRD.md` §6
rather than silently corrected, since it wasn't this session's call to
rewrite that file's framing.

## 2. What shipped in the 20 Aug 2026 session, in order

Each of these has its own detail in `docs/BUILD_LOG.md` and, where a real
architectural choice was made, a numbered entry in `docs/DECISIONS.md`.
Listed here as a flat checklist for planning purposes only:

1. Fixed a silent-data-loss bug: a non-`RetryableError` on a step's last
   retry attempt used to vanish via `Promise.allSettled` instead of
   recording a tracked failure.
2. Built the delete-checks picker (`RunHistoryList`) — pick specific
   historical runs, not just a blanket wipe.
3. Fixed the Overview page's Mobile/Desktop tabs showing stale per-section
   numbers (`SectionGrid` needed `key={strategy}`).
4. Added the Core Web Vitals Passed/Failed badge.
5. Added an explicit System/Light/Dark theme toggle.
6. Fixed the mobile/tablet nav disclosure not scrolling on a
   many-section site.
7. Added optimistic UI to `RunControls`, the delete-checks picker, and the
   schedule-enabled toggle.
8. Built role-aware onboarding (`RoleTourBanner`, `WaitingOnAdmin`),
   replacing an admin-only checklist that used to render for every role.
9. Diagnosed that `vercel env pull` cannot retrieve a working
   `DATABASE_URL` for this project, and moved `prisma migrate deploy` into
   the build itself as the structural fix.
10. Built the live "what's running" terminal (`RunTerminal`), Redis-backed.
11. Moved `AuditResult.rawJson` to Vercel Blob (~15× cheaper per GB than
    Neon for the same bytes), with cleanup wired into both prune paths.
12. This document suite.

Items 10 and 11 share the same unresolved local-verification limitation as
item 9's underlying cause — see §3.

## 3. Standing risk: local dev cannot verify everything

Three separate things can only be trusted against a real Vercel deployment,
never `next dev`:

1. **Vercel Workflow step execution** — steps get queued but sometimes
   never run locally, no error, no log line (`docs/DECISIONS.md` §11).
2. **`DATABASE_URL`** — genuinely unpullable for this project's production
   database (`docs/DECISIONS.md` §12).
3. **`BLOB_READ_WRITE_TOKEN`** — same symptom, no local fallback either
   (`docs/DECISIONS.md` §13).

Practical consequence for anyone continuing this work: **budget a real
Vercel deploy-and-verify cycle into any change touching
`lib/workflows/*`, `lib/blob.ts`, or a schema migration.** Type-checking
and a local build are necessary, not sufficient.

## 4. Open items

| # | Item | Why it's still open |
|---|---|---|
| 1 | `CLAUDE.md`'s stale scope note | Flagged, not fixed — needs a deliberate pass, not a side effect |
| 2 | Storage panel doesn't show Blob usage | `historyOverview` reports Postgres bytes only; Blob is a separate, cheaper line not yet surfaced anywhere in the UI |
| 3 | Two PSI fixtures never captured (per `docs/RESUME_HERE.md`) | A page with no CrUX data, and one with `origin_fallback: true` |
| 4 | `AUTH_PASSWORD_HASH`/single-tenant leftovers in `.env.example` | The app is multi-tenant now; some original single-tenant env docs may be stale |
| 5 | MCP tool surface | Feature-complete, explicitly not being extended this pass (direct instruction, 20 Aug 2026) |

## 5. Verification bar for anything added to this list

Match what this session actually did, not a lower bar:
`npx tsc --noEmit`, `npm run lint`, `npm test`, and for anything
UI-facing, a real browser check (this session used Playwright against
both local dev and the live Vercel deployment) — not just "the types
compile." For anything touching Workflow, Postgres migrations, or Blob,
verify against a live Vercel deployment specifically, per §3.

## Related documents

`docs/PLAN.md` (original plan), `docs/BUILD_LOG.md` (chronological detail),
`docs/DECISIONS.md` (numbered rationale), `docs/PRD.md`, `docs/TRD.md`,
`docs/APP_FLOW.md`, `docs/UI_UX.md`, `docs/BACKEND_SCHEMA.md`.
