import type { PrismaClient } from '@prisma/client';
import type { PsiStrategy } from '../psi/types.ts';
import type { RunProgressDTO, RunStatus } from './types.ts';
import { NotFoundError } from '../errors.ts';
import { logger } from '../logger.ts';
import { getEnv } from '../env.ts';
import { enqueueAuditJobs, enqueueFinalizeRun, type AuditPair } from '../queue/producers.ts';

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
  kind: 'site' | 'group' | 'page';
  /** Group slug, or page id. Null for a whole-site sweep. */
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
    if ((kind === 'group' || kind === 'page') && ref) return { kind, ref, strategies };
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
  siteId: string,
  type?: RunType,
): Promise<{ id: string; type: string; startedAt: Date } | null> {
  return prisma.auditRun.findFirst({
    where: { siteId, status: { in: ['queued', 'running'] }, ...(type ? { type } : {}) },
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

export async function createRun(prisma: PrismaClient, input: CreateRunInput): Promise<string> {
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
  prisma: PrismaClient,
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
export async function finalizeRun(prisma: PrismaClient, runId: string): Promise<RunStatus> {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, totalJobs: true, completedJobs: true, failedJobs: true },
  });
  if (!run) throw new NotFoundError(`run ${runId}`);

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'skipped') {
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

export async function failRun(prisma: PrismaClient, runId: string, message: string): Promise<void> {
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
  prisma: PrismaClient,
  siteId: string,
  scope: RunScope,
): Promise<AuditPair[]> {
  const where =
    scope.kind === 'page'
      ? { id: scope.ref ?? '' }
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
export async function resumeRun(prisma: PrismaClient, runId: string): Promise<ResumeSummary> {
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
    await enqueueFinalizeRun(runId);
    logger.info({ auditRunId: runId, expected: expected.length }, 'resume found nothing missing; finalizing');
    return {
      runId,
      expected: expected.length,
      alreadyDone: existing.length,
      reEnqueued: 0,
      finalizedImmediately: true,
    };
  }

  await enqueueAuditJobs(runId, missing);
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
 * Worker boot: adopt or bury whatever the last process left behind.
 *
 * BullMQ recovers waiting and delayed jobs on its own and the stalled checker
 * reclaims active ones, so this exists for the case it cannot see -- Redis lost
 * its data while Postgres kept the run rows.
 */
export async function reconcileStaleRuns(
  prisma: PrismaClient,
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
      await resumeRun(prisma, run.id);
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
  return { scopeHref: '/', scopeName: 'whole site' };
}
