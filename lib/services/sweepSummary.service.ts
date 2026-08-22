import { getTenantPrisma, type TenantPrismaClient } from '../db/tenant.ts';
import type { SweepSummary, NotificationEvent } from '../notify/types.ts';

/**
 * Assembles what a person needs to know about a finished sweep without opening
 * the dashboard: did it complete, did scores move, and which pages are worst.
 */
export async function buildSweepSummary(
  organizationId: string,
  runId: string,
  event: NotificationEvent,
  appUrl: string,
): Promise<SweepSummary | null> {
  const prisma = await getTenantPrisma(organizationId);
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: {
      id: true, siteId: true, totalJobs: true, completedJobs: true, failedJobs: true,
      startedAt: true, finishedAt: true, error: true,
      site: { select: { name: true } },
    },
  });
  if (!run) return null;

  // status:'ok' only -- error rows carry null scores and would drag an average
  // toward nothing, or be counted as zeros.
  const results = await prisma.auditResult.findMany({
    where: { auditRunId: runId, status: 'ok', strategy: 'mobile' },
    select: { performanceScore: true, page: { select: { url: true } } },
  });

  const scored = results.filter((r) => r.performanceScore !== null);
  const average =
    scored.length > 0
      ? Math.round(scored.reduce((a, r) => a + r.performanceScore!, 0) / scored.length)
      : null;

  const previous = await previousSweepAverage(prisma, run.siteId, runId);

  const worstPages = [...scored]
    .sort((a, b) => (a.performanceScore ?? 0) - (b.performanceScore ?? 0))
    .slice(0, 5)
    .map((r) => ({ url: r.page.url, score: r.performanceScore }));

  const durationMinutes =
    run.startedAt && run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60_000)
      : null;

  return {
    runId: run.id,
    siteName: run.site.name,
    event,
    totalJobs: run.totalJobs,
    completedJobs: run.completedJobs,
    failedJobs: run.failedJobs,
    durationMinutes,
    averagePerformance: average,
    previousAveragePerformance: previous,
    worstPages,
    dashboardUrl: appUrl,
    error: run.error,
  };
}

/** The comparison point: the previous COMPLETED sweep, not merely the previous run. */
async function previousSweepAverage(
  prisma: TenantPrismaClient,
  siteId: string,
  excludeRunId: string,
): Promise<number | null> {
  const prev = await prisma.auditRun.findFirst({
    where: { siteId, type: 'full_sweep', status: 'completed', id: { not: excludeRunId } },
    orderBy: { finishedAt: 'desc' },
    select: { id: true },
  });
  if (!prev) return null;

  const agg = await prisma.auditResult.aggregate({
    where: { auditRunId: prev.id, status: 'ok', strategy: 'mobile' },
    _avg: { performanceScore: true },
  });
  return agg._avg.performanceScore === null ? null : Math.round(agg._avg.performanceScore);
}
