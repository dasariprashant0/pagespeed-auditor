export const meta = {
  name: 'psa-stages-5-8',
  description: 'Build the queue, dashboard read services, and auth in parallel lanes; verify each adversarially; then integrate',
  phases: [
    { title: 'Build', detail: 'three disjoint lanes: queue/worker, read services, auth' },
    { title: 'Verify', detail: 'adversarial review of each lane against its invariants' },
    { title: 'Integrate', detail: 'typecheck, lint, tests, and cross-lane fixes' },
  ],
}

const SHARED = `
# Project context (you have no prior conversation — read this carefully)

Repo: /Users/prashantdasari/ShipStudio/pagespeed-auditor
An internal tool that audits every page of www.zuddl.com via the Google
PageSpeed Insights API on mobile and desktop, stores every run as history, and
shows it in a dashboard modelled on pagespeed.web.dev.

## READ THESE FIRST (they are the source of truth, not your assumptions)
- docs/PLAN.md      — the approved plan: architecture, schema reasoning, verification
- docs/DECISIONS.md — WHY things are this way and what was rejected. Read before deviating.
- docs/BUILD_LOG.md — what is already built (M0–M4 are complete)
- prisma/schema.prisma — the data model, with every spec deviation commented "SPEC+"
- lib/services/types.ts — SHARED DTOs. Import from here. Do NOT define your own
  variants of these shapes; they were centralised precisely to stop drift.

## Already built and working — reuse, do not reimplement
- lib/psi/types.ts, buckets.ts, extract.ts, prune.ts, client.ts, rateLimiter.ts
- lib/report/format.ts, aiSection.ts, markdown.ts
- lib/sitemap/normalize.ts, fetch.ts, group.ts
- lib/services/ingest.service.ts, group.service.ts
- lib/db.ts (exports \`prisma\` and AUDIT_RESULT_SUMMARY_SELECT), lib/env.ts (getEnv()),
  lib/logger.ts, lib/errors.ts, lib/queue/connection.ts (createRedis)
- 96 tests pass: \`npm test\` (node --test with native TS stripping; no jest/vitest)
- Postgres + Redis are RUNNING via docker-compose.dev.yml. The DB has 747 real
  pages and 68 groups already ingested. DATABASE_URL and REDIS_URL are in .env.

## HARD RULES — violating these breaks the build
1. **Framework-free zone.** Nothing under lib/services, lib/psi, lib/queue,
   lib/report, lib/sitemap may import next/*, react, or server-only. The worker
   is a bare Node process importing these directly. ESLint enforces it.
2. **No @/ path alias inside lib/.** Use relative imports WITH the .ts extension
   (e.g. \`import { prisma } from '../db.ts'\`). Node's native type-stripping does
   not resolve the alias, so tests and the worker would fail. ESLint enforces it.
   app/ and components/ DO use @/ normally.
3. **AuditResult contains error rows** (status:'error', null scores) so a failed
   job still lets a run finalize. EVERY average, trend, and aggregate query MUST
   filter status:'ok' or the numbers are silently wrong.
4. **Never write TBT into the inp column.** INP is field-only; lab runs never
   produce it. tbt has its own column.
5. **Never SELECT * on AuditResult** — it carries a large pruned rawJson blob.
   Use AUDIT_RESULT_SUMMARY_SELECT from lib/db.ts, or an explicit select.
6. **Do NOT modify** package.json, tsconfig.json, eslint.config.mjs,
   prisma/schema.prisma, .env, or any file outside your assigned list. Other
   agents are working in this repo AT THE SAME TIME on different directories.
   If you believe a shared file must change, say so in your report instead.
7. Match the existing code's style: purposeful comments that explain WHY
   (especially for non-obvious decisions), no comment restating what the code does.

## Verification you must run before reporting done
\`npx tsc --noEmit\` and \`npx eslint <your files>\`. Because other agents are
writing concurrently, you may see transient errors in files that are not yours —
IGNORE those and fix only errors in your own files. Report honestly: if
something does not work, say so plainly rather than claiming success.
`

