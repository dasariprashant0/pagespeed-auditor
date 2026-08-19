import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { toRunProgress } from '@/lib/services/site.service';
import { estimateRun } from '@/lib/services/estimate.service';
import { getAuditQueue } from '@/lib/queue/queues';

export const dynamic = 'force-dynamic';

/**
 * Any in-flight run, so the progress bar is visible on every screen rather than
 * only the one where the audit was started.
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const runs = await prisma.auditRun.findMany({
    // Scoped: an unfiltered poll would leak another tenant's activity, and
    // their scope labels name their pages.
    where: { status: { in: ['queued', 'running'] }, site: { organizationId: session.organizationId } },
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: {
      id: true, type: true, triggeredBy: true, status: true, scopeLabel: true,
      totalJobs: true, completedJobs: true, failedJobs: true,
      startedAt: true, finishedAt: true, error: true,
    },
  });

  // One measurement shared by every run in the response.
  const seed = runs.length > 0 ? (await estimateRun(1)).throughputPerSecond : undefined;

  // Delayed jobs are ones waiting out a retry backoff. Without surfacing this,
  // a run whose last job is on a 4-minute backoff looks frozen at 99/100 with a
  // countdown that keeps promising seconds -- which reads as a hang, not as the
  // retry policy working.
  let retryingJobs = 0;
  let nextRetryInSeconds: number | null = null;
  if (runs.length > 0) {
    try {
      const queue = getAuditQueue();
      const delayed = await queue.getJobs(['delayed'], 0, 50);
      retryingJobs = delayed.length;
      const soonest = delayed
        .map((j) => (j.opts.delay ?? 0) + (j.timestamp ?? 0))
        .filter((n) => n > Date.now())
        .sort((a, b) => a - b)[0];
      if (soonest) nextRetryInSeconds = Math.max(0, Math.round((soonest - Date.now()) / 1000));
    } catch {
      // Queue introspection is a nicety; never fail the progress poll over it.
    }
  }

  return NextResponse.json(
    { runs: runs.map((r) => ({ ...toRunProgress(r, undefined, seed), retryingJobs, nextRetryInSeconds })) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
