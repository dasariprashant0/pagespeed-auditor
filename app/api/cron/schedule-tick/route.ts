import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { reconcileStaleRuns } from '@/lib/services/run.service';
import { dueSchedules, advanceSchedule } from '@/lib/services/schedule.service';
import { startAuditRun } from '@/lib/workflows/auditRun';
import { planAndStartSweep } from '@/lib/workflows/planSweep';
import { stampSchedulerHeartbeat } from '@/lib/opsState';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Replaces the 60s setInterval that used to live inside the standalone
 * worker process (lib/queue/worker.ts) plus its reconcileStaleRuns-at-boot
 * call. Triggered by Vercel Cron every 15 minutes (see vercel.json) --
 * sweeps take ~35 minutes and must be ≥1h apart (schedule.service.ts's
 * MIN_INTERVAL_MS), so 15-minute granularity loses nothing.
 *
 * Full-sweep-is-schedule-only (docs/DECISIONS.md 2.2) holds here by
 * construction: this route is the only caller of planAndStartSweep.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  await stampSchedulerHeartbeat();

  const reconciled = await reconcileStaleRuns(prisma, startAuditRun);
  if (reconciled.resumed.length > 0 || reconciled.failed.length > 0) {
    logger.info(reconciled, 'stale runs reconciled at cron tick');
  }

  const due = await dueSchedules();
  for (const s of due) {
    if (!s.cronExpr) continue;
    // Advance FIRST: a slow start must not let the next tick fire the same
    // schedule again.
    await advanceSchedule(s.id, s.cronExpr, s.timezone);
    await planAndStartSweep(s.siteId, 'schedule');
    logger.info({ siteId: s.siteId, cron: s.cronExpr }, 'scheduled sweep queued');
  }

  return NextResponse.json({ ok: true, reconciled, sweepsStarted: due.length });
}
