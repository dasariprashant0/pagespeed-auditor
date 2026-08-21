import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';
import { toRunProgress } from '@/lib/services/site.service';
import { estimateRun } from '@/lib/services/estimate.service';

export const dynamic = 'force-dynamic';

/**
 * Any in-flight run, so the progress bar is visible on every screen rather than
 * only the one where the audit was started.
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const prisma = await getTenantPrisma(session.organizationId);
  const runs = await prisma.auditRun.findMany({
    // Scoped: an unfiltered poll would leak another tenant's activity, and
    // their scope labels name their pages.
    where: {
      // A paused run stays on the bar -- that is where the button to resume it
      // lives, and a sweep that vanished from the UI would look abandoned.
      status: { in: ['queued', 'running', 'paused'] },
      site: { organizationId: session.organizationId },
    },
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: {
      id: true, type: true, triggeredBy: true, status: true, scopeLabel: true,
      totalJobs: true, completedJobs: true, failedJobs: true,
      startedAt: true, finishedAt: true, error: true,
    },
  });

  // One measurement shared by every run in the response.
  const seed = runs.length > 0 ? (await estimateRun(session.organizationId, 1)).throughputPerSecond : undefined;

  // Retry backoff now happens inside one workflow step (lib/workflows/auditRun.ts)
  // rather than as BullMQ delayed jobs, so there is no longer a queue to
  // introspect for "how many are waiting out a backoff" -- a run mid-retry
  // just looks like a normal in-flight page until it either succeeds or
  // exhausts its attempts.
  const retryingJobs = 0;
  const nextRetryInSeconds: number | null = null;

  return NextResponse.json(
    { runs: runs.map((r) => ({ ...toRunProgress(r, undefined, seed), retryingJobs, nextRetryInSeconds })) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
