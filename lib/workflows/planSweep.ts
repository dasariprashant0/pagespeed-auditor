import { getTenantPrisma } from '../db/tenant.ts';
import { logger } from '../logger.ts';
import {
  BOTH_STRATEGIES,
  createRun,
  createSkippedRun,
  expandScope,
  findActiveRun,
} from '../services/run.service.ts';
import { startAuditRun } from './auditRun.ts';

/**
 * Plans and starts a full-site sweep. Moved verbatim from the old
 * lib/queue/processors/planSweep.processor.ts (a BullMQ control-queue job) --
 * called now by the cron route instead. Only the scheduler calls this; there
 * is deliberately no on-demand path to a full sweep. See docs/DECISIONS.md 2.2.
 */
export async function planAndStartSweep(
  organizationId: string,
  siteId: string,
  triggeredBy: 'schedule' | 'manual',
): Promise<void> {
  const scope = { kind: 'site' as const, ref: null, strategies: BOTH_STRATEGIES };
  const prisma = await getTenantPrisma(organizationId);

  // Overlap guard. A delayed sweep is worse than a skipped one: queueing this
  // behind a running sweep means two sweeps back to back, and the second
  // measures a site nobody has changed in the meantime.
  const active = await findActiveRun(prisma, siteId);
  if (active) {
    const skippedId = await createSkippedRun(
      prisma,
      { siteId, type: 'full_sweep', triggeredBy, scope },
      `another ${active.type} run (${active.id}) was still active`,
    );
    logger.warn({ skippedId, blockedBy: active }, 'sweep skipped — another run is active');
    return;
  }

  const pairs = await expandScope(prisma, siteId, scope);
  if (pairs.length === 0) {
    logger.warn({ siteId }, 'sweep planned with no active pages — nothing to do');
    return;
  }

  const runId = await createRun(prisma, {
    siteId,
    type: 'full_sweep',
    triggeredBy,
    scope,
    totalJobs: pairs.length,
  });

  await startAuditRun(runId, pairs, organizationId);
  logger.info({ runId, queued: pairs.length }, 'sweep planned');
}
