import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';
import { toRunProgress } from '@/lib/services/site.service';
import { estimateRun } from '@/lib/services/estimate.service';
import { NotProvisionedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Any in-flight run, so the progress bar is visible on every screen rather than
 * only the one where the audit was started.
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  let prisma: Awaited<ReturnType<typeof getTenantPrisma>>;
  try {
    prisma = await getTenantPrisma(session.organizationId);
  } catch (e) {
    if (e instanceof NotProvisionedError) {
      return NextResponse.json({ error: 'not_provisioned' }, { status: 409 });
    }
    throw e;
  }
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

  return NextResponse.json(
    { runs: runs.map((r) => toRunProgress(r, undefined, seed)) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
