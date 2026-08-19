import type { PsiStrategy } from '../psi/types.ts';
import { getAuditQueue, getControlQueue } from './queues.ts';
import { JOB_AUDIT_PAGE, JOB_FINALIZE_RUN, JOB_PLAN_SWEEP, auditJobId, finalizeJobId, planSweepJobId } from './names.ts';
import type { AuditPageJobData } from './jobs.ts';

/** One (page, strategy) unit of work. */
export interface AuditPair {
  pageId: string;
  url: string;
  strategy: PsiStrategy;
}

/**
 * Bulk-enqueues audit jobs for a run.
 *
 * Chunked because a 2,000-job addBulk is a single multi-megabyte Lua call that
 * can block Redis long enough for the worker's blocking fetch to time out.
 */
export async function enqueueAuditJobs(
  runId: string,
  pairs: AuditPair[],
  chunkSize = 250,
): Promise<number> {
  const queue = getAuditQueue();
  let queued = 0;

  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize);
    await queue.addBulk(
      chunk.map((p) => ({
        name: JOB_AUDIT_PAGE,
        data: { runId, pageId: p.pageId, url: p.url, strategy: p.strategy } satisfies AuditPageJobData,
        opts: { jobId: auditJobId(runId, p.pageId, p.strategy) },
      })),
    );
    queued += chunk.length;
  }

  return queued;
}

/**
 * Enqueued by the audit processor the moment completedJobs reaches totalJobs.
 *
 * Deterministic jobId rather than a FlowProducer parent: a parent with 2,000
 * children is expensive to track, and one permanently-failed child fails the
 * parent -- which is the normal case here, since a page Lighthouse cannot
 * measure is a legitimate outcome, not a broken run.
 */
export async function enqueueFinalizeRun(runId: string): Promise<void> {
  await getControlQueue().add(
    JOB_FINALIZE_RUN,
    { runId },
    { jobId: finalizeJobId(runId) },
  );
}

/**
 * Only the scheduler calls this. There is deliberately no service function
 * that triggers a full sweep on demand -- see docs/DECISIONS.md 2.2.
 */
export async function enqueuePlanSweep(
  siteId: string,
  triggeredBy: 'schedule' | 'manual',
  at: Date = new Date(),
): Promise<void> {
  await getControlQueue().add(
    JOB_PLAN_SWEEP,
    { siteId, triggeredBy },
    { jobId: planSweepJobId(siteId, at) },
  );
}
