import type { Job } from 'bullmq';
import { prisma } from '../../db.ts';
import { runLogger } from '../../logger.ts';
import { finalizeRun } from '../../services/run.service.ts';
import type { FinalizeRunJobData } from '../jobs.ts';

/**
 * Closes out a run once every job has reported.
 *
 * Idempotent by construction: finalizeRun() reads the current status and does
 * nothing if the run is already terminal, so a replayed finalize is harmless.
 */
export async function processFinalizeRun(job: Job<FinalizeRunJobData>): Promise<void> {
  const { runId } = job.data;
  const status = await finalizeRun(prisma, runId);
  runLogger(runId).info({ status }, 'run finalized');
}