const LANES = [
  {
    key: 'queue',
    label: 'M5 queue + worker',
    files: 'lib/queue/{names,jobs,queues,producers,worker}.ts, lib/queue/processors/*.ts, lib/services/audit.service.ts, lib/services/run.service.ts, test/queue.test.ts',
    prompt: `
## YOUR LANE: M5 — the BullMQ queue, worker, and audit write path

Own ONLY these files (create them):
  lib/queue/names.ts, lib/queue/jobs.ts, lib/queue/queues.ts, lib/queue/producers.ts,
  lib/queue/worker.ts, lib/queue/processors/auditPage.processor.ts,
  lib/queue/processors/planSweep.processor.ts, lib/queue/processors/finalizeRun.processor.ts,
  lib/services/audit.service.ts, lib/services/run.service.ts, test/queue.test.ts

Read docs/PLAN.md section "Queue, rate limiting, resumability" — it is precise
and its numbers are measured, not guessed. Key points you must implement exactly:

- Worker \`concurrency: 20\` (from env WORKER_CONCURRENCY), limiter 3 per 4000ms
  = 0.75 req/s, \`lockDuration\` 120000 (env QUEUE_LOCK_DURATION_MS) which MUST
  exceed PSI_TIMEOUT_MS of 90000. This was measured: at concurrency 4 the rate
  collapses to 0.225 req/s and a sweep goes from 48 to 148 minutes. Do not
  "optimise" these numbers.
- Every PSI call goes through the EXISTING Redis token bucket
  (lib/psi/rateLimiter.ts, class PsiRateLimiter) — BullMQ's own limiter only
  governs queued jobs, so a synchronous single-page audit would bypass it.
- Deterministic job ids: \`a:\${runId}:\${pageId}:\${strategy}\`.
- **Idempotency**: AuditResult has @@unique([auditRunId, pageId, strategy]). The
  result insert, the AuditIssue createMany, and the completedJobs increment must
  share ONE interactive transaction with \`{ timeout: 15000 }\`. On a P2002
  (use isUniqueViolation from lib/errors.ts) log and return WITHOUT incrementing
  — that is a replayed job, not a new result.
- **Failures still count**: an exhausted or permanent failure writes an error row
  (status:'error', runtimeError set, null scores) through the same path, plus
  failedJobs increment, so completedJobs can reach totalJobs and the run
  finalizes. A PSI 'content' failure kind (see lib/psi/client.ts) is also an
  error row, not a retry.
- On HTTP 429 call \`worker.rateLimit(retryAfterMs)\` and throw
  \`Worker.RateLimitError()\` so the WHOLE queue pauses without consuming an
  attempt. Retrying one job while 19 siblings keep hammering makes it worse.
  Permanent failures throw UnrecoverableError.
- Backoff: use the existing \`backoffMs\` from lib/psi/client.ts via a custom
  \`settings.backoffStrategy\`.
- **Finalize without FlowProducer** (2000 children is heavy and one permanently
  failed child fails the parent): the transaction's update returns the
  post-increment row; when completedJobs >= totalJobs, enqueue a finalize job
  with a deterministic jobId so two workers crossing the threshold create one job.
- **Resumability**: \`resumeRun(runId)\` re-enqueues only (page, strategy) pairs
  with no AuditResult for that run, and corrects completedJobs from the true row
  count. \`reconcileStaleRuns()\` at worker boot: runs stuck 'running' older than
  STALE_RUN_HOURS become 'failed', others resume.
- audit.service.ts: \`auditSinglePage(url, strategies)\` runs synchronously
  (still through the token bucket); \`auditGroup(slug)\` runs sync when
  pages*strategies < SYNC_GROUP_PAGE_LIMIT (env, 15) else enqueues and returns
  a runId. There must be NO function that triggers a full sweep on demand —
  sweeps are schedule-only by design (planSweep exists but is only called by the
  scheduler in a later milestone).
- The audit write path must: call PSI, extract via extractResult(), prune via
  pruneResponse() before storing rawJson, build the markdown via
  buildMarkdownReport(), write AuditIssue rows from the extracted audits, and
  set Page.lastAuditedAt + latestResultMobileId/latestResultDesktopId.

Tests (test/queue.test.ts): unit-test the pure parts — job id construction,
the finalize threshold logic, and resume's "which pairs are missing" query
shape. Do NOT write tests that need a live worker; integration is a later step.
`,
  },
  {
    key: 'read',
    label: 'M6 dashboard read services',
    files: 'lib/services/{results,issues,site,report}.service.ts, test/services.test.ts',
    prompt: `
## YOUR LANE: M6 — the read/query services the dashboard consumes

Own ONLY these files (create them):
  lib/services/results.service.ts, lib/services/issues.service.ts,
  lib/services/site.service.ts, lib/services/report.service.ts,
  test/services.test.ts

Return the DTOs already defined in lib/services/types.ts. Do not invent variants.

Implement:
- \`listGroupsWithAggregates(siteId, { strategy })\` -> GroupSummaryDTO[].
  The aggregate is the ARITHMETIC MEAN of the latest performance score across
  audited pages — NOT worst-page. This was decided deliberately; read
  docs/DECISIONS.md 2.6 before changing it. Also return worstPerformance +
  worstPageId and the pass/average/fail/unaudited distribution, because those
  are what stop the mean from hiding a catastrophic page.
- \`listPagesInGroup(groupId, { strategy })\` -> PageListItemDTO[]
- \`getPageReport(pageId, strategy)\` -> PageReportDTO (null result when never
  audited on that strategy — a normal state, not an error). previousScores comes
  from the prior successful result for (pageId, strategy).
- \`getTopIssues({ strategy, limit })\` -> TopIssueDTO[] — see below.
- \`getSiteSummary(siteId)\` -> SiteSummaryDTO
- \`getScoreHistory({pageId|groupId}, {strategy, limit})\` -> SparkPoint[]

**Performance requirements — these are the reason the schema looks like it does:**
- Top Issues MUST query the AuditIssue side table with a Prisma \`groupBy\`, never
  by scanning rawJson. Scope it to the most recent COMPLETED full_sweep run
  (AuditRun where type='full_sweep' AND status='completed' ORDER BY finishedAt
  DESC LIMIT 1) so it is one index range scan and a consistent snapshot. If no
  completed sweep exists, fall back to the most recent completed run of any type,
  and if there is none return []. Target under 50ms.
- "Latest result per page" should use Page.latestResultMobileId /
  latestResultDesktopId (denormalized pointers that already exist) rather than a
  correlated subquery per row. The list must stay fast at 747 pages.
- Filter \`status: 'ok'\` in every average/aggregate. Error rows have null scores
  and would silently corrupt the numbers.
- Never select rawJson in a list query.

Field data: AuditResult stores fieldSource/fieldOverall/fieldLcp/fieldInp/
fieldCls/fieldFcp/fieldTtfb as real columns plus a small fieldJson blob. Build
FieldDataDTO from the COLUMNS (the blob is only for the detail view's
distributions). fieldSource 'none' is a normal state meaning "not enough
real-user data" — never surface it as an error.

Tests (test/services.test.ts): the DB has 747 real pages but NO audit results
yet, so integration assertions on scores are not possible. Test the pure helper
logic you extract (mean/distribution computation, the small-group split at
SMALL_GROUP_THRESHOLD, ETA and percent calculations) as exported pure functions,
plus a smoke test that each service function runs against the live DB and returns
the right SHAPE with empty data. Keep DB tests resilient to an empty result set.
`,
  },
  {
    key: 'auth',
    label: 'M7 auth + login',
    files: 'lib/auth/*, lib/http/*, proxy.ts, app/(auth)/**, app/actions/auth.ts',
    prompt: `
## YOUR LANE: M7 — shared-password auth, session, and the login page

Own ONLY these files (create them):
  lib/auth/password.ts, lib/auth/session.ts, lib/http/session.ts,
  lib/http/auth-guard.ts, lib/http/respond.ts, proxy.ts,
  app/(auth)/layout.tsx, app/(auth)/login/page.tsx,
  components/auth/LoginForm.tsx, app/actions/auth.ts, test/auth.test.ts

Read docs/PLAN.md section "Auth (stage 2)" and docs/DECISIONS.md 2.9 first.

- **Next 16 uses \`proxy.ts\` at the repo root, NOT middleware.ts.** This is
  verified (next/dist/lib/constants.js defines PROXY_FILENAME='proxy'). Do not
  create middleware.ts.
- Session: stateless JWT in an httpOnly cookie via \`jose\` (HS256, already
  installed). jose is chosen specifically because it runs on the Edge runtime so
  proxy.ts can verify the session; jsonwebtoken cannot, and Prisma can't run
  there either.
- **proxy.ts must read process.env.SESSION_SECRET DIRECTLY** — importing
  lib/env.ts there pulls in Node built-ins and breaks the Edge runtime. It must
  import ONLY jose and next/server.
- proxy.ts behaviour: redirect HTML requests to /login?next=<path>; return
  401 JSON for /api/* (NOT an HTML redirect — that is what keeps API errors
  debuggable and, later, keeps MCP working since a 302 is not a valid JSON-RPC
  response). Exclude from the matcher: _next/static, _next/image, favicon.ico,
  /login, /api/auth/*, /api/mcp.
- **proxy.ts is a UX redirect layer, NOT the authorization boundary.** Server
  Actions are public HTTP endpoints reachable by a crafted POST regardless of the
  matcher. So \`requireSession()\` must be called as the FIRST statement of every
  Server Action, and in the dashboard layout. Make this obvious in the code.
- Password: bcryptjs cost 12, verifying against env AUTH_USERNAME /
  AUTH_PASSWORD_HASH. Note AUTH_PASSWORD_HASH may currently be EMPTY in .env —
  handle that by failing the login cleanly with a clear message telling the
  operator to run \`npm run hash-password\`, never by accepting an empty password.
- Hardening, all small and worth doing now: login rate limit (10 per 15 min per
  IP; use Redis INCR via lib/queue/connection.ts createRedis, falling back to an
  in-memory Map when Redis is unavailable); ALWAYS run a bcrypt compare even for
  an unknown username (against a dummy hash) so response time does not leak
  username validity; and an Origin check on non-GET /api/*.
- Login page: Server Component shell + a "use client" LoginForm using
  useActionState against the loginAction Server Action. Return a discriminated
  result \`{ok:true} | {ok:false, error}\`. Show a generic "Username or password is
  incorrect" — never reveal which was wrong. Preserve ?next= through the redirect.
- Style it with the existing Tailwind v4 tokens in app/globals.css (--background,
  --foreground, --muted, --accent) and the Space Grotesk / DM Sans fonts already
  wired in app/layout.tsx. Dense and plain — this is an internal tool, not a
  marketing page. Do NOT add a tailwind.config.js (Tailwind v4 is CSS-first).
- Accessibility matters here: real <label>s, aria-invalid + aria-describedby on
  error, role="alert" on the error message, and a visible focus ring.

Tests (test/auth.test.ts): password hash/verify round-trip, that an empty
configured hash never authenticates, JWT issue/verify round-trip, that an expired
or tampered token fails verification, and the rate limiter's counting logic.
Keep these pure — no Next runtime.
`,
  },
]

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'status', 'summary', 'filesWritten', 'issues'],
  properties: {
    lane: { type: 'string' },
    status: { type: 'string', enum: ['complete', 'partial', 'failed'] },
    summary: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'description'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          description: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
    needsSharedFileChange: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['lane', 'verdict', 'confirmedDefects'],
  properties: {
    lane: { type: 'string' },
    verdict: { type: 'string', enum: ['sound', 'defects-found'] },
    confirmedDefects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'description', 'failureScenario'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          description: { type: 'string' },
          failureScenario: { type: 'string' },
        },
      },
    },
  },
}

