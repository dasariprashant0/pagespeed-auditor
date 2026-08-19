import type { Job } from 'bullmq';
import { UnrecoverableError, Worker } from 'bullmq';
import { prisma } from '../../db.ts';
import { PermanentError, RetryableError } from '../../errors.ts';
import { jobLogger } from '../../logger.ts';
import { auditPage } from '../../services/audit.service.ts';
import { getAuditQueue, getPsiRateLimiter } from '../queues.ts';
import { enqueueFinalizeRun } from '../producers.ts';
import type { AuditPageJobData } from '../jobs.ts';

/**
 * Runs one PSI measurement.
 *
 * The 429 handling here is the part worth reading twice: pausing the WHOLE
 * queue rather than only the failing job. With 20 workers in flight, retrying
 * one job while nineteen siblings keep hammering turns a soft rate-limit into
 * a sustained 429 storm.
 */
export async function processAuditPage(job: Job<AuditPageJobData>): Promise<void> {
  const { runId, pageId, url, strategy } = job.data;
  const log = jobLogger(runId, pageId, strategy);

  try {
    const outcome = await auditPage({ prisma, limiter: getPsiRateLimiter() }, { runId, pageId, url, strategy });

    if (!outcome.written) {
      log.info('replay — result already recorded, counter untouched');
      return;
    }

    // The transaction told us this job was the one that completed the run.
    // Deterministic jobId means two workers crossing the line together still
    // enqueue exactly one finalize.
    if (outcome.readyToFinalize) {
      await enqueueFinalizeRun(runId);
    }
  } catch (e) {
    if (e instanceof RetryableError) {
      const wait = e.retryAfterMs;
      if (wait !== undefined) {
        // Pause every worker on this queue, then re-queue without consuming an
        // attempt -- a rate limit is not the job's fault. Note this is
        // queue.rateLimit(), not worker.rateLimit(), which BullMQ v6 deprecated.
        await getAuditQueue().rateLimit(wait);
        throw Worker.RateLimitError();
      }
      throw e; // ordinary retry on the configured backoff
    }

    if (e instanceof PermanentError) {
      // The result row is already written; retrying cannot help (bad key,
      // exhausted quota) and would burn four more attempts per page.
      throw new UnrecoverableError(e.message);
    }

    throw e;
  }
}
