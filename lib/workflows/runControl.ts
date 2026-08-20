import { prisma } from '../db.ts';
import { getEnv } from '../env.ts';

/**
 * controlRun() in run.service.ts takes an abstract `queue` object -- this is
 * that seam's new implementation, replacing the one backed by a BullMQ Queue.
 *
 * pause()/resume() are no-ops here: controlRun() already writes AuditRun's
 * status itself, and that status is exactly what auditRunWorkflow polls at
 * each batch boundary (see lib/workflows/auditRun.ts). There is no separate
 * queue state to touch. Same for drain() on stop -- the workflow observes
 * `status === 'cancelled'` on its own next check.
 *
 * getWaitingCount/getActiveCount are derived, not measured: with one workflow
 * processing pairs in batches instead of many BullMQ workers, "how many are
 * in flight right now" is well-approximated by the batch size, capped by what
 * remains. Accurate for the "N pages are waiting; M already started will
 * still finish" message controlRunAction shows -- not a live job count.
 */
export function workflowRunQueue(runId: string) {
  const batchSize = getEnv().WORKER_CONCURRENCY;

  async function remaining(): Promise<number> {
    const run = await prisma.auditRun.findUnique({
      where: { id: runId },
      select: { totalJobs: true, completedJobs: true },
    });
    if (!run) return 0;
    return Math.max(0, run.totalJobs - run.completedJobs);
  }

  return {
    pause: async () => {},
    resume: async () => {},
    drain: async () => {},
    getActiveCount: async () => Math.min(batchSize, await remaining()),
    getWaitingCount: async () => Math.max(0, (await remaining()) - batchSize),
    getDelayedCount: async () => 0,
  };
}