log(`Building ${LANES.length} lanes in parallel, each verified as it lands.`)

const results = await pipeline(
  LANES,

  // Stage 1: build the lane
  (lane) =>
    agent(SHARED + lane.prompt, {
      label: `build:${lane.key}`,
      phase: 'Build',
      schema: FINDINGS,
    }),

  // Stage 2: adversarially verify that same lane, as soon as it finishes
  (built, lane) => {
    if (!built) return null
    return agent(
      SHARED +
        `
## YOUR TASK: adversarially verify the "${lane.label}" lane

Another agent has just written these files: ${lane.files}

Its own report:
${JSON.stringify(built, null, 2)}

Your job is to REFUTE, not to admire. Read the actual code and hunt for defects
that would produce silently wrong behaviour. Default to reporting a defect only
when you can name a concrete failure scenario — inputs or state leading to a
wrong result. Do not report style preferences, and do not report things the
plan deliberately decided (check docs/DECISIONS.md before calling something wrong).

Check specifically, because these are the known silent-failure modes:
1. Does any aggregate/average query forget \`status: 'ok'\`? Error rows have null
   scores and would corrupt every number.
2. Is TBT ever written into the \`inp\` column, or compared against INP thresholds?
3. Does any list query select rawJson, or use Prisma's default select on
   AuditResult?
4. Do any files under lib/ import next/*, react, or use the \`@/\` alias?
   (Both break the bare-Node worker and the test runner.)
5. Is the completedJobs increment inside the same transaction as the result
   insert, and genuinely skipped on a P2002 replay? A double-count here makes a
   run finalize early.
6. Could a failed job leave completedJobs unable to reach totalJobs, hanging the
   run forever?
7. Is there any code path that triggers a full sweep on demand? There must not be.
8. In auth: is requireSession() actually called first in every Server Action?
   Does proxy.ts import anything beyond jose/next-server (Edge runtime limits)?
   Can an empty AUTH_PASSWORD_HASH ever authenticate?
9. Are there off-by-one or divide-by-zero risks in percent/ETA/mean calculations
   when counts are zero?

Run \`npx tsc --noEmit\` and \`npx eslint <the lane's files>\` yourself and read the
real output. Ignore errors originating in other lanes' files.

Report only defects you actually confirmed by reading the code.`,
      { label: `verify:${lane.key}`, phase: 'Verify', schema: VERDICT, effort: 'high' },
    )
  },
)

