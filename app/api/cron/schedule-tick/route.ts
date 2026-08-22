import { NextResponse } from 'next/server';
import { centralPrisma } from '@/lib/db/central';
import { withTenantPrisma } from '@/lib/db/tenant';
import { logger } from '@/lib/logger';
import { reconcileStaleRuns } from '@/lib/services/run.service';
import { dueSchedules, advanceSchedule } from '@/lib/services/schedule.service';
import { startAuditRun } from '@/lib/workflows/auditRun';
import { planAndStartSweep } from '@/lib/workflows/planSweep';
import { stampSchedulerHeartbeat } from '@/lib/opsState';
import { forEachOrgIsolated } from '@/lib/cron/orgLoop';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Replaces the 60s setInterval that used to live inside the standalone
 * worker process (lib/queue/worker.ts) plus its reconcileStaleRuns-at-boot
 * call. Vercel Cron on the Hobby plan can only fire this once a day
 * (vercel.json) -- the actual 15-minute cadence comes from a free GitHub
 * Actions pinger instead (.github/workflows/schedule-tick.yml). Sweeps take
 * ~35 minutes and must be ≥1h apart (schedule.service.ts's MIN_INTERVAL_MS),
 * so 15-minute granularity loses nothing.
 *
 * Full-sweep-is-schedule-only (docs/DECISIONS.md 2.2) holds here by
 * construction: this route is the only caller of planAndStartSweep.
 *
 * Per-tenant cutover (phase 5): `Schedule`/`AuditRun` now live in each org's
 * own Neon database, so "what's due right now" can no longer be answered by
 * one query against one database. This route first asks the central
 * database which orgs are actually provisioned, then does the
 * check/reconcile/sweep work for each one in turn. Only `reconcileStaleRuns`
 * actually goes through `withTenantPrisma` (opening, using and closing a
 * client without touching the shared cache) -- that's the one call here that
 * needs a client closed right after use rather than left warm, since this
 * route fans out across every org in one invocation and the cache is
 * deliberately for single-org callers. `stampSchedulerHeartbeat`,
 * `dueSchedules`, `advanceSchedule` and `planAndStartSweep` all resolve
 * `getTenantPrisma` internally instead, the same per-org cache everywhere
 * else in the app uses. One org's failure (revoked credential, Neon outage)
 * must not stop the tick for every other org -- see
 * lib/cron/orgLoop.ts's forEachOrgIsolated, which this route delegates the
 * loop to.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const readyOrgs = await centralPrisma.organization.findMany({
    where: { provisionStatus: 'ready' },
    select: { id: true },
  });

  let totalReconciled = { resumed: [] as string[], failed: [] as string[] };
  let sweepsStarted = 0;

  await forEachOrgIsolated(
    readyOrgs,
    async ({ id: organizationId }) => {
      await stampSchedulerHeartbeat(organizationId);

      const reconciled = await withTenantPrisma(organizationId, (prisma) =>
        reconcileStaleRuns(prisma, (runId, pairs) => startAuditRun(runId, pairs, organizationId)),
      );
      if (reconciled.resumed.length > 0 || reconciled.failed.length > 0) {
        logger.info({ organizationId, ...reconciled }, 'stale runs reconciled at cron tick');
      }
      totalReconciled = {
        resumed: [...totalReconciled.resumed, ...reconciled.resumed],
        failed: [...totalReconciled.failed, ...reconciled.failed],
      };

      const due = await dueSchedules(organizationId);
      for (const s of due) {
        if (!s.cronExpr) continue;
        // Advance FIRST: a slow start must not let the next tick fire the
        // same schedule again.
        await advanceSchedule(organizationId, s.id, s.cronExpr, s.timezone);
        await planAndStartSweep(organizationId, s.siteId, 'schedule');
        logger.info({ organizationId, siteId: s.siteId, cron: s.cronExpr }, 'scheduled sweep queued');
        sweepsStarted++;
      }
    },
    // One org's tenant database being unreachable (revoked credential, Neon
    // outage) must not stop the tick for every other org.
    ({ id: organizationId }, e) => {
      logger.error({ organizationId, err: e instanceof Error ? e.message : String(e) }, 'cron tick failed for org');
    },
  );

  return NextResponse.json({ ok: true, reconciled: totalReconciled, sweepsStarted });
}
