# Per-tenant Neon + D1, Phase 5 (the cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every real code path — Server Actions, dashboard pages, API routes, Vercel Workflow steps, the cron tick, and the MCP server — reads and writes each organization's own Neon database (and, for raw Lighthouse JSON, its own D1 database) instead of the one shared database the app has used since it was single-tenant. Phases 1–4 built and verified the pieces (encryption, org-picker, tenant schema/migrations, the `getTenantPrisma`/`withTenantPrisma` resolver, the provisioning UI, and — start of this session — real D1 schema creation). Nothing outside the provisioning UI calls any of that yet. This phase is the wiring.

**Architecture:** `lib/db.ts`'s `prisma` export is renamed to `centralPrisma` and moves to `lib/db/central.ts` — a deliberately breaking rename (docs/DECISIONS.md §19) that makes `npx tsc --noEmit` enumerate every call site needing a decision. Central-only files (identity/routing: `User`, `Organization`, `Membership`, `Invitation`, `PasswordReset`, `McpToken`) get a mechanical import rename. Every other file — anything touching `Site`, `Group`, `GroupAlias`, `Page`, `AuditRun`, `AuditResult`, `AuditIssue`, `Recommendation`, `Schedule`, `NotificationSetting`, `RateLimitBucket`, `KeyValue`, or `RunLogEvent` — resolves `getTenantPrisma(organizationId)` instead, with `organizationId` threaded in as a new parameter wherever it wasn't already there. `organizationId` is already available at every call site that needs it (every Server Action starts with `requireCapability()`/`requireSession()`, which returns it; the MCP server resolves it from the bearer token), so this is a wide but shallow change — no new access-control logic, just plumbing an id that already exists down one more level.