const built = results.map((r, i) => ({ lane: LANES[i].key, verdict: r })).filter((r) => r.verdict)
const allDefects = built.flatMap((b) => b.verdict?.confirmedDefects ?? [])
const blockers = allDefects.filter((d) => d.severity === 'blocker' || d.severity === 'major')

log(`Verification complete: ${allDefects.length} confirmed defect(s), ${blockers.length} blocking.`)

phase('Integrate')

const integration = await agent(
  SHARED +
    `
## YOUR TASK: integrate the three lanes and leave the repo green

Three agents have just built, in parallel:
  - M5 queue + worker (lib/queue/**, lib/services/audit.service.ts, run.service.ts)
  - M6 dashboard read services (lib/services/{results,issues,site,report}.service.ts)
  - M7 auth + login (lib/auth/**, lib/http/**, proxy.ts, app/(auth)/**, app/actions/auth.ts)

Confirmed defects from adversarial verification:
${JSON.stringify(allDefects, null, 2)}

Do this, in order:

1. Fix every blocker and major defect listed above. For minor ones, fix if cheap,
   otherwise leave and report.
2. Run \`npx tsc --noEmit\` and fix ALL type errors across the whole repo,
   including cross-lane mismatches (this is the first time the lanes have been
   typechecked together).
3. Run \`npx eslint .\` and fix all errors. \`.shipstudio/**\` is ignored already.
   Pay attention to the architecture-boundary rule — if a lib/ file imports
   next/* or uses \`@/\`, fix the import rather than weakening the rule.
4. Run \`npm test\` and fix failing tests. If a test encodes a WRONG expectation,
   fix the test and say so; if it caught a real bug, fix the code.
5. Resolve any duplicated helpers across lanes: if two lanes wrote the same
   utility, keep one and import it. Prefer moving it to a sensible shared module
   over leaving a copy.
6. Verify the boundary rule still bites: create lib/services/_probe.ts containing
   \`import 'next/headers';\`, confirm \`npx eslint lib/services/_probe.ts\` FAILS,
   then DELETE the probe file. Report the result.

You MAY modify any file to achieve this, including files the lane agents wrote.
Do NOT modify prisma/schema.prisma, .env, or package.json dependencies (you may
add a script if genuinely needed, and say so).

Report the final state honestly: exact pass/fail counts from tsc, eslint and
npm test as you actually observed them. If something is still broken, say what
and why rather than glossing over it.`,
  { label: 'integrate', phase: 'Integrate', effort: 'high' },
)

return {
  lanes: built.map((b) => ({ lane: b.lane, verdict: b.verdict?.verdict })),
  defectCount: allDefects.length,
  blockingCount: blockers.length,
  integration,
}
