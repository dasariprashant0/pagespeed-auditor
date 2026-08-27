import type { TenantPrismaClient } from '../db/tenant.ts';
import type { PsiStrategy } from '../psi/types.ts';
import type { RunProgressDTO, RunStatus } from './types.ts';
import { NotFoundError } from '../errors.ts';
import { logger } from '../logger.ts';
import { getEnv } from '../env.ts';

/**
 * One (page, strategy) unit of work.
 *
 * Defined here (not in lib/workflows/auditRun.ts) so this file stays a leaf
 * that lib/workflows/* depends on, never the other way -- auditRun.ts needs
 * finalizeRun() from this file, and importing AuditPair back from there would
 * make the two modules circular.
 */
export interface AuditPair {
  pageId: string;
  url: string;
  strategy: PsiStrategy;
}

/**
 * Starts (or restarts) audit dispatch for a run's pairs. Injected rather than
 * imported directly -- see the AuditPair comment above for why. The real
 * implementation is startAuditRun() in lib/workflows/auditRun.ts; passing an
 * empty pairs array is how a "resume found nothing missing" immediately
 * finalizes, since the workflow's own backstop does that when its batch loop
 * has nothing to do.
 */
export type AuditDispatcher = (runId: string, pairs: AuditPair[]) => Promise<void>;

/**
 * AuditRun lifecycle: create, progress accounting, finalize, resume.
 *
 * The invariant everything here protects: `completedJobs` counts EVERY job that
 * reached a terminal outcome, error rows included. If failures did not count, a
 * sweep containing one unmeasurable page would never reach totalJobs and would
 * sit at "running" forever.
 */

export const RUN_TYPES = ['full_sweep', 'group', 'page'] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const BOTH_STRATEGIES: PsiStrategy[] = ['mobile', 'desktop'];

// ---------------------------------------------------------------------------
// Scope encoding -- pure
// ---------------------------------------------------------------------------

/**
 * A run has to be resumable after Redis is lost, which means "which pages was
 * this run supposed to cover" must survive in Postgres. The schema has no scope
 * columns, so `scopeLabel` carries it in a format that is both machine-parseable
 * and readable in the runs list. format/parse are a matched pair -- change one
 * and resume silently re-audits the wrong set -- so they live next to each other
 * and are round-trip tested.
 */
export interface RunScope {
  /**
   * `retry` re-measures exactly the pages another run recorded an error for.
   * `pages` is a hand-picked set from a group's page list -- distinct from
   * `group` (that whole section) and `page` (exactly one).
   */
  kind: 'site' | 'group' | 'page' | 'pages' | 'retry';
  /** Group slug, page id, comma-joined page ids (`pages`), or -- for `retry` -- the run being retried. */
  ref: string | null;
  strategies: PsiStrategy[];
}

export function formatScopeLabel(scope: RunScope): string {
  const suffix = scope.strategies.length === 1 ? ` (${scope.strategies[0]})` : '';
  if (scope.kind === 'site') return `site${suffix}`;
  return `${scope.kind}:${scope.ref}${suffix}`;
}

export function parseScopeLabel(label: string | null | undefined): RunScope {
  const raw = (label ?? '').trim();

  const strategyMatch = /\((mobile|desktop)\)\s*$/.exec(raw);
  const strategies: PsiStrategy[] = strategyMatch
    ? [strategyMatch[1] as PsiStrategy]
    : [...BOTH_STRATEGIES];

  const head = raw.replace(/\s*\((mobile|desktop)\)\s*$/, '').trim();
  const sep = head.indexOf(':');

  if (sep > 0) {
    const kind = head.slice(0, sep);
    const ref = head.slice(sep + 1).trim();
    if ((kind === 'group' || kind === 'page' || kind === 'pages') && ref) return { kind, ref, strategies };
  }

  // Anything unrecognised -- including a hand-written label on an older run --
  // falls back to the whole site. That is the safe direction: resume then
  // re-checks every active page and re-enqueues only those with no result.
  return { kind: 'site', ref: null, strategies };
}