The one place this is NOT shallow is `lib/workflows/*`: Vercel Workflow persists a running workflow's function name and arguments so it can resume after a crash or a deploy. Widening `auditRunWorkflow`'s signature to carry `organizationId` means any run already `queued`/`running`/`paused` at the moment this deploys will fail to resume (its persisted arguments won't match the new function signature). **Task 12 is a hold point: confirm zero in-flight runs in production before merging Task 7 onward.**

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 with two schemas (`prisma/central/`, `prisma/tenant/`) and two generated clients, Vercel Workflow (`workflow`/`workflow/api`), Cloudflare D1 (HTTP query API), Neon Postgres, `mcp-handler`.

**Spec:** `docs/DECISIONS.md` §19 (why, and the approved sequencing), `docs/PER_TENANT_ARCHITECTURE.md` (current-state explainer, including the D1 gap this session already fixed), `docs/BUILD_LOG.md` (Phase 1–4 entries + the D1-fix entry this plan follows), `lib/db/tenant.ts` (the resolver this plan wires in), `lib/tenantDb/provision.ts` (provisioning, already done).

## Global Constraints

- **Framework-free zone unchanged**: `lib/services/`, `lib/psi/`, `lib/report/`, `lib/sitemap/` still may not import `next/*`, `react`, or `server-only`. `lib/workflows/*` is still exempt (needs the Workflow SDK).
- **`AuditResult` error rows**: every aggregate/average/trend query still filters `status: 'ok'`. Nothing in this phase changes those queries' `where` clauses — only which client they run against.
- **No behavior change to business logic.** This phase moves *which database* each query runs against. It must not change scoring, retention, regression thresholds, rate limiting, or any UI copy. If a file needs a non-mechanical change beyond adding `organizationId` and resolving a client, stop and flag it rather than improvising a design decision inline.
- **No migration of existing audit history** (already decided, §19) — out of scope here, not re-litigated.
- **No shared/fallback tenant DB tier** (already decided, §19) — `getTenantPrisma`/`withTenantPrisma` throwing `NotProvisionedError` for an unprovisioned org is correct behavior, not a bug to work around.
- **Verify before claiming**, every task: `npx tsc --noEmit && npm run lint && npm test`, quoting real output. `npm run build` at the end of the whole phase (Task 13), since it also runs `prisma generate` for both schemas and Workflow's own compile step.
- **`npm run` scripts already exist** for the tenant schema (`db:generate`, `db:migrate:tenant`, `build:tenant-migrations`) — this plan does not add new ones except where a task says so.

---

### Task 1: Rename the central client, mirror the tenant folder layout

**Files:**
- Create: `lib/db/central.ts` (moved from `lib/db.ts`, `prisma` renamed to `centralPrisma`)
- Delete: `lib/db.ts`
- Modify: `lib/db/tenant.ts:3` (import path)
- Move: `prisma/schema.prisma` → `prisma/central/schema.prisma`
- Move: `prisma/migrations/` → `prisma/central/migrations/`
- Modify: `prisma.config.ts` (schema path)
- Modify: `prisma/seed.ts` if it imports the schema path or `lib/db.ts` (check first)

**Interfaces:**
- Produces: `export const centralPrisma: PrismaClient` from `lib/db/central.ts`, `export const AUDIT_RESULT_SUMMARY_SELECT` (unchanged, moves with the file). Every later task's "central" changes import `centralPrisma` from `@/lib/db/central` (app/lib files) or `../db/central.ts` (lib files).

- [ ] **Step 1: Move and rename the central client**

  Move `lib/db.ts` to `lib/db/central.ts` unchanged except:
  ```ts
  // was: export const prisma: PrismaClient = new Proxy(...)
  export const centralPrisma: PrismaClient = new Proxy({} as PrismaClient, {
    get(_t, prop) {
      const client = resolve();
      const v = Reflect.get(client, prop);
      return typeof v === 'function' ? v.bind(client) : v;
    },
  });
  ```
  `AUDIT_RESULT_SUMMARY_SELECT` moves with the file unchanged (it's a `select` shape, not a client — used by tenant-side result queries too, so leave it exported from here; tenant-side callers import it from `@/lib/db/central` same as before from `@/lib/db`).

- [ ] **Step 2: Update `lib/db/tenant.ts`'s import**

  ```ts
  // lib/db/tenant.ts:3
  // was:
  import { prisma as centralPrisma } from '../db.ts';
  // now:
  import { centralPrisma } from './central.ts';
  ```

- [ ] **Step 3: Mirror the tenant folder layout for the central schema**

  ```bash
  mkdir -p prisma/central
  git mv prisma/schema.prisma prisma/central/schema.prisma
  git mv prisma/migrations prisma/central/migrations
  ```

- [ ] **Step 4: Point `prisma.config.ts` at the new path**

  ```ts
  // prisma.config.ts
  export default defineConfig({
    schema: 'prisma/central/schema.prisma',
    datasource: {
      url: env('DATABASE_URL'),
    },
    migrations: {
      seed: 'tsx prisma/seed.ts',
    },
  });
  ```

- [ ] **Step 5: Check `prisma/seed.ts` for a hardcoded schema path or `lib/db.ts` import**

  ```bash
  grep -n "lib/db\|prisma/schema" prisma/seed.ts
  ```
  If it imports `lib/db.ts`, update to `lib/db/central.ts` and `prisma` → `centralPrisma`. If it references `prisma/schema.prisma` by path (unlikely — Prisma's CLI resolves this via `prisma.config.ts`), update to the new path.

- [ ] **Step 6: Confirm the break is total, then stop — do not fix downstream files yet**

  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  ```
  Expect a large, nonzero count — every remaining `prisma`/`lib/db` reference across the repo is now a compile error. This count is the actual to-do list for Tasks 2–11; do not hand-search for call sites, let the compiler enumerate them as each task lands.

- [ ] **Step 7: Commit**

  ```bash
  git add lib/db lib/db.ts prisma/central prisma/migrations prisma/schema.prisma prisma.config.ts prisma/seed.ts 2>/dev/null
  git commit -m "phase5: rename central prisma client, mirror tenant/ folder layout for schema+migrations"
  ```
  (This commit will NOT typecheck clean on its own — that's expected and is the point of the forcing function. Every subsequent task's commit narrows the error count toward zero.)

---

### Task 2: Pure-central files — mechanical import rename

These files touch only `User`, `Organization`, `Membership`, `Invitation`, `PasswordReset`, `McpToken` — no `organizationId`-threading needed, just swap the import.

**Files:**
- Modify: `lib/services/account.service.ts:2`
- Modify: `lib/services/org.service.ts` (check its import line — likely already imports from a relative path)
- Modify: `lib/mcp/auth.ts:2`
- Modify: `app/actions/members.ts`
- Modify: `app/actions/provisioning.ts:5`
- Modify: `app/(auth)/invite/page.tsx`
- Modify: `app/(dash)/settings/team/page.tsx`

**Interfaces:**
- Consumes: `centralPrisma` from Task 1.

- [ ] **Step 1: `lib/services/account.service.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { centralPrisma } from '../db/central.ts';
  ```
  Then replace every `prisma.` with `centralPrisma.` in this file (it's `user`/`membership`/`invitation`/`organization`/`passwordReset` throughout — all central).

- [ ] **Step 2: `lib/services/org.service.ts`**

  Same pattern: rename its `prisma` import to `centralPrisma` and every `prisma.organization.` call site in the file. (This is `provisionRefFor`/`d1CredentialsForOrg` from Phase 4 — `Organization` is central, so this file needs no other change.)

- [ ] **Step 3: `lib/mcp/auth.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { centralPrisma } from '../db/central.ts';
  ```
  Replace the three `prisma.mcpToken.` call sites (lines 33, 47, 54) with `centralPrisma.mcpToken.`.

- [ ] **Step 4: `app/actions/members.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { centralPrisma } from '@/lib/db/central';
  ```
  Replace every `prisma.membership.`/`prisma.invitation.`/`prisma.user.` in this file with `centralPrisma.`.

- [ ] **Step 5: `app/actions/provisioning.ts`**
  ```ts
  // app/actions/provisioning.ts:5
  // was: import { prisma } from '@/lib/db';
  import { centralPrisma } from '@/lib/db/central';
  ```
  Replace the three `prisma.organization.update` call sites with `centralPrisma.organization.update`.

- [ ] **Step 6: `app/(auth)/invite/page.tsx`**

  Find its `prisma` import (it uses `prisma.invitation.findUnique` and `prisma.user.findUnique`, both central) and rename the same way.

- [ ] **Step 7: `app/(dash)/settings/team/page.tsx`**

  Same: `prisma.membership.findMany` / `prisma.invitation.findMany` are both central-only — rename import and call sites.

- [ ] **Step 8: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  ```
  Count should have dropped by roughly these 7 files' worth of errors.
  ```bash
  git add lib/services/account.service.ts lib/services/org.service.ts lib/mcp/auth.ts app/actions/members.ts app/actions/provisioning.ts "app/(auth)/invite/page.tsx" "app/(dash)/settings/team/page.tsx"
  git commit -m "phase5: central-only files — rename prisma import to centralPrisma"
  ```

---

### Task 3: Split `lib/services/tenant.service.ts`

This file is genuinely mixed: it resolves `Site`/`Page`/`Group`/`AuditRun` access (tenant data) AND reads `Organization.smtp*` (central data). Every function already takes `organizationId` as its first parameter except `psiKeyForSite`, which needs it added.

**Files:**
- Modify: `lib/services/tenant.service.ts`

**Interfaces:**
- Consumes: `getTenantPrisma` from `lib/db/tenant.ts`, `centralPrisma` from `lib/db/central.ts`.
- Produces: `psiKeyForSite(organizationId: string, siteId: string): Promise<string | null>` — **signature changed**, callers updated in Task 6 (it's called from inside `lib/services/audit.service.ts`'s `auditPage`, threaded through in Task 7).

- [ ] **Step 1: Split the imports**
  ```ts
  // lib/services/tenant.service.ts:1-3
  // was:
  import { prisma } from '../db.ts';
  import { NotFoundError } from '../errors.ts';
  import type { SmtpOverride } from '../notify/email.ts';
  // now:
  import { getTenantPrisma } from '../db/tenant.ts';
  import { centralPrisma } from '../db/central.ts';
  import { NotFoundError } from '../errors.ts';
  import type { SmtpOverride } from '../notify/email.ts';
  ```

- [ ] **Step 2: Tenant-scoped functions resolve the tenant client**

  For `listSites`, `defaultSite`, `requireSiteAccess`, `requirePageAccess`, `requireGroupAccess`, `requireRunAccess` — each already takes `organizationId` first. Add one line at the top of each function body and leave the rest of the body (the `prisma.site.findMany(...)` etc.) untouched — the local `const prisma` shadows the removed module-level import:

  ```ts
  export async function listSites(organizationId: string): Promise<SiteRef[]> {
    const prisma = await getTenantPrisma(organizationId);
    const sites = await prisma.site.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: SITE_SELECT,
    });
    return sites.map(toRef);
  }
  ```
  Repeat identically (one `const prisma = await getTenantPrisma(organizationId);` inserted as the first line) for `defaultSite`, `requireSiteAccess`, `requirePageAccess`, `requireGroupAccess`, `requireRunAccess`.

  Note: once every `Site`/`Page`/`Group`/`AuditRun` row in a tenant database belongs to exactly one org by construction, the `organizationId`/`site: { organizationId }` filters inside these `where` clauses become redundant defense-in-depth rather than the actual isolation boundary — **leave them in**. They cost nothing and they're what stops a resolver bug (wrong org's client cached) from becoming a cross-tenant read instead of a 404.

- [ ] **Step 3: `psiKeyForSite` gains `organizationId`**
  ```ts
  // was:
  export async function psiKeyForSite(siteId: string): Promise<string | null> {
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { psiApiKey: true } });
    return site?.psiApiKey?.trim() || null;
  }
  // now:
  export async function psiKeyForSite(organizationId: string, siteId: string): Promise<string | null> {
    const prisma = await getTenantPrisma(organizationId);
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { psiApiKey: true } });
    return site?.psiApiKey?.trim() || null;
  }
  ```

- [ ] **Step 4: Central-scoped functions use `centralPrisma`**

  `emailConfigForOrg` and `orgEmailRef` keep their existing bodies, just swap `prisma.organization.` → `centralPrisma.organization.`. No signature change (both already take only `organizationId`, no tenant lookup needed).

- [ ] **Step 5: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  git add lib/services/tenant.service.ts
  git commit -m "phase5: split tenant.service.ts — tenant client for site/page/group/run, central for org email"
  ```

---

### Task 4: Family A — DI-style services, type rename only

These already take `prisma` as an explicit parameter typed against the (now wrong) central `PrismaClient`. Their bodies do not change at all — only the type they're declared against.

**Files:**
- Modify: `lib/services/audit.service.ts:1`
- Modify: `lib/services/run.service.ts:1`
- Modify: `lib/services/retention.service.ts:1`
- Modify: `lib/services/ingest.service.ts:1`
- Modify: `lib/services/group.service.ts:1`

**Interfaces:**
- Consumes: `TenantPrismaClient` — already exported from `lib/db/tenant.ts:22` (`export type { PrismaClient as TenantPrismaClient };`). No change needed there.
- Produces (beyond the type rename — these two ALSO gain a real new parameter, because raw JSON lives in D1, a wholly separate credential from Postgres that can't be inferred from `prisma`):
  - `recordAuditResult(prisma, args, d1?: D1Credentials, storeRawJsonFn?)` — `d1` inserted before the existing defaulted `storeRawJsonFn` param.
  - `auditPage(deps: AuditPageDeps, args)` — `AuditPageDeps` gains `organizationId: string` and `d1?: D1Credentials`.
  - `pruneSiteHistory(prisma, siteId, d1?: D1Credentials, deleteBlobs?)`, `deleteRuns(prisma, siteId, runIds, d1?: D1Credentials, deleteBlobs?)` in `retention.service.ts` — same shape, `d1` inserted before the existing defaulted `deleteBlobs` param.

  **Why this belongs in this task and not later:** without it, Tasks 7–11 would faithfully move every `Site`/`Page`/`AuditRun`/etc. row to each org's own Neon database while every audit's raw Lighthouse JSON kept landing in the one shared, env-configured D1 database — silently defeating the entire reason this migration exists for D1 (§18's cost/quota incident, which is exactly what motivated making D1 per-tenant in the first place, `docs/DECISIONS.md` §19). `lib/services/org.service.ts`'s `d1CredentialsForOrg(organizationId): Promise<D1Credentials | null>` already exists (Phase 4) specifically for this — its own docstring says so verbatim: *"for lib/blob.ts's callers once they're threaded through (a later phase)."* This is that phase. `null` (org hasn't set D1 credentials) is handled automatically: `lib/blob.ts`'s three exports already fall back to the shared env D1 when `creds` is `undefined` — so pass `d1 ?? undefined`, never `null`, at each call site.

- [ ] **Step 1: `lib/services/audit.service.ts`**
  ```ts
  // was: import type { PrismaClient } from '@prisma/client';
  import type { TenantPrismaClient } from '../db/tenant.ts';
  import type { D1Credentials } from '../blob.ts';
  ```
  Rename every parameter typed `prisma: PrismaClient` to `prisma: TenantPrismaClient` (two call sites: `recordAuditResult`'s param at line 43, and the `AuditPageDeps.prisma` field at line 213). Then:

  ```ts
  // recordAuditResult's signature — was:
  export async function recordAuditResult(
    prisma: TenantPrismaClient,
    args: { /* ...unchanged... */ },
    storeRawJsonFn: typeof storeRawJson = storeRawJson,
  ): Promise<RecordOutcome> {
  // now:
  export async function recordAuditResult(
    prisma: TenantPrismaClient,
    args: { /* ...unchanged... */ },
    d1?: D1Credentials,
    storeRawJsonFn: typeof storeRawJson = storeRawJson,
  ): Promise<RecordOutcome> {
  ```
  And its one call to `storeRawJsonFn`:
  ```ts
  // was: rawJsonBlobKey = await storeRawJsonFn(runId, pageId, strategy, args.rawJson);
  rawJsonBlobKey = await storeRawJsonFn(runId, pageId, strategy, args.rawJson, d1);
  ```

  `AuditPageDeps` gains two fields:
  ```ts
  export interface AuditPageDeps {
    prisma: TenantPrismaClient;
    limiter: PsiRateLimiter;
    organizationId: string;
    d1?: D1Credentials;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }
  ```
  Inside `auditPage`, its `psiKeyForSite` call (which Task 3 Step 3 changed to take `organizationId` first) becomes:
  ```ts
  // was: const apiKey = (page ? await psiKeyForSite(page.siteId) : null) ?? env.PSI_API_KEY;
  const apiKey = (page ? await psiKeyForSite(deps.organizationId, page.siteId) : null) ?? env.PSI_API_KEY;
  ```
  And all three of `auditPage`'s `recordAuditResult(deps.prisma, {...})` calls (the two error branches with `rawJson: null`, and the final success-path return with `rawJson: pruned`) gain `deps.d1` as the new third argument: `recordAuditResult(deps.prisma, {...}, deps.d1)`. The two `rawJson: null` branches never trigger a D1 call either way (`recordAuditResult` only calls `storeRawJsonFn` when `args.rawJson != null`) — passed through anyway for consistency, not because it does anything there.

- [ ] **Step 2: `lib/services/run.service.ts`**

  Same import swap. Rename every `prisma: PrismaClient` parameter to `prisma: TenantPrismaClient` — this file has the most (`getRunProgress`, `findActiveRun`, `createRun`, `createSkippedRun`, `finalizeRun`, `failRun`, `expandScope`, `failedResultsForRun`, `failedPairsForRun`, `resumeRun`, `reconcileStaleRuns`, `controlRun`). No body changes anywhere in this file.

- [ ] **Step 3: `lib/services/retention.service.ts`**

  Same import swap, rename `pruneSiteHistory`, `deleteRuns`, `historyOverview`'s `prisma: PrismaClient` params to `TenantPrismaClient`. `historyOverview` never touches D1 (it only counts) — no further change there. `pruneSiteHistory` and `deleteRuns` both call `deleteBlobs`, which needs D1 credentials for the same reason `recordAuditResult` did in Step 1:
  ```ts
  import type { D1Credentials } from '../blob.ts';
  ```
  ```ts
  // pruneSiteHistory — was:
  export async function pruneSiteHistory(
    prisma: TenantPrismaClient,
    siteId: string,
    deleteBlobs: (pathnames: string[]) => Promise<void> = deleteRawJsonBlobs,
  ): Promise<RetentionSummary> {
    // ...unchanged body until:
    await deleteBlobs(blobKeys);
  // now:
  export async function pruneSiteHistory(
    prisma: TenantPrismaClient,
    siteId: string,
    d1?: D1Credentials,
    deleteBlobs: (pathnames: string[], d1?: D1Credentials) => Promise<void> = deleteRawJsonBlobs,
  ): Promise<RetentionSummary> {
    // ...unchanged body until:
    await deleteBlobs(blobKeys, d1);
  ```
  Same shape for `deleteRuns`:
  ```ts
  // was:
  export async function deleteRuns(
    prisma: TenantPrismaClient,
    siteId: string,
    runIds: string[],
    deleteBlobs: (pathnames: string[]) => Promise<void> = deleteRawJsonBlobs,
  ): Promise<{ runsDeleted: number; resultsDeleted: number }> {
    // ...unchanged body until:
    await deleteBlobs(blobKeys);
  // now:
  export async function deleteRuns(
    prisma: TenantPrismaClient,
    siteId: string,
    runIds: string[],
    d1?: D1Credentials,
    deleteBlobs: (pathnames: string[], d1?: D1Credentials) => Promise<void> = deleteRawJsonBlobs,
  ): Promise<{ runsDeleted: number; resultsDeleted: number }> {
    // ...unchanged body until:
    await deleteBlobs(blobKeys, d1);
  ```
  (`deleteRawJsonBlobs`'s real signature is already `(pathnames, creds?, fetchImpl?)` — widening the injected `deleteBlobs` type to accept the same optional second argument is compatible with the existing default, and with any test that already passes a one-argument spy, since TypeScript allows a spy typed `(pathnames: string[]) => Promise<void>` to satisfy a caller that happens to pass a second argument the spy's type doesn't declare — but if `test/retention.test.ts` types its spy explicitly against the old signature, widen that test's spy type too rather than leaving it out of sync.)

- [ ] **Step 4: `lib/services/ingest.service.ts`**

  Same import swap, rename `ingestSitemap`'s `prisma: PrismaClient` param.

- [ ] **Step 5: `lib/services/group.service.ts`**

  Same import swap, rename `renameGroup` and `mergeGroups`'s `prisma: PrismaClient` params.

- [ ] **Step 6: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  npm test
  git add lib/services/audit.service.ts lib/services/run.service.ts lib/services/retention.service.ts lib/services/ingest.service.ts lib/services/group.service.ts
  git commit -m "phase5: DI-style services — retype injected prisma param as TenantPrismaClient"
  ```
  (`npm test` matters here specifically: these five files have real unit tests against a fake/injected client — e.g. run.service tests, audit.service tests — confirm they still pass with the retyped parameter, since a type-only change that's actually wrong would still show up as a test failure if any test imported the concrete `@prisma/client` type directly.)

---

### Task 5: Family B — module-scope services gain `organizationId`

These import `prisma` at module scope and take bare `pageId`/`siteId`/`groupId`/`runId` — no `organizationId` parameter exists yet. Add it as the new first parameter everywhere, resolve the tenant client as the function's first line, leave the rest of each body untouched (the local `const prisma` shadows the now-removed module import).

**Files:**
- Modify: `lib/services/results.service.ts`
- Modify: `lib/services/report.service.ts`
- Modify: `lib/services/issues.service.ts`
- Modify: `lib/services/site.service.ts`
- Modify: `lib/services/recommendation.service.ts`
- Modify: `lib/services/estimate.service.ts`
- Modify: `lib/services/schedule.service.ts`
- Modify: `lib/services/regression.service.ts`
- Modify: `lib/services/sweepSummary.service.ts`
- Modify: `lib/services/onboarding.service.ts` (import swap only — already has `organizationId`)
- Modify: `lib/notify/index.ts`

**Interfaces:**
- Produces (signature changes callers in Tasks 6, 7, 9, 10 depend on — exact old → new):

| File | Function | Old signature | New signature |
|---|---|---|---|
| `results.service.ts` | `listGroupsWithAggregates` | `(siteId, opts)` | `(organizationId, siteId, opts)` |
| `results.service.ts` | `listPagesInGroup` | `(groupId, opts)` | `(organizationId, groupId, opts)` |
| `results.service.ts` | `getPageScoreHistory` | `(pageId, strategy, limit?)` | `(organizationId, pageId, strategy, limit?)` |
| `results.service.ts` | `getScoreHistory` | `(scope, opts)` | `(organizationId, scope, opts)` |
| `results.service.ts` | `getPageRunHistory` | `(pageId, strategy, limit?)` | `(organizationId, pageId, strategy, limit?)` |
| `report.service.ts` | `getPageReport` | `(pageId, strategy, opts?)` | `(organizationId, pageId, strategy, opts?)` |
| `issues.service.ts` | `findSnapshotRun` | `(siteId?)` | `(organizationId, siteId?)` |
| `issues.service.ts` | `getTopIssues` | `(opts: TopIssueOptions)` | `(organizationId, opts: TopIssueOptions)` |
| `site.service.ts` | `getRunProgress` | `(runId)` | `(organizationId, runId)` |
| `site.service.ts` | `listRecentRuns` | `(siteId, limit?)` | `(organizationId, siteId, limit?)` |
| `site.service.ts` | `getSiteSummary` | `(siteId, strategy?)` | `(organizationId, siteId, strategy?)` |
| `recommendation.service.ts` | `listRecommendations` | `(pageId, strategy)` | `(organizationId, pageId, strategy)` |
| `recommendation.service.ts` | `getOrCreateRecommendation` | `(pageId, strategy, opts?)` | `(organizationId, pageId, strategy, opts?)` |
| `estimate.service.ts` | `estimateRun` | `(jobs, siteId?)` | `(organizationId, jobs, siteId?)` |
| `schedule.service.ts` | `saveSchedule` | `(siteId, input)` | `(organizationId, siteId, input)` |
| `schedule.service.ts` | `dueSchedules` | `(now?)` | `(organizationId, now?)` |
| `schedule.service.ts` | `advanceSchedule` | `(scheduleId, cronExpr, timezone)` | `(organizationId, scheduleId, cronExpr, timezone)` |
| `regression.service.ts` | `regressionsForPage` | `(pageId, strategy)` | `(organizationId, pageId, strategy)` |
| `sweepSummary.service.ts` | `buildSweepSummary` | `(runId, event, appUrl)` | `(organizationId, runId, event, appUrl)` |
| `lib/notify/index.ts` | `dispatchSweepNotification` | `(siteId, summary)` | `(organizationId, siteId, summary)` |

- [ ] **Step 1: `lib/services/results.service.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  ```
  For each of the five exported async functions listed in the table, add `organizationId: string` as the new first parameter and insert `const prisma = await getTenantPrisma(organizationId);` as the first line of the function body. Example for one:
  ```ts
  // was:
  export async function listGroupsWithAggregates(
    siteId: string,
    opts: StrategyOptions,
  ): Promise<GroupSummaryDTO[]> {
    // ...uses prisma.group.findMany etc...
  }
  // now:
  export async function listGroupsWithAggregates(
    organizationId: string,
    siteId: string,
    opts: StrategyOptions,
  ): Promise<GroupSummaryDTO[]> {
    const prisma = await getTenantPrisma(organizationId);
    // ...body unchanged...
  }
  ```
  Apply the same shape (new first param, one new first line, body untouched) to `listPagesInGroup`, `getPageScoreHistory`, `getScoreHistory`, `getPageRunHistory`.

- [ ] **Step 2: `lib/services/report.service.ts`**

  Same import swap. `getPageReport(pageId, strategy, opts?)` → `getPageReport(organizationId, pageId, strategy, opts = {})`, with `const prisma = await getTenantPrisma(organizationId);` as its first line. This function also reads a stored blob via `fetchRawJson(rawRow.rawJsonBlobKey)` — same D1-credentials gap as Task 4's Step 1/Step 3, fixed the same way:
  ```ts
  import { d1CredentialsForOrg } from './org.service.ts';
  ```
  ```ts
  export async function getPageReport(
    organizationId: string,
    pageId: string,
    strategy: PsiStrategy,
    opts: PageReportOptions = {},
  ): Promise<PageReportDTO> {
    const prisma = await getTenantPrisma(organizationId);
    // ...body unchanged down to the blob fetch, then:
    const rawJson = rawRow?.rawJsonBlobKey
      ? await fetchRawJson(rawRow.rawJsonBlobKey, (await d1CredentialsForOrg(organizationId)) ?? undefined)
      : rawRow?.rawJson ?? null;
    // ...rest of the function unchanged...
  }
  ```
  (`d1CredentialsForOrg` returns `D1Credentials | null`; `fetchRawJson`'s `creds` parameter is typed `D1Credentials | undefined` — the `?? undefined` is required, not cosmetic, or this is a type error.)

- [ ] **Step 3: `lib/services/issues.service.ts`**

  Same import swap. `findSnapshotRun(siteId?)` → `findSnapshotRun(organizationId, siteId?)`. `getTopIssues(opts)` → `getTopIssues(organizationId, opts)`. Both get the same first-line client resolution. (If `getTopIssues` calls `findSnapshotRun` internally, pass `organizationId` through — check the body before editing.)

- [ ] **Step 4: `lib/services/site.service.ts`**

  Same import swap (it currently has none at module scope for `prisma` — check: `site.service.ts` imports `{ prisma } from '../db.ts'` per the grep in this plan's research; confirm before editing). `getRunProgress(runId)` → `getRunProgress(organizationId, runId)`, `listRecentRuns(siteId, limit?)` → `listRecentRuns(organizationId, siteId, limit?)`, `getSiteSummary(siteId, strategy?)` → `getSiteSummary(organizationId, siteId, strategy?)`. Same first-line pattern for each. Pure functions in this file (`asRunStatus`, `percentComplete`, `estimateEtaSeconds`, `toRunProgress`) are untouched — they take no `prisma` at all.

- [ ] **Step 5: `lib/services/recommendation.service.ts`**

  Same import swap. `listRecommendations(pageId, strategy)` → `listRecommendations(organizationId, pageId, strategy)`, `getOrCreateRecommendation(pageId, strategy, opts?)` → `getOrCreateRecommendation(organizationId, pageId, strategy, opts = {})`. This file also calls `getPageReport` internally (Step 2's function) — update that internal call to pass `organizationId` through.

- [ ] **Step 6: `lib/services/estimate.service.ts`**

  Same import swap. `estimateRun(jobs, siteId?)` → `estimateRun(organizationId, jobs, siteId?)`.

- [ ] **Step 7: `lib/services/schedule.service.ts`**

  Same import swap. `saveSchedule(siteId, input)` → `saveSchedule(organizationId, siteId, input)`. `dueSchedules(now?)` → `dueSchedules(organizationId, now?)` — **this one changes meaning**, not just signature: it currently queries every due schedule with no org filter at all (there's only one database today). After this change it queries one org's tenant database, so its caller (the cron route, Task 8) must call it once per provisioned org rather than once globally. `advanceSchedule(scheduleId, cronExpr, timezone)` → `advanceSchedule(organizationId, scheduleId, cronExpr, timezone)`.

- [ ] **Step 8: `lib/services/regression.service.ts`**

  Same import swap. `regressionsForPage(pageId, strategy)` → `regressionsForPage(organizationId, pageId, strategy)`.

- [ ] **Step 9: `lib/services/sweepSummary.service.ts`**

  Same import swap. `buildSweepSummary(runId, event, appUrl)` → `buildSweepSummary(organizationId, runId, event, appUrl)`.

- [ ] **Step 10: `lib/services/onboarding.service.ts`**

  This one already takes `organizationId` (it's the function's only param today) — no signature change, just:
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  ```
  and insert `const prisma = await getTenantPrisma(organizationId);` right after the `defaultSite(organizationId)` call at the top of `onboardingState`.

- [ ] **Step 11: `lib/notify/index.ts`**

  Same import swap. `dispatchSweepNotification(siteId, summary)` → `dispatchSweepNotification(organizationId, siteId, summary)`, resolving the tenant client for its one `prisma.site.findUnique` call. It also calls `emailConfigForOrg(organizationId)` from `tenant.service.ts` (Task 3) — already takes `organizationId`, no change needed to that call.

- [ ] **Step 12: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  npm test
  git add lib/services/results.service.ts lib/services/report.service.ts lib/services/issues.service.ts lib/services/site.service.ts lib/services/recommendation.service.ts lib/services/estimate.service.ts lib/services/schedule.service.ts lib/services/regression.service.ts lib/services/sweepSummary.service.ts lib/services/onboarding.service.ts lib/notify/index.ts
  git commit -m "phase5: module-scope services — add organizationId, resolve tenant client"
  ```
  Every caller of these functions is now a compile error — that's the remaining count, resolved in Tasks 6–10.

---

### Task 6: `lib/opsState.ts` — rate limiter, heartbeat, run log gain `organizationId`

`RateLimitBucket`, `KeyValue`, and `RunLogEvent` all moved into the tenant schema (already true as of the Phase 3 scaffolding). The rate limiter becomes genuinely per-org (each org has its own PSI key and quota — this is actually *more* correct than the single shared bucket today). The scheduler heartbeat becomes per-org too: since the cron route now iterates every provisioned org (Task 8), "is the scheduler ticking" is naturally checked/stamped once per org, not globally.

**Files:**
- Modify: `lib/opsState.ts`

**Interfaces:**
- Produces:
  - `getPsiRateLimiter(organizationId: string): Promise<PsiRateLimiter>` (was sync, no arg — now async since it must resolve a tenant client before constructing the limiter; cache one limiter instance per org, not a single module-level singleton)
  - `stampSchedulerHeartbeat(organizationId: string): Promise<void>`
  - `schedulerHealth(organizationId: string): Promise<SchedulerHealth>`
  - `pushRunLogEvent(organizationId: string, runId: string, event: RunLogEvent): Promise<void>`
  - `readRunLog(organizationId: string, runId: string, limit?: number): Promise<RunLogEvent[]>`
  - `clearRunLog(organizationId: string, runId: string): Promise<void>`

- [ ] **Step 1: Swap the import, make the rate limiter per-org**
  ```ts
  // was:
  import { prisma } from './db.ts';
  import { getEnv } from './env.ts';
  import { PsiRateLimiter } from './psi/rateLimiter.ts';

  let limiter: PsiRateLimiter | undefined;

  export function getPsiRateLimiter(): PsiRateLimiter {
    const env = getEnv();
    limiter ??= new PsiRateLimiter({
      db: prisma,
      max: env.PSI_RATE_MAX,
      windowMs: env.PSI_RATE_WINDOW_MS,
    });
    return limiter;
  }
  // now:
  import { getTenantPrisma } from './db/tenant.ts';
  import { getEnv } from './env.ts';
  import { PsiRateLimiter } from './psi/rateLimiter.ts';

  const limiters = new Map<string, PsiRateLimiter>();

  export async function getPsiRateLimiter(organizationId: string): Promise<PsiRateLimiter> {
    const cached = limiters.get(organizationId);
    if (cached) return cached;
    const env = getEnv();
    const db = await getTenantPrisma(organizationId);
    const limiter = new PsiRateLimiter({ db, max: env.PSI_RATE_MAX, windowMs: env.PSI_RATE_WINDOW_MS });
    limiters.set(organizationId, limiter);
    return limiter;
  }
  ```
  (Unbounded `limiters` map is fine here for the same reason `getTenantPrisma`'s cache is bounded and this isn't: a `PsiRateLimiter` instance is a few bytes of config, not a connection pool — no eviction needed. If this ever needs one, mirror `getTenantPrisma`'s LRU.)

- [ ] **Step 2: Heartbeat gains `organizationId`**
  ```ts
  export async function stampSchedulerHeartbeat(organizationId: string): Promise<void> {
    const prisma = await getTenantPrisma(organizationId);
    await prisma.keyValue
      .upsert({
        where: { key: HEARTBEAT_KEY },
        update: { value: String(Date.now()) },
        create: { key: HEARTBEAT_KEY, value: String(Date.now()) },
      })
      .catch(() => {});
  }

  export async function schedulerHealth(organizationId: string): Promise<SchedulerHealth> {
    try {
      const prisma = await getTenantPrisma(organizationId);
      const row = await prisma.keyValue.findUnique({ where: { key: HEARTBEAT_KEY } });
      if (!row) return { alive: false, lastTickSecondsAgo: null };
      const ageMs = Date.now() - Number(row.value);
      return { alive: ageMs < STALE_AFTER_MS, lastTickSecondsAgo: Math.round(ageMs / 1000) };
    } catch {
      return { alive: false, lastTickSecondsAgo: null };
    }
  }
  ```

- [ ] **Step 3: Run log gains `organizationId`**

  Same pattern for `pushRunLogEvent`, `readRunLog`, `clearRunLog`: add `organizationId: string` as the new first parameter, resolve `const prisma = await getTenantPrisma(organizationId);` as the first line inside the `try`, leave everything else (the `runLogEvent.create`/`findMany`/`deleteMany` calls, the 5%-sampled trim) unchanged.

- [ ] **Step 4: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  git add lib/opsState.ts
  git commit -m "phase5: opsState — per-org rate limiter, heartbeat, and run log"
  ```

---

### Task 7: Workflow layer — thread `organizationId` through every step

This is the risk-carrying task (see Task 12 — do not deploy past this point without confirming zero in-flight runs). `Site`/`AuditRun`/etc. now live per-org, and a `runId` alone can't tell you which org's database to open, so `organizationId` must be an explicit argument from the moment a run starts, not derived later.

**Files:**
- Modify: `lib/workflows/auditRun.ts`
- Modify: `lib/workflows/finalize.ts`
- Modify: `lib/workflows/runControl.ts`
- Modify: `lib/workflows/planSweep.ts`

**Interfaces:**
- Produces:
  - `startAuditRun(runId: string, pairs: AuditPair[], organizationId: string): Promise<void>` — **signature changed**, every caller updated in Tasks 8–10.
  - `auditRunWorkflow(runId, pairs, batchSize, organizationId): Promise<void>` — the actual `'use workflow'` function; its persisted-argument shape changes, which is the reason for the Task 12 hold point.
  - `finalizeAndNotify(organizationId: string, runId: string): Promise<void>` — **signature changed**, callers: `auditRun.ts` (this task) and any Server Action that calls it directly (none currently do — confirm with a repo-wide grep for `finalizeAndNotify` before closing this task).
  - `workflowRunQueue(organizationId: string, runId: string)` — **signature changed**, caller updated in Task 10 (`app/actions/runControl.ts`).
  - `planAndStartSweep(organizationId: string, siteId: string, triggeredBy): Promise<void>` — **signature changed**, caller updated in Task 8 (cron route).

- [ ] **Step 1: `lib/workflows/auditRun.ts` — widen every step and the workflow function itself**

  ```ts
  // was:
  import { prisma } from '../db.ts';
  // now:
  import { getTenantPrisma } from '../db/tenant.ts';
  import { d1CredentialsForOrg } from '../services/org.service.ts';
  ```

  `auditOnePageStep` gains `organizationId` and resolves the tenant client AND this org's D1 credentials once at the top, threading both into every call that used the module-level `prisma` or touched raw JSON:
  ```ts
  async function auditOnePageStep(
    organizationId: string,
    runId: string,
    pageId: string,
    url: string,
    strategy: PsiStrategy,
  ): Promise<void> {
    'use step';
    const log = jobLogger(runId, pageId, strategy);
    const maxAttempts = getEnv().PSI_MAX_ATTEMPTS;
    const prisma = await getTenantPrisma(organizationId);
    const d1 = (await d1CredentialsForOrg(organizationId)) ?? undefined;

    await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'start', pageId, url, strategy });

    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await auditPage(
          { prisma, limiter: await getPsiRateLimiter(organizationId), organizationId, d1 },
          { runId, pageId, url, strategy },
        );
        if (!outcome.written) {
          log.info('replay — result already recorded, counter untouched');
          return;
        }
        await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'ok', pageId, url, strategy });
        if (outcome.readyToFinalize) await finalizeAndNotify(organizationId, runId);
        return;
      } catch (e) {
        // ... every branch below is unchanged except:
        //   - pushRunLogEvent(organizationId, runId, {...}) instead of pushRunLogEvent(runId, {...})
        //   - recordAuditResult(prisma, {...}, d1) — d1 as the new third arg (Task 4 Step 1);
        //     harmless here since both branches pass rawJson: null, but kept for consistency
        //   - finalizeAndNotify(organizationId, runId) instead of finalizeAndNotify(runId)
      }
    }
  }
  ```
  Apply the same substitutions (`pushRunLogEvent` gains `organizationId` as its new first arg, `recordAuditResult` gains `d1` as its new third arg, `finalizeAndNotify` gains `organizationId` as its new first arg, the module-level `prisma` becomes the locally-resolved tenant client) to both the `PermanentError` branch and the exhausted-retries branch inside the existing `catch` block — the rest of each branch's logic (the comments, the log calls, the `errorResultFor`/`buildMarkdownReport` calls) is unchanged.

  `readRunStatusStep` and `reconcileIfNeededStep` both gain `organizationId`:
  ```ts
  async function readRunStatusStep(organizationId: string, runId: string): Promise<string | null> {
    'use step';
    const prisma = await getTenantPrisma(organizationId);
    const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
    return run?.status ?? null;
  }

  async function reconcileIfNeededStep(organizationId: string, runId: string): Promise<void> {
    'use step';
    const prisma = await getTenantPrisma(organizationId);
    const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (run && (run.status === 'running' || run.status === 'queued')) {
      await finalizeAndNotify(organizationId, runId);
    }
  }
  ```

  `auditRunWorkflow` gains `organizationId` as its fourth parameter and passes it into every step call:
  ```ts
  export async function auditRunWorkflow(
    runId: string,
    pairs: AuditPair[],
    batchSize: number,
    organizationId: string,
  ): Promise<void> {
    'use workflow';

    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map((p) => auditOnePageStep(organizationId, runId, p.pageId, p.url, p.strategy)),
      );

      let status = await readRunStatusStep(organizationId, runId);
      if (status !== 'running' && status !== 'paused') return;

      while (status === 'paused') {
        await sleep('20s');
        status = await readRunStatusStep(organizationId, runId);
        if (status !== 'running' && status !== 'paused') return;
      }
    }

    await reconcileIfNeededStep(organizationId, runId);
  }

  export async function startAuditRun(runId: string, pairs: AuditPair[], organizationId: string): Promise<void> {
    const batchSize = getEnv().WORKER_CONCURRENCY;
    await start(auditRunWorkflow, [runId, pairs, batchSize, organizationId]);
  }
  ```

- [ ] **Step 2: `lib/workflows/finalize.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  import { d1CredentialsForOrg } from '../services/org.service.ts';
  // ...
  export async function finalizeAndNotify(organizationId: string, runId: string): Promise<void> {
    const log = runLogger(runId);
    const prisma = await getTenantPrisma(organizationId);

    const status = await finalizeRun(prisma, runId);
    log.info({ status }, 'run finalized');

    const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { type: true, siteId: true } });
    if (!run) return;

    await clearRunLog(organizationId, runId);

    try {
      const d1 = (await d1CredentialsForOrg(organizationId)) ?? undefined;
      const pruned = await pruneSiteHistory(prisma, run.siteId, d1);
      if (pruned.resultsDeleted > 0) log.info({ ...pruned }, 'aged-out history removed');
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'history prune failed');
    }

    if (run.type !== 'full_sweep') return;
    if (status !== 'completed' && status !== 'failed') return;

    try {
      const summary = await buildSweepSummary(
        organizationId,
        runId,
        status === 'failed' ? 'sweep.failed' : 'sweep.completed',
        getEnv().APP_URL,
      );
      if (summary) await dispatchSweepNotification(organizationId, run.siteId, summary);
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'sweep notification failed');
    }
  }
  ```

- [ ] **Step 3: `lib/workflows/runControl.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  // ...
  export function workflowRunQueue(organizationId: string, runId: string) {
    const batchSize = getEnv().WORKER_CONCURRENCY;

    async function remaining(): Promise<number> {
      const prisma = await getTenantPrisma(organizationId);
      const run = await prisma.auditRun.findUnique({
        where: { id: runId },
        select: { totalJobs: true, completedJobs: true },
      });
      if (!run) return 0;
      return Math.max(0, run.totalJobs - run.completedJobs);
    }

    return {
      pause: async () => {},
      resume: async () => {},
      drain: async () => {},
      getActiveCount: async () => Math.min(batchSize, await remaining()),
      getWaitingCount: async () => Math.max(0, (await remaining()) - batchSize),
      getDelayedCount: async () => 0,
    };
  }
  ```

- [ ] **Step 4: `lib/workflows/planSweep.ts`**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  // ...
  export async function planAndStartSweep(
    organizationId: string,
    siteId: string,
    triggeredBy: 'schedule' | 'manual',
  ): Promise<void> {
    const scope = { kind: 'site' as const, ref: null, strategies: BOTH_STRATEGIES };
    const prisma = await getTenantPrisma(organizationId);

    const active = await findActiveRun(prisma, siteId);
    if (active) {
      const skippedId = await createSkippedRun(
        prisma,
        { siteId, type: 'full_sweep', triggeredBy, scope },
        `another ${active.type} run (${active.id}) was still active`,
      );
      logger.warn({ skippedId, blockedBy: active }, 'sweep skipped — another run is active');
      return;
    }

    const pairs = await expandScope(prisma, siteId, scope);
    if (pairs.length === 0) {
      logger.warn({ siteId }, 'sweep planned with no active pages — nothing to do');
      return;
    }

    const runId = await createRun(prisma, { siteId, type: 'full_sweep', triggeredBy, scope, totalJobs: pairs.length });

    await startAuditRun(runId, pairs, organizationId);
    logger.info({ runId, queued: pairs.length }, 'sweep planned');
  }
  ```

- [ ] **Step 5: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  npm run lint
  npm test
  git add lib/workflows
  git commit -m "phase5: workflow layer — thread organizationId through every step (breaking: in-flight runs cannot resume across this deploy, see Task 12)"
  ```

---

### Task 8: Cron route — fan out across every provisioned org

`Schedule` now lives per-tenant, so "what's due right now" can no longer be one query against one database. The route must first ask the central database which orgs are provisioned, then check each org's own tenant database.

**Files:**
- Modify: `app/api/cron/schedule-tick/route.ts`

**Interfaces:**
- Consumes: `centralPrisma` (Task 1), `withTenantPrisma` (already built, `lib/db/tenant.ts`), `reconcileStaleRuns` (Task 4, unchanged signature — pass the org's tenant client), `dueSchedules`/`advanceSchedule` (Task 5, now org-scoped), `planAndStartSweep` (Task 7, now takes `organizationId` first), `stampSchedulerHeartbeat`/`schedulerHealth` (Task 6, now per-org).

- [ ] **Step 1: Rewrite the route to loop over ready orgs**
  ```ts
  import { NextResponse } from 'next/server';
  import { centralPrisma } from '@/lib/db/central';
  import { withTenantPrisma } from '@/lib/db/tenant';
  import { logger } from '@/lib/logger';
  import { reconcileStaleRuns } from '@/lib/services/run.service';
  import { dueSchedules, advanceSchedule } from '@/lib/services/schedule.service';
  import { startAuditRun } from '@/lib/workflows/auditRun';
  import { planAndStartSweep } from '@/lib/workflows/planSweep';
  import { stampSchedulerHeartbeat } from '@/lib/opsState';

  export const dynamic = 'force-dynamic';
  export const maxDuration = 60;

  export async function GET(request: Request): Promise<Response> {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const readyOrgs = await centralPrisma.organization.findMany({
      where: { provisionStatus: 'ready' },
      select: { id: true },
    });

    let totalReconciled = { resumed: [] as string[], failed: [] as string[] };
    let sweepsStarted = 0;

    for (const { id: organizationId } of readyOrgs) {
      try {
        await stampSchedulerHeartbeat(organizationId);

        const reconciled = await withTenantPrisma(organizationId, (prisma) =>
          reconcileStaleRuns(prisma, (runId, pairs) => startAuditRun(runId, pairs, organizationId)),
        );
        if (reconciled.resumed.length > 0 || reconciled.failed.length > 0) {
          logger.info({ organizationId, ...reconciled }, 'stale runs reconciled at cron tick');
        }
        totalReconciled = {
          resumed: [...totalReconciled.resumed, ...reconciled.resumed],
          failed: [...totalReconciled.failed, ...reconciled.failed],
        };

        const due = await dueSchedules(organizationId);
        for (const s of due) {
          if (!s.cronExpr) continue;
          await advanceSchedule(organizationId, s.id, s.cronExpr, s.timezone);
          await planAndStartSweep(organizationId, s.siteId, 'schedule');
          logger.info({ organizationId, siteId: s.siteId, cron: s.cronExpr }, 'scheduled sweep queued');
          sweepsStarted++;
        }
      } catch (e) {
        // One org's tenant database being unreachable (revoked credential,
        // Neon outage) must not stop the tick for every other org.
        logger.error({ organizationId, err: e instanceof Error ? e.message : String(e) }, 'cron tick failed for org');
      }
    }

    return NextResponse.json({ ok: true, reconciled: totalReconciled, sweepsStarted });
  }
  ```

- [ ] **Step 2: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  git add app/api/cron/schedule-tick/route.ts
  git commit -m "phase5: cron tick fans out across every provisioned org via withTenantPrisma"
  ```

---

### Task 9: MCP server and auth — resolve the tenant client per token

`lib/mcp/auth.ts` is already central-only (Task 2). `lib/mcp/server.ts` resolves `organizationId` from the verified bearer token via `orgIdOf(ctx)` — every tool already does this before touching data — so this task only swaps the module-level `prisma` for a resolved tenant client and updates the now-changed service-function calls from Task 5/7.

**Files:**
- Modify: `lib/mcp/server.ts`

**Interfaces:**
- Consumes: `getTenantPrisma`, and the Task 5/7 signatures for `listGroupsWithAggregates`, `getPageReport`, `getScoreHistory`, `getTopIssues`, `getOrCreateRecommendation`, `getRunProgress`, `estimateRun`, `startAuditRun`.

- [ ] **Step 1: Swap the import, add a per-call tenant client**
  ```ts
  // was: import { prisma } from '../db.ts';
  import { getTenantPrisma } from '../db/tenant.ts';
  ```

- [ ] **Step 2: `siteId(ctx)` and `findPage(url, ctx)` resolve the tenant client**
  ```ts
  async function siteId(ctx: unknown): Promise<string> {
    const organizationId = orgIdOf(ctx);
    const prisma = await getTenantPrisma(organizationId);
    const site = await prisma.site.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!site) throw new Error('No site is configured for this organisation yet.');
    return site.id;
  }

  async function findPage(url: string, ctx: unknown) {
    const organizationId = orgIdOf(ctx);
    const prisma = await getTenantPrisma(organizationId);
    const site = await prisma.site.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, baseUrl: true },
    });
    if (!site) throw new Error('No site is configured for this organisation yet.');
    const norm = normalizeUrl(url, site.baseUrl);
    const candidates = norm.ok ? [norm.url, url] : [url];

    const page = await prisma.page.findFirst({
      where: { siteId: site.id, url: { in: candidates } },
      select: { id: true, url: true, path: true },
    });
    if (page) return page;

    const near = await prisma.page.findMany({
      where: { siteId: site.id, path: { contains: norm.ok ? norm.path.split('/').filter(Boolean).pop() ?? '' : '' } },
      select: { url: true },
      take: 3,
    });
    throw new Error(
      `No page matches ${url}.` + (near.length ? ` Closest: ${near.map((n) => n.url).join(', ')}` : ''),
    );
  }
  ```

- [ ] **Step 3: Every tool handler passes `orgIdOf(ctx)` into the now-org-scoped service calls**

  For each `server.registerTool(...)` handler, resolve `const organizationId = orgIdOf(ctx);` once at the top and pass it as the new first argument everywhere Task 5/7 added one. Concretely, in each handler:
  - `list_groups`: `listGroupsWithAggregates(organizationId, await siteId(ctx), { strategy })`
  - `list_pages`: the inline `prisma.group.findFirst` needs `const prisma = await getTenantPrisma(organizationId);` resolved in the handler; `listPagesInGroup(organizationId, g.id, ...)` and `listGroupsWithAggregates(organizationId, sid, ...)`.
  - `get_report`: `getPageReport(organizationId, page.id, strategy)`.
  - `get_trend`: `getScoreHistory(organizationId, { pageId: page.id }, ...)` / `getScoreHistory(organizationId, { groupId: g.id }, ...)`; the inline `prisma.group.findFirstOrThrow` needs the resolved tenant client too.
  - `top_issues`: `getTopIssues(organizationId, { siteId: await siteId(ctx), strategy, limit })`.
  - `get_recommendation`: `getOrCreateRecommendation(organizationId, page.id, strategy, { force: refresh })`.
  - `run_page_audit` / `run_group_audit`: resolve `const prisma = await getTenantPrisma(organizationId);` once, pass it to `findActiveRun(prisma, sid)`/`expandScope(prisma, sid, scope)`/`createRun(prisma, {...})` (Task 4 — unchanged signatures, just the right client), and `startAuditRun(runId, pairs, organizationId)` (Task 7's new signature). `estimateRun(organizationId, pairs.length, sid)`.
  - `get_run_status`: `getRunProgress(organizationId, runId)` after the existing `requireRunAccess(orgIdOf(ctx), runId)` call (Task 3 — already correct, no change needed there).

- [ ] **Step 4: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  git add lib/mcp/server.ts
  git commit -m "phase5: MCP server resolves each org's own tenant client from its bearer token"
  ```

---

### Task 10: Server Actions — thread `ctx.organizationId` into every call

Every Server Action already calls `requireCapability()`/`requireSession()` first and has `ctx.organizationId` in scope before touching any data — this task is purely plumbing that value into the now-changed function calls from Tasks 3–7.

**Files:**
- Modify: `app/actions/audits.ts`
- Modify: `app/actions/estimate.ts`
- Modify: `app/actions/groups.ts`
- Modify: `app/actions/recommendation.ts`
- Modify: `app/actions/runControl.ts`
- Modify: `app/actions/settings.ts`
- Modify: `app/actions/site.ts`

- [ ] **Step 1: `app/actions/audits.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  In `queueAuditAction`, `retryFailedAction`, `failedResultsAction`: resolve `const prisma = await getTenantPrisma(ctx.organizationId);` right after `ctx` is obtained, and update every call that gained a leading `organizationId` param:
  - `startAuditRun(runId, pairs, ctx.organizationId)` (both call sites)
  - `estimateRun(ctx.organizationId, pairs.length, site.id)` (both call sites)
  - `failedResultsForRun(prisma, input.runId)` — unchanged signature (Task 4), just pass the resolved tenant `prisma`.
  - `findActiveRun(prisma, site.id)`, `expandScope(prisma, site.id, scope)`, `createRun(prisma, {...})` — same, unchanged signatures, resolved tenant client.

- [ ] **Step 2: `app/actions/estimate.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  Resolve `const prisma = await getTenantPrisma(ctx.organizationId);` after `const ctx = await requireCapability('reports:read');`, update the `prisma.page.count` call to use it, and `estimateRun(ctx.organizationId, pageCount * strategies)`.

- [ ] **Step 3: `app/actions/groups.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  Resolve `const prisma = await getTenantPrisma(ctx.organizationId);` in each of the three actions right after `ctx` is obtained; the `where: { site: { organizationId: ctx.organizationId } }` filters can stay as-is (redundant-but-harmless, per Task 3 Step 2's note) or be simplified — leave them, do not change query shape beyond the client swap.

- [ ] **Step 4: `app/actions/recommendation.ts`**

  No direct `prisma` import here — only the Task 5 function calls need the new arg:
  - `generateRecommendationAction`: `getOrCreateRecommendation(ctx.organizationId, input.pageId, input.strategy, { force: input.force })`.
  - `recommendationHistoryAction`: `listRecommendations(ctx.organizationId, input.pageId, input.strategy)`.

- [ ] **Step 5: `app/actions/runControl.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  ```ts
  const ctx = await requireCapability('audits:run');
  await requireRunAccess(ctx.organizationId, input.runId);
  const prisma = await getTenantPrisma(ctx.organizationId);
  const r = await controlRun(prisma, input.runId, input.action, workflowRunQueue(ctx.organizationId, input.runId));
  ```

- [ ] **Step 6: `app/actions/settings.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  Resolve the tenant client after each action's `ctx`/`site` lookup; `saveScheduleAction` calls `saveSchedule(ctx.organizationId, site.id, {...})`; the notification-test action's `dispatchSweepNotification(ctx.organizationId, site.id, {...})` call gains the new first arg; `prisma.notificationSetting.*`/`prisma.auditResult.findMany` calls use the resolved tenant client.

- [ ] **Step 7: `app/actions/site.ts`** (the mixed file — both clients needed)
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  import { centralPrisma } from '@/lib/db/central';
  import { d1CredentialsForOrg } from '@/lib/services/org.service';
  ```
  `Site`/`Schedule`/`NotificationSetting` calls (`prisma.site.create`, `prisma.schedule.create`, `prisma.notificationSetting.create`, `prisma.site.update` ×2) resolve `const prisma = await getTenantPrisma(ctx.organizationId);` and use it. The SMTP-override action's `prisma.organization.update`/`prisma.organization.findUnique` calls become `centralPrisma.organization.*` — no tenant client needed there at all, since `Organization` is central. The history-deletion action's call site (line 213, `deleteRuns(prisma, siteId, runIds)`) gains the `d1` argument Task 4 Step 3 added:
  ```ts
  const d1 = (await d1CredentialsForOrg(ctx.organizationId)) ?? undefined;
  const { runsDeleted, resultsDeleted } = await deleteRuns(prisma, siteId, runIds, d1);
  ```

- [ ] **Step 8: Verify and commit**
  ```bash
  npx tsc --noEmit 2>&1 | grep -c "error TS"
  npm run lint
  npm test
  git add app/actions
  git commit -m "phase5: Server Actions thread ctx.organizationId into tenant-scoped service calls"
  ```

---

### Task 11: Remaining pages and API routes

**Files:**
- Modify: `app/(dash)/settings/automation/page.tsx`
- Modify: `app/(dash)/settings/notifications/page.tsx`
- Modify: `app/(dash)/settings/site/page.tsx`
- Modify: `app/(dash)/page.tsx`
- Modify: `app/api/reports/bulk/route.ts`
- Modify: `app/api/runs/active/route.ts`
- Modify: `app/api/runs/[runId]/progress/route.ts`

- [ ] **Step 1: `app/(dash)/settings/automation/page.tsx`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  Resolve `const prisma = await getTenantPrisma(ctx.organizationId);` after `const ctx = await requireSession();`, update `prisma.schedule.findUnique`/`prisma.auditRun.findMany`, and `estimateRun(ctx.organizationId, activePages * 2, site.id)`.

- [ ] **Step 2: `app/(dash)/settings/notifications/page.tsx`**

  Same pattern: resolve tenant client for `prisma.notificationSetting.findUnique`. `orgEmailRef(ctx.organizationId)` is unchanged (Task 3 — already central-only, no signature change).

- [ ] **Step 3: `app/(dash)/settings/site/page.tsx`**

  This one's `prisma` import is used for... check the file directly, since only `listSites`/`orgEmailRef` calls were visible in this plan's research (both already correctly signatured from Task 3) plus `estimateRun(ctx.organizationId, pageCount * 2, site.id)` (Task 5's new signature). If a direct `prisma.*` call exists beyond those, resolve the tenant client the same way as Steps 1–2.

- [ ] **Step 4: `app/(dash)/page.tsx`**

  `getSiteSummary(ctx.organizationId, site.id, strategy)` and `getTopIssues(ctx.organizationId, { siteId: site.id, strategy, limit: 8 })` — both gained a leading `organizationId` in Task 5; this file has no direct `prisma` import to change, only these two call sites.

- [ ] **Step 5: `app/api/reports/bulk/route.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  Resolve `const prisma = await getTenantPrisma(session.organizationId);` and update the `prisma.page.findMany` call.

- [ ] **Step 6: `app/api/runs/active/route.ts`**
  ```ts
  // was: import { prisma } from '@/lib/db';
  import { getTenantPrisma } from '@/lib/db/tenant';
  ```
  ```ts
  const prisma = await getTenantPrisma(session.organizationId);
  const runs = await prisma.auditRun.findMany({
    where: {
      status: { in: ['queued', 'running', 'paused'] },
      site: { organizationId: session.organizationId },
    },
    // ...unchanged...
  });
  const seed = runs.length > 0 ? (await estimateRun(session.organizationId, 1)).throughputPerSecond : undefined;
  ```

- [ ] **Step 7: `app/api/runs/[runId]/progress/route.ts`**

  No direct `prisma` import — only `getRunProgress(session.organizationId, runId)` (Task 5's new signature), called after the existing `requireRunAccess(session.organizationId, runId)` check.

- [ ] **Step 8: Verify and commit**
  ```bash
  npx tsc --noEmit
  ```
  Expect **zero** remaining errors at this point — every file the rename forced into view (Task 1's Step 6 count) should now be accounted for. If any remain, they're a file this plan's research missed; read it, classify it as central/tenant/mixed using the same rules as Tasks 2–5, and fix it before proceeding — do not suppress the error.
  ```bash
  npm run lint
  npm test
  git add "app/(dash)" app/api
  git commit -m "phase5: remaining pages and API routes — resolve tenant client per request"
  ```

---

### Task 12: Pre-deploy hold point — confirm no in-flight runs

**This is a manual operational check, not a code change. Do not skip it, and do not merge/deploy Task 7 onward until it passes.** A workflow already `queued`/`running`/`paused` when this deploys was started with `auditRunWorkflow`'s OLD 3-argument signature; Vercel Workflow will try to resume it with the NEW 4-argument version and fail — or worse, resume with a mismatched argument (e.g. a stray `batchSize` read as `organizationId`).

- [ ] **Step 1: Query production for anything in flight**

  Since `DATABASE_URL` can't be pulled locally for this project (see `CLAUDE.md`'s environment gotchas), run this from wherever the production `DATABASE_URL` is actually reachable — a `tsx` script invoked from a Vercel deployment shell, or `psql` against the Neon console directly:
  ```sql
  SELECT id, "siteId", type, status, "startedAt" FROM "AuditRun" WHERE status IN ('queued', 'running', 'paused');
  ```

- [ ] **Step 2: If anything is returned, wait**

  A `full_sweep` takes roughly 35 minutes end to end (measured, `docs/BUILD_LOG.md`). Either wait for it to reach a terminal status, or — if it must stop now — use the existing `controlRunAction`/`controlRun` stop path (sets `status: 'cancelled'`, which is terminal) before merging. Do not force-fail it any other way; `cancelled` is the state `finalizeRun` already treats as terminal (docs/DECISIONS.md, the run-control entry), and a run that failed to resume mid-flight because of this deploy would look like an unrelated bug to whoever finds it later.

- [ ] **Step 3: Re-check immediately before merging**

  The query in Step 1 is cheap; re-run it right before the merge/deploy that ships Task 7, since time will have passed since Step 1 and someone could have started a manual audit in between. Record the empty result in this session's `docs/BUILD_LOG.md` entry (Task 13) as the evidence this was actually checked, not assumed.

---

### Task 13: Full verification, and the docs update

**Files:**
- Modify: `docs/BUILD_LOG.md`
- Modify: `docs/PER_TENANT_ARCHITECTURE.md`
- Modify: `docs/IMPLEMENTATION_PLAN.md` (if it has a per-tenant status row)

- [ ] **Step 1: Full verification sweep**
  ```bash
  npx tsc --noEmit
  npm run lint
  npm test
  npm run build
  ```
  All four must be clean. `npm run build` matters specifically here: it runs `prisma generate` for the central schema (now at `prisma/central/schema.prisma`), `prisma generate --config prisma/tenant/prisma.config.ts` for the tenant schema, `prisma migrate deploy` (must resolve against the moved `prisma/central/migrations/`), and Workflow's own compile step — the one place that would catch a `'use step'`/`'use workflow'` function whose new signature the Workflow SDK's own build tooling rejects.

- [ ] **Step 2: Real end-to-end verification against one real provisioned org**

  Following this project's established convention (`docs/BUILD_LOG.md`'s Phase 4 entry, `test/blob.test.ts`'s own history) of verifying anything that needs a live external service directly rather than faking it in the standard suite: provision one throwaway org's real Neon + D1 credentials through Settings → Database (already built, Phase 4), then, signed in as that org:
  - Add a site, store a PSI key, ingest a small sitemap.
  - Run a page audit end to end and confirm it queries the tenant database, not the shared one — most direct check: the row shows up in the *tenant* Neon database, not the app's original shared one.
  - Confirm the raw JSON lands in that org's own D1 database (this is what the D1 table-creation fix earlier this session made possible, and what Task 4/5/7/10's `d1CredentialsForOrg` threading actually routes to it — without either, this step fails, the first with "no such table", the second by silently writing to the shared env D1 instead).
  - Trigger the cron route manually (`curl` with the real `CRON_SECRET`) and confirm it processes this org without touching any other org's data.
  - Sign in as a second org and confirm zero visibility into the first org's data (mirrors `npm run verify:tenants`' existing checks, now against genuinely separate databases instead of row-level `organizationId` filtering within one shared database).

  **Verify against a real Vercel preview deployment, not just `next dev`** — `docs/RESUME_HERE.md`'s standing gotcha about Workflow's flaky local transport applies with extra force here, since this phase's riskiest change (Task 7) is entirely inside `lib/workflows/*`.

- [ ] **Step 3: Update `docs/PER_TENANT_ARCHITECTURE.md`'s status table**

  Flip "Every other page/action/workflow using the org's own database" from ❌ to ✅, with a one-line pointer to this plan file and the BUILD_LOG entry from Step 4.

- [ ] **Step 4: Append the BUILD_LOG session entry**

  Record: the task-by-task summary, the real verification from Step 2 (with actual output/observations, not "should work"), the Task 12 in-flight-run check result, and what's explicitly still open for Phase 6 (dropping the old shared tables, removing the `CLOUDFLARE_*` env fallback in `lib/blob.ts` — deliberately not touched by this plan).

- [ ] **Step 5: Commit**
  ```bash
  git add docs/BUILD_LOG.md docs/PER_TENANT_ARCHITECTURE.md docs/IMPLEMENTATION_PLAN.md
  git commit -m "phase5: docs — mark the cutover complete, note what's left for phase 6"
  ```

---

## Self-review notes (for whoever executes this plan)

- **Task ordering matters for the compile-error count, not for correctness.** Tasks 2–6 can be reordered or parallelized (independent files); Task 7 depends on Tasks 3–6 being done (it calls `psiKeyForSite`, `getPsiRateLimiter`, `pushRunLogEvent`, `finalizeAndNotify`'s dependencies); Tasks 8–11 depend on Task 7's new `startAuditRun`/`planAndStartSweep`/`workflowRunQueue` signatures. Task 12 must happen before Task 7's commit is deployed (not before it's written) — the code can sit on a branch indefinitely; only the deploy is time-sensitive.
- **If `npx tsc --noEmit`'s error count doesn't reach zero by Task 11**, do not proceed to Task 12/13 — find and fix the remaining files using the same central/tenant/mixed classification rule this plan used (grep the file for which Prisma models it touches, cross-reference against the tenant-schema model list in `prisma/tenant/schema.prisma`).
- **Nothing in this plan changes what a query filters on or how a score is computed.** Every step is "which client" plus "how does this function learn which org it's for," never "what does this function do." If executing this plan surfaces a spot where that line blurs (e.g., a query that was implicitly cross-org and needs a real design decision), stop and flag it rather than deciding unilaterally — that's exactly the kind of thing Task 12's caution is protecting against being rushed.
