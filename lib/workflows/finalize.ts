import { prisma } from '../db.ts';
import { runLogger } from '../logger.ts';
import { finalizeRun } from '../services/run.service.ts';
import { buildSweepSummary } from '../services/sweepSummary.service.ts';
import { pruneSiteHistory } from '../services/retention.service.ts';
import { dispatchSweepNotification } from '../notify/index.ts';
import { getEnv } from '../env.ts';

/**
 * Closes out a run once every job has reported. Moved verbatim from the old
 * lib/queue/processors/finalizeRun.processor.ts -- the logic is unchanged,
 * only the caller changed (a Workflow step, or a direct call from
 * resumeRun() when nothing was missing, instead of a BullMQ control job).
 *
 * Idempotent by construction: finalizeRun() reads the current status and does
 * nothing if the run is already terminal, so calling this twice is harmless.
 */
export async function finalizeAndNotify(runId: string): Promise<void> {
  const log = runLogger(runId);

  const status = await finalizeRun(prisma, runId);
  log.info({ status }, 'run finalized');

  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    select: { type: true, siteId: true },
  });
  if (!run) return;

  try {
    const pruned = await pruneSiteHistory(run.siteId);
    if (pruned.resultsDeleted > 0) log.info({ ...pruned }, 'aged-out history removed');
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, 'history prune failed');
  }

  if (run.type !== 'full_sweep') return;
  if (status !== 'completed' && status !== 'failed') return;

  // Without a workflow's own retry loop wrapping this call anymore (a step
  // retry would just replay the already-finalized run and skip straight past
  // this point -- see lib/workflows/auditRun.ts), a notification failure must
  // not look like anything went wrong with the run itself, which already
  // succeeded. Same reasoning as the prune try/catch above.
  try {
    const summary = await buildSweepSummary(
      runId,
      status === 'failed' ? 'sweep.failed' : 'sweep.completed',
      getEnv().APP_URL,
    );
    if (summary) await dispatchSweepNotification(run.siteId, summary);
  } catch (e) {
    log.error({ err: e instanceof Error ? e.message : String(e) }, 'sweep notification failed');
  }
}