// ---------------------------------------------------------------------------
// Progress accounting -- pure
// ---------------------------------------------------------------------------

/**
 * Called with the row returned BY the increment, so the check reads a value no
 * other worker can have moved underneath it. `>=` rather than `===` because a
 * resume can legitimately correct totalJobs downward when a page was
 * deactivated mid-run.
 */
export function shouldFinalize(run: { completedJobs: number; totalJobs: number }): boolean {
  return run.totalJobs > 0 && run.completedJobs >= run.totalJobs;
}

const pairKey = (pageId: string, strategy: string) => `${pageId} ${strategy}`;

/**
 * Which (page, strategy) pairs a run still owes. Pure, so the set arithmetic --
 * the part that decides whether a resume re-audits 700 pages it already has --
 * is testable without a database.
 */
export function diffMissingPairs(
  expected: AuditPair[],
  existing: Array<{ pageId: string; strategy: string }>,
): AuditPair[] {
  const done = new Set(existing.map((e) => pairKey(e.pageId, e.strategy)));
  return expected.filter((p) => !done.has(pairKey(p.pageId, p.strategy)));
}

export function percentComplete(completedJobs: number, totalJobs: number): number {
  if (totalJobs <= 0) return 0;
  return Math.min(100, Math.round((completedJobs / totalJobs) * 100));
}

export function etaSeconds(
  completedJobs: number,
  totalJobs: number,
  startedAt: Date | null,
  now: Date,
): number | null {
  if (!startedAt || completedJobs <= 0 || completedJobs >= totalJobs) return null;
  const elapsedS = (now.getTime() - startedAt.getTime()) / 1000;
  if (elapsedS <= 0) return null;
  return Math.round((elapsedS / completedJobs) * (totalJobs - completedJobs));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const RUN_PROGRESS_SELECT = {
  id: true,
  type: true,
  triggeredBy: true,
  status: true,
  scopeLabel: true,
  totalJobs: true,
  completedJobs: true,
  failedJobs: true,
  startedAt: true,
  finishedAt: true,
  error: true,
} as const;

export async function getRunProgress(
  prisma: TenantPrismaClient,
  runId: string,
  now: Date = new Date(),
): Promise<RunProgressDTO> {
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: RUN_PROGRESS_SELECT });
  if (!run) throw new NotFoundError(`run ${runId}`);

  return {
    runId: run.id,
    type: run.type as RunProgressDTO['type'],
    triggeredBy: run.triggeredBy as RunProgressDTO['triggeredBy'],
    status: run.status as RunStatus,
    scopeLabel: run.scopeLabel,
    ...scopeLink(run.scopeLabel, run.type),
    totalJobs: run.totalJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    percentComplete: percentComplete(run.completedJobs, run.totalJobs),
    retryingJobs: 0,
    nextRetryInSeconds: null,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    etaSeconds:
      run.status === 'running' ? etaSeconds(run.completedJobs, run.totalJobs, run.startedAt, now) : null,
    error: run.error,
  };
}

