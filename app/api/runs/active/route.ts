import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
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

  const runs = await prisma.auditRun.findMany({
    where: { status: { in: ['queued', 'running'] } },
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

  return NextResponse.json(
    { runs: runs.map((r) => toRunProgress(r, undefined, seed)) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
