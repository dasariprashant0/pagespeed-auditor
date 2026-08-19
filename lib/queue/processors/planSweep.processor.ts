import type { Job } from 'bullmq';
import { prisma } from '../../db.ts';
import { logger } from '../../logger.ts';
import {
  BOTH_STRATEGIES,
  createRun,
  createSkippedRun,
  expandScope,
  findActiveRun,
} from '../../services/run.service.ts';
import { enqueueAuditJobs } from '../producers.ts';
import type { PlanSweepJobData } from '../jobs.ts';

/**
 * Plans a full-site sweep.
 *
 * Only the scheduler calls this. There is deliberately no on-demand path to a
 * full sweep -- 1,494 calls at 0.75 req/s is a ~33 minute job, so a button that
 * appears to do something and then shows nothing for half an hour is a worse
 * interface than no button. See docs/DECISIONS.md 2.2.
 */
export async function processPlanSweep(job: Job<PlanSweepJobData>): Promise<void> {
  const { siteId, triggeredBy } = job.data;
  const scope = { kind: 'site' as const, ref: null, strategies: BOTH_STRATEGIES };

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

  const queued = await enqueueAuditJobs(runId, pairs);
  logger.info({ runId, queued }, 'sweep planned');
}