/** The overlap guard's input: a sweep must not start while another is in flight. */
export async function findActiveRun(
  prisma: TenantPrismaClient,
  siteId: string,
  type?: RunType,
): Promise<{ id: string; type: string; startedAt: Date } | null> {
  return prisma.auditRun.findFirst({
    // 'paused' counts as active: the jobs are still queued, and letting a
    // second sweep start alongside them would double the quota spend.
    where: { siteId, status: { in: ['queued', 'running', 'paused'] }, ...(type ? { type } : {}) },
    select: { id: true, type: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  siteId: string;
  type: RunType;
  triggeredBy: 'schedule' | 'manual';
  scope: RunScope;
  totalJobs: number;
  status?: RunStatus;
}

export async function createRun(prisma: TenantPrismaClient, input: CreateRunInput): Promise<string> {
  const run = await prisma.auditRun.create({
    data: {
      siteId: input.siteId,
      type: input.type,
      triggeredBy: input.triggeredBy,
      status: input.status ?? 'running',
      scopeLabel: formatScopeLabel(input.scope),
      totalJobs: input.totalJobs,
    },
    select: { id: true },
  });
  return run.id;
}

/** Records a sweep that never started because another was already running. */
export async function createSkippedRun(
  prisma: TenantPrismaClient,
  input: Omit<CreateRunInput, 'status' | 'totalJobs'>,
  reason: string,
): Promise<string> {
  const now = new Date();
  const run = await prisma.auditRun.create({
    data: {
      siteId: input.siteId,
      type: input.type,
      triggeredBy: input.triggeredBy,
      status: 'skipped',
      scopeLabel: formatScopeLabel(input.scope),
      totalJobs: 0,
      skipReason: reason,
      finishedAt: now,
      completedAt: now,
    },
    select: { id: true },
  });
  return run.id;
}

/**
 * Terminal state for a run. Idempotent: the finalize job has a deterministic id,
 * but BullMQ retries and a manual replay can both deliver it twice.
 */
export async function finalizeRun(prisma: TenantPrismaClient, runId: string): Promise<RunStatus> {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, totalJobs: true, completedJobs: true, failedJobs: true },
  });
  if (!run) throw new NotFoundError(`run ${runId}`);

  // 'cancelled' is terminal too: the in-flight jobs finish after a stop, and
  // the last of them would otherwise finalize the run back to 'completed' and
  // erase the fact that someone stopped it.
  if (['completed', 'failed', 'skipped', 'cancelled'].includes(run.status)) {
    return run.status as RunStatus;
  }

  // Partial results are never discarded: a run where some pages could not be
  // measured is a COMPLETED run with error rows in it. Only a run where nothing
  // at all succeeded is a failure.
  const nothingSucceeded = run.totalJobs > 0 && run.failedJobs >= run.totalJobs;
  const status: RunStatus = nothingSucceeded ? 'failed' : 'completed';
  const now = new Date();

  await prisma.auditRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: now,
      completedAt: now,
      error: nothingSucceeded ? 'every page in this run failed to audit' : null,
    },
  });

  logger.info(
    { auditRunId: runId, status, completedJobs: run.completedJobs, failedJobs: run.failedJobs },
    'run finalized',
  );
  return status;
}

