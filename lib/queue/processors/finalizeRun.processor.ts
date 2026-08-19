import type { Job } from 'bullmq';
import { prisma } from '../../db.ts';
import { runLogger } from '../../logger.ts';
import { finalizeRun } from '../../services/run.service.ts';
import { buildSweepSummary } from '../../services/sweepSummary.service.ts';
import { dispatchSweepNotification } from '../../notify/index.ts';
import { getEnv } from '../../env.ts';
import type { FinalizeRunJobData } from '../jobs.ts';

/**
 * Closes out a run once every job has reported.
 *
 * Idempotent by construction: finalizeRun() reads the current status and does
 * nothing if the run is already terminal, so a replayed finalize is harmless.
 */
export async function processFinalizeRun(job: Job<FinalizeRunJobData>): Promise<void> {
  const { runId } = job.data;
  const log = runLogger(runId);

  const status = await finalizeRun(prisma, runId);
  log.info({ status }, 'run finalized');

  // Notifications fire for SWEEPS only. An on-demand page or group run is
  // someone standing at the screen watching it; emailing them about it is how
  // a channel gets muted, which loses the alerts that mattered.
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { type: true, siteId: true },
  });
  if (run?.type !== 'full_sweep') return;
  if (status !== 'completed' && status !== 'failed') return;

  const summary = await buildSweepSummary(
    runId,
    status === 'failed' ? 'sweep.failed' : 'sweep.completed',
    getEnv().APP_URL,
  );
  if (summary) await dispatchSweepNotification(run.siteId, summary);
}
