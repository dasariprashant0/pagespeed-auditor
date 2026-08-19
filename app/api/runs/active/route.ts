import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { toRunProgress } from '@/lib/services/site.service';

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

  return NextResponse.json(
    { runs: runs.map((r) => toRunProgress(r)) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