export async function failRun(prisma: TenantPrismaClient, runId: string, message: string): Promise<void> {
  const now = new Date();
  await prisma.auditRun.updateMany({
    where: { id: runId, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', error: message, finishedAt: now, completedAt: now },
  });
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/** The (page, strategy) pairs a run's scope covers, as the site stands today. */
export async function expandScope(
  prisma: TenantPrismaClient,
  siteId: string,
  scope: RunScope,
): Promise<AuditPair[]> {
  // A retry is not a query over pages -- it is a replay of a specific list of
  // (page, strategy) pairs, and it must not silently widen if the sitemap has
  // changed since. Handled before the page query for that reason.
  if (scope.kind === 'retry') {
    return failedPairsForRun(prisma, scope.ref ?? '');
  }

  const where =
    scope.kind === 'page'
      ? { id: scope.ref ?? '' }
      : scope.kind === 'pages'
        ? { id: { in: (scope.ref ?? '').split(',').filter(Boolean) } }
        : scope.kind === 'group'
          ? { siteId, isActive: true, group: { slug: scope.ref ?? '', siteId } }
          : { siteId, isActive: true };

  // Sweep order matters: a full sweep is ~35 minutes, so whoever is watching a
  // specific fix wants those pages measured first. Manual group priority wins,
  // then the sitemap's own order, then path for stability.
  const pages = await prisma.page.findMany({
    where,
    select: { id: true, url: true, sitemapIndex: true, group: { select: { priority: true } } },
    orderBy: [
      { group: { priority: { sort: 'asc', nulls: 'last' } } },
      { sitemapIndex: { sort: 'asc', nulls: 'last' } },
      { path: 'asc' },
    ],
  });

  return pages.flatMap((p) =>
    scope.strategies.map((strategy) => ({ pageId: p.id, url: p.url, strategy })),
  );
}

export interface FailedResult {
  pageId: string;
  path: string;
  url: string;
  strategy: PsiStrategy;
  /** Lighthouse's own code, or RETRIES_EXHAUSTED when PSI never answered. */
  error: string;
  at: string;
}

/**
 * The pages a run could not measure.
 *
 * These are real rows, not absences: a job that exhausts its attempts writes an
 * AuditResult with status 'error' and null scores, precisely so the run can
 * still reach totalJobs and finalize. Without that a sweep containing one
 * unmeasurable page would sit at "running" forever.
 */
export async function failedResultsForRun(
  prisma: TenantPrismaClient,
  runId: string,
): Promise<FailedResult[]> {
  const rows = await prisma.auditResult.findMany({
    where: { auditRunId: runId, status: 'error' },
    select: {
      pageId: true,
      strategy: true,
      runtimeError: true,
      createdAt: true,
      page: { select: { path: true, url: true } },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  return rows.map((r) => ({
    pageId: r.pageId,
    path: r.page.path,
    url: r.page.url,
    strategy: r.strategy as PsiStrategy,
    error: r.runtimeError ?? 'unknown',
    at: r.createdAt.toISOString(),
  }));
}

async function failedPairsForRun(prisma: TenantPrismaClient, runId: string): Promise<AuditPair[]> {
  const failed = await failedResultsForRun(prisma, runId);
  // Only pages that still exist and are still in the sitemap. Re-measuring a
  // page that has since been dropped would spend quota on a 404.
  const alive = await prisma.page.findMany({
    where: { id: { in: failed.map((f) => f.pageId) }, isActive: true },
    select: { id: true, url: true },
  });
  const urlById = new Map(alive.map((p) => [p.id, p.url]));

  return failed
    .filter((f) => urlById.has(f.pageId))
    .map((f) => ({ pageId: f.pageId, url: urlById.get(f.pageId)!, strategy: f.strategy }));
}

export interface ResumeSummary {
  runId: string;
  expected: number;
  alreadyDone: number;
  reEnqueued: number;
  finalizedImmediately: boolean;
}

/**
 * Re-enqueues only the work a run has no AuditResult for, and corrects the
 * counters from the true row count.
 *
 * The counter correction is the point. After a Redis flush the jobs are gone but
 * the results are not, and a `completedJobs` left at its pre-crash value would
 * either finalize the run early or never finalize it at all.
 */
export async function resumeRun(prisma: TenantPrismaClient, runId: string, dispatch: AuditDispatcher): Promise<ResumeSummary> {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, siteId: true, scopeLabel: true, totalJobs: true },
  });
  if (!run) throw new NotFoundError(`run ${runId}`);

  const scope = parseScopeLabel(run.scopeLabel);
  const expanded = await expandScope(prisma, run.siteId, scope);

  const existing = await prisma.auditResult.findMany({
    where: { auditRunId: runId },
    select: { pageId: true, strategy: true, status: true },
  });

  /*
   * A run's committed work is FIXED at creation. Re-expanding its scope on
   * resume is only a recovery hint, never a new plan.
   *
   * This bit them for real: a 50-page canary was created with a site-wide
   * scope label, and resuming it re-expanded that label into all 747 pages --
   * turning a deliberately bounded 100-call run into a 1,494-call sweep, which
   * is precisely the thing the whole design forbids doing on demand.
   *
   * Growth is therefore refused outright. Shrinkage is fine and expected: a
   * page deactivated mid-run legitimately reduces the work, and keeping the
   * old larger total would leave the run permanently short of finalizing.
   */
  if (expanded.length > run.totalJobs) {
    await prisma.auditRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error:
          `Cannot resume: the scope now expands to ${expanded.length} jobs but the run committed to ` +
          `${run.totalJobs}. Refusing to silently enlarge it — start a new run instead.`,
        finishedAt: new Date(),
      },
    });
    logger.error(
      { auditRunId: runId, committed: run.totalJobs, expanded: expanded.length },
      'resume refused: scope expanded beyond the committed work',
    );
    return { runId, expected: run.totalJobs, alreadyDone: existing.length, reEnqueued: 0, finalizedImmediately: false };
  }

  const expected = expanded;
  const missing = diffMissingPairs(expected, existing);
  const failedJobs = existing.filter((e) => e.status === 'error').length;

  await prisma.auditRun.update({
    where: { id: runId },
    data: {
      status: 'running',
      completedJobs: existing.length,
      failedJobs,
      // Only ever shrinks. Growth was refused above.
      totalJobs: Math.min(run.totalJobs, Math.max(expected.length, existing.length)),
      finishedAt: null,
      completedAt: null,
      error: null,
    },
  });

  if (missing.length === 0) {
    await dispatch(runId, []);
    logger.info({ auditRunId: runId, expected: expected.length }, 'resume found nothing missing; finalizing');
    return {
      runId,
      expected: expected.length,
      alreadyDone: existing.length,
      reEnqueued: 0,
      finalizedImmediately: true,
    };
  }

  await dispatch(runId, missing);
  logger.info(
    { auditRunId: runId, expected: expected.length, alreadyDone: existing.length, reEnqueued: missing.length },
    'run resumed',
  );

  return {
    runId,
    expected: expected.length,
    alreadyDone: existing.length,
    reEnqueued: missing.length,
    finalizedImmediately: false,
  };
}

