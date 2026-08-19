import { prisma } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import type { PsiStrategy } from '../psi/types.ts';
import { computeAggregate, latestResultIdFor } from './results.service.ts';
import { scopeLink } from './run.service.ts';
import type { RunProgressDTO, RunStatus, SiteSummaryDTO } from './types.ts';

/**
 * Site-level headline numbers and audit-run progress.
 *
 * The progress shape is polled, not pushed: the run executes in a separate
 * worker process that writes progress to Postgres, so a Next SSE handler would
 * poll this same row and re-emit it. See docs/DECISIONS.md 2.7.
 */

// ---------------------------------------------------------------------------
// Pure progress arithmetic
// ---------------------------------------------------------------------------

const RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'completed', 'failed', 'skipped'];

export function asRunStatus(value: string): RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value) ? (value as RunStatus) : 'queued';
}

/**
 * Percent of jobs finished, clamped to 0..100.
 *
 * completedJobs counts every job that produced a result row, including the ones
 * that produced an error row -- that is exactly why error rows exist, so a run
 * can finalize. failedJobs is a SUBSET of it, reported separately, and adding
 * the two would double-count every failure.
 */
export function percentComplete(completedJobs: number, totalJobs: number, status?: RunStatus): number {
  if (status === 'completed') return 100;
  if (totalJobs <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completedJobs / totalJobs) * 100)));
}

export interface EtaInput {
  startedAt: Date | null;
  completedJobs: number;
  totalJobs: number;
  now?: Date;
}

/**
 * Seconds remaining, extrapolated from the rate achieved so far.
 *
 * Deliberately naive: PSI throughput is rate-limiter-bound and near constant
 * (~0.75 req/s, validated in M3), so observed rate is a good predictor and a
 * weighted model would add nothing. Returns null rather than Infinity or a wild
 * first guess when there is nothing to extrapolate from -- a progress bar with
 * no ETA is honest, one showing "4 hours" after the first job is not.
 */
/**
 * Remaining seconds for a run.
 *
 * Once a job has finished, the run's OWN observed rate is the best available
 * signal and is used directly. Before that, `seedRatePerSecond` (the site's
 * measured median from estimate.service) fills the gap -- otherwise a 60 s
 * first call means a full minute of "no estimate", which is exactly when
 * someone is looking at the bar wondering whether it is stuck.
 */
export function estimateEtaSeconds(input: EtaInput & { seedRatePerSecond?: number }): number | null {
  const { startedAt, completedJobs, totalJobs } = input;
  if (!startedAt || totalJobs <= 0) return null;

  if (completedJobs <= 0) {
    const seed = input.seedRatePerSecond;
    return seed && seed > 0 ? Math.round(totalJobs / seed) : null;
  }

  const remaining = totalJobs - completedJobs;
  if (remaining <= 0) return 0;

  const elapsedMs = (input.now ?? new Date()).getTime() - startedAt.getTime();
  if (elapsedMs <= 0) return null;

  const msPerJob = elapsedMs / completedJobs;
  return Math.max(0, Math.round((remaining * msPerJob) / 1000));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface RunRow {
  id: string;
  type: string;
  triggeredBy: string;
  status: string;
  scopeLabel: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

const RUN_SELECT = {
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

export function toRunProgress(
  run: RunRow,
  now?: Date,
  /** Measured site throughput, used only until the run has a rate of its own. */
  seedRatePerSecond?: number,
): RunProgressDTO {
  const status = asRunStatus(run.status);
  return {
    runId: run.id,
    type: run.type as RunProgressDTO['type'],
    triggeredBy: run.triggeredBy as RunProgressDTO['triggeredBy'],
    status,
    scopeLabel: run.scopeLabel,
    ...scopeLink(run.scopeLabel, run.type),
    totalJobs: run.totalJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    percentComplete: percentComplete(run.completedJobs, run.totalJobs, status),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    // Only a live run has an ETA worth showing.
    etaSeconds:
      status === 'running'
        ? estimateEtaSeconds({
            startedAt: run.startedAt,
            completedJobs: run.completedJobs,
            totalJobs: run.totalJobs,
            now,
            seedRatePerSecond,
          })
        : null,
    error: run.error,
  };
}

export async function getRunProgress(runId: string): Promise<RunProgressDTO | null> {
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
  return run ? toRunProgress(run) : null;
}

export async function listRecentRuns(siteId: string, limit = 20): Promise<RunProgressDTO[]> {
  const runs = await prisma.auditRun.findMany({
    where: { siteId },
    select: RUN_SELECT,
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  return runs.map((r) => toRunProgress(r));
}

/**
 * Headline numbers for the site.
 *
 * Mobile by default: it is the strategy the group aggregate and every score
 * headline are quoted in (docs/DECISIONS.md 2.6), and quoting the site average
 * in a different strategy from the cards below it would be quietly misleading.
 */
export async function getSiteSummary(
  siteId: string,
  strategy: PsiStrategy = 'mobile',
): Promise<SiteSummaryDTO> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, baseUrl: true, sitemapUrl: true },
  });
  if (!site) throw new NotFoundError(`Site ${siteId}`);

  const [pageCount, activePageCount, groupCount, lastSweep, pages] = await Promise.all([
    prisma.page.count({ where: { siteId } }),
    prisma.page.count({ where: { siteId, isActive: true } }),
    prisma.group.count({ where: { siteId } }),
    prisma.auditRun.findFirst({
      where: { siteId, type: 'full_sweep', status: 'completed' },
      orderBy: { finishedAt: { sort: 'desc', nulls: 'last' } },
      select: { finishedAt: true },
    }),
    prisma.page.findMany({
      where: { siteId, isActive: true },
      select: { id: true, latestResultMobileId: true, latestResultDesktopId: true },
    }),
  ]);

  const resultIds = pages
    .map((p) => latestResultIdFor(p, strategy))
    .filter((id): id is string => id !== null);

  const results = resultIds.length
    ? await prisma.auditResult.findMany({
        where: { id: { in: resultIds } },
        select: {
          status: true,
          performanceScore: true,
          accessibilityScore: true,
          bestPracticesScore: true,
          seoScore: true,
        },
      })
    : [];

  return {
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    sitemapUrl: site.sitemapUrl,
    pageCount,
    activePageCount,
    groupCount,
    // Pages with a usable measurement -- the same population the average is
    // taken over, so "84 average across 512 pages" is internally consistent.
    auditedCount: results.filter((r) => r.status === 'ok').length,
    lastSweepAt: lastSweep?.finishedAt ? lastSweep.finishedAt.toISOString() : null,
    siteAverage: computeAggregate(results),
  };
}


