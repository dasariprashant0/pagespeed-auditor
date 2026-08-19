import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { getEnv } from '../env.ts';
import { logger } from '../logger.ts';
import { prisma } from '../db.ts';
import { backoffMs } from '../psi/client.ts';
import { reconcileStaleRuns } from '../services/run.service.ts';
import { QUEUE_AUDIT, QUEUE_CONTROL, JOB_FINALIZE_RUN, JOB_PLAN_SWEEP } from './names.ts';
import { getRedis, auditJobOptions, closeQueues } from './queues.ts';
import { processAuditPage } from './processors/auditPage.processor.ts';
import { processFinalizeRun } from './processors/finalizeRun.processor.ts';
import { processPlanSweep } from './processors/planSweep.processor.ts';
import type { AuditPageJobData, ControlJobData, FinalizeRunJobData, PlanSweepJobData } from './jobs.ts';

/**
 * The long-running worker process.
 *
 *   npm run worker
 *
 * Cannot be a serverless function: a sweep is ~33 minutes of paced HTTP calls.
 * Run it via tsx -- `next build` does not build this file, and plain `node`
 * would not resolve the TypeScript.
 */

async function main() {
  const env = getEnv();

  const auditWorker = new Worker<AuditPageJobData>(QUEUE_AUDIT, processAuditPage, {
    connection: getRedis(),
    prefix: env.QUEUE_PREFIX,

    // Measured against the real site, not guessed. By Little's Law the
    // in-flight count must be rate x latency for the LIMITER to be what paces
    // the work; if it is lower, the worker pool becomes the bottleneck and the
    // rate silently collapses with nothing in the logs to explain it.
    //
    // www.zuddl.com averages ~60s per PSI call (light pages are 11-24s), so
    // 0.75 req/s x 60s = 45 in flight; the default of 48 gives headroom.
    // Measured counterexamples: at 4 the rate is 0.225 req/s (148-min sweep);
    // at 20 against 60s pages the ceiling is 0.33 req/s (75-min sweep).
    //
    // Raising this does not hit PSI harder -- the token bucket caps the request
    // rate regardless. It only allows more calls to be in flight waiting.
    concurrency: env.WORKER_CONCURRENCY,

    limiter: { max: env.PSI_RATE_MAX, duration: env.PSI_RATE_WINDOW_MS },

    // MUST exceed PSI_TIMEOUT_MS. BullMQ's 30s default is shorter than a slow
    // PSI call, so a still-running job would be declared stalled and
    // re-delivered -- correctness survives via the DB unique constraint, but
    // quota burn quietly doubles. lib/env.ts refuses to boot if this inverts.
    lockDuration: env.QUEUE_LOCK_DURATION_MS,
    stalledInterval: 30_000,
    maxStalledCount: 2,

    settings: {
      backoffStrategy: (attemptsMade: number) => backoffMs(attemptsMade),
    },
  });

  const controlWorker = new Worker<ControlJobData>(
    QUEUE_CONTROL,
    async (job: Job<ControlJobData>) => {
      switch (job.name) {
        case JOB_PLAN_SWEEP:
          return processPlanSweep(job as Job<PlanSweepJobData>);
        case JOB_FINALIZE_RUN:
          return processFinalizeRun(job as Job<FinalizeRunJobData>);
        default:
          logger.warn({ name: job.name }, 'unknown control job');
      }
    },
    { connection: getRedis(), prefix: env.QUEUE_PREFIX, concurrency: 5 },
  );

  for (const [name, w] of [
    ['audit', auditWorker],
    ['control', controlWorker],
  ] as const) {
    w.on('failed', (job, err) =>
      logger.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed'),
    );
    w.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
  }

  // Redis keeps waiting and delayed jobs across a restart, and the stalled
  // checker reclaims active ones -- but neither helps if Redis itself was
  // flushed. This covers that case and any run left 'running' by a hard crash.
  const reconciled = await reconcileStaleRuns(prisma);
  logger.info({ ...reconciled }, 'stale runs reconciled at boot');

  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      rate: `${env.PSI_RATE_MAX}/${env.PSI_RATE_WINDOW_MS}ms`,
      lockDuration: env.QUEUE_LOCK_DURATION_MS,
      attempts: auditJobOptions().attempts,
    },
    'worker ready',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down — letting in-flight jobs finish');
    // close() waits for active jobs rather than killing them mid-PSI-call,
    // so their results are still written and completedJobs stays truthful.
    await Promise.allSettled([auditWorker.close(), controlWorker.close()]);
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.message : String(e) }, 'worker failed to start');
  process.exit(1);
});