/** A run open longer than this is declared dead rather than resumed. */
export function isStale(startedAt: Date, now: Date, staleHours: number): boolean {
  return now.getTime() - startedAt.getTime() > staleHours * 3_600_000;
}

export interface ReconcileSummary {
  resumed: string[];
  failed: string[];
}

/**
 * Called once per cron tick (there is no "worker boot" anymore): adopt or
 * bury whatever the last run left behind.
 *
 * Durable workflow runs are far less likely to lose track of themselves than
 * a BullMQ+Redis pair was (see docs/DECISIONS.md), but this stays as the
 * safety net for the case where a run's workflow genuinely died -- e.g. it
 * was force-cancelled outside the app, or Postgres and the workflow backend
 * disagree about a run's state.
 */
export async function reconcileStaleRuns(
  prisma: TenantPrismaClient,
  dispatch: AuditDispatcher,
  now: Date = new Date(),
): Promise<ReconcileSummary> {
  const staleHours = getEnv().STALE_RUN_HOURS;
  const open = await prisma.auditRun.findMany({
    where: { status: { in: ['queued', 'running'] } },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: 'asc' },
  });

  const summary: ReconcileSummary = { resumed: [], failed: [] };

  for (const run of open) {
    if (isStale(run.startedAt, now, staleHours)) {
      await failRun(prisma, run.id, `abandoned: still running after ${staleHours}h`);
      summary.failed.push(run.id);
      continue;
    }
    try {
      await resumeRun(prisma, run.id, dispatch);
      summary.resumed.push(run.id);
    } catch (e) {
      // One unresumable run must not stop the worker from booting.
      logger.error({ auditRunId: run.id, err: e }, 'could not resume run at boot');
      summary.failed.push(run.id);
    }
  }

  if (open.length > 0) logger.info(summary, 'stale run reconciliation complete');
  return summary;
}


/**
 * Turns a stored scope label back into somewhere to navigate.
 *
 * Without this, a progress bar on an unrelated screen tells you something is
 * running but not where -- which is exactly the moment you want to go look.
 */
