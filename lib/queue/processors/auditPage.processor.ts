import type { Job } from 'bullmq';
import { UnrecoverableError, Worker } from 'bullmq';
import { prisma } from '../../db.ts';
import { PermanentError, RetryableError } from '../../errors.ts';
import { jobLogger } from '../../logger.ts';
import { auditPage, errorResultFor, recordAuditResult } from '../../services/audit.service.ts';
import { buildMarkdownReport } from '../../report/markdown.ts';
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
      // LAST ATTEMPT. Letting BullMQ simply fail the job here is what hung a
      // run at 99/100: no result row is written, so completedJobs can never
      // reach totalJobs and the run never finalizes. Record the failure as a
      // result instead -- an unreachable page is a real finding, and the run
      // has to be able to end.
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts - 1) {
        log.error({ attempts, message: e.message }, 'retries exhausted — recording an error row');
        const extracted = errorResultFor('RETRIES_EXHAUSTED');
        const outcome = await recordAuditResult(prisma, {
          runId, pageId, url, strategy,
          extracted,
          rawJson: null,
          fieldJson: null,
          markdownReport: buildMarkdownReport({
            url, strategy, generatedAt: new Date(), result: extracted,
          }),
          isFailure: true,
        });
        if (outcome.readyToFinalize) await enqueueFinalizeRun(runId);
        return;
      }

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