export function scopeLink(
  scopeLabel: string | null,
  type: string,
): { scopeHref: string | null; scopeName: string | null } {
  if (type === 'full_sweep') return { scopeHref: '/', scopeName: 'Full site sweep' };
  if (!scopeLabel) return { scopeHref: null, scopeName: null };

  const scope = parseScopeLabel(scopeLabel);
  if (scope.kind === 'group' && scope.ref) {
    return { scopeHref: `/g/${scope.ref}`, scopeName: `${scope.ref} group` };
  }
  if (scope.kind === 'page' && scope.ref) {
    return { scopeHref: `/p/${scope.ref}`, scopeName: 'one page' };
  }
  if (scope.kind === 'pages' && scope.ref) {
    const n = scope.ref.split(',').filter(Boolean).length;
    return { scopeHref: null, scopeName: `${n} selected ${n === 1 ? 'page' : 'pages'}` };
  }
  return { scopeHref: '/', scopeName: 'whole site' };
}

// ---------------------------------------------------------------------------
// Pause / resume / stop
// ---------------------------------------------------------------------------

/**
 * Holding a sweep without losing it.
 *
 * Pausing pauses the QUEUE, not individual jobs -- BullMQ has no per-job hold,
 * and the overlap guard already means at most one sweep is in flight, so the
 * two amount to the same thing here. Two consequences to be honest about in the
 * UI rather than hide:
 *
 *  - Jobs already handed to a worker run to completion. Up to WORKER_CONCURRENCY
 *    more results will land after the pause. Killing them mid-flight would burn
 *    the quota they already spent and produce nothing.
 *  - Everything queued stays queued. Nothing is lost, and resuming continues
 *    from where it stopped rather than starting over.
 *
 * Stopping is different from failing: the run keeps every result it collected
 * and is marked `cancelled`, because "someone stopped this" and "this broke"
 * need to look different in the run history a month later.
 */

export type RunControl = 'pause' | 'resume' | 'stop';

export interface RunControlResult {
  status: RunStatus;
  /** Jobs still queued at the moment of the change. */
  pending: number;
  /** Jobs a worker had already picked up and will finish regardless. */
  inFlight: number;
}

const PAUSABLE: RunStatus[] = ['queued', 'running'];

export async function controlRun(
  prisma: TenantPrismaClient,
  runId: string,
  action: RunControl,
  queue: {
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    getWaitingCount: () => Promise<number>;
    getDelayedCount: () => Promise<number>;
    getActiveCount: () => Promise<number>;
    drain: (delayed?: boolean) => Promise<void>;
  },
): Promise<RunControlResult> {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, completedJobs: true, totalJobs: true },
  });
  if (!run) throw new NotFoundError(`run ${runId}`);

  const status = run.status as RunStatus;

  if (action === 'pause' && !PAUSABLE.includes(status)) {
    throw new Error(`This run is ${status}, so there is nothing to pause.`);
  }
  if (action === 'resume' && status !== 'paused') {
    throw new Error(`This run is ${status}, not paused.`);
  }
  if (action === 'stop' && !['queued', 'running', 'paused'].includes(status)) {
    throw new Error(`This run already finished as ${status}.`);
  }

  if (action === 'pause') {
    await queue.pause();
    await prisma.auditRun.update({ where: { id: runId }, data: { status: 'paused' } });
  } else if (action === 'resume') {
    await prisma.auditRun.update({ where: { id: runId }, data: { status: 'running' } });
    // Order matters: mark running BEFORE unpausing, or a job can finish and
    // try to finalize a run the database still calls paused.
    await queue.resume();
  } else {
    // Drain first so nothing new starts, then unpause -- a drained-but-paused
    // queue would block the NEXT run too.
    await queue.drain(true);
    await queue.resume();
    await prisma.auditRun.update({
      where: { id: runId },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        error: `Stopped after ${run.completedJobs} of ${run.totalJobs} pages. The results collected are kept.`,
      },
    });
  }

  const [waiting, delayed, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getDelayedCount(),
    queue.getActiveCount(),
  ]);

  const next: RunStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled';
  logger.info({ runId, action, waiting, active }, 'run control');
  return { status: next, pending: waiting + delayed, inFlight: active };
}
