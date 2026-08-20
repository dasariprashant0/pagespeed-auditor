import { sleep } from 'workflow';
import { start } from 'workflow/api';
import { prisma } from '../db.ts';
import { getEnv } from '../env.ts';
import { jobLogger } from '../logger.ts';
import { getPsiRateLimiter } from '../redis.ts';
import { auditPage, errorResultFor, recordAuditResult } from '../services/audit.service.ts';
import { buildMarkdownReport } from '../report/markdown.ts';
import { RetryableError, PermanentError } from '../errors.ts';
import { backoffMs } from '../psi/client.ts';
import type { PsiStrategy } from '../psi/types.ts';
import type { AuditPair } from '../services/run.service.ts';
import { finalizeAndNotify } from './finalize.ts';

/**
 * Replaces lib/queue/* (BullMQ). One durable workflow run per AuditRun,
 * instead of a standalone `npm run worker` process -- see docs/DECISIONS.md
 * for why (Vercel can't host a persistent process, and separately, Upstash
 * was never reliably BullMQ-compatible to begin with).
 *
 * What carries over unchanged: auditPage()/recordAuditResult() in
 * audit.service.ts (the actual PSI call + write), and the shared
 * PsiRateLimiter (still the thing that paces requests, not this file).
 *
 * What's different: retries that used to be BullMQ re-running the whole job
 * are now an explicit loop inside one step (auditOnePageStep) -- Workflow's
 * own step retry is unused for the RetryableError path on purpose, so the
 * "record an error row on the last attempt" behaviour stays exactly as
 * specific as it was.
 */

export type { AuditPair };

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(ms, 0), 15 * 60_000)));
}

/** One (page, strategy) measurement, with its own retry loop. */
async function auditOnePageStep(runId: string, pageId: string, url: string, strategy: PsiStrategy): Promise<void> {
  'use step';
  const log = jobLogger(runId, pageId, strategy);
  const maxAttempts = getEnv().PSI_MAX_ATTEMPTS;

  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await auditPage({ prisma, limiter: getPsiRateLimiter() }, { runId, pageId, url, strategy });
      if (!outcome.written) {
        log.info('replay — result already recorded, counter untouched');
        return;
      }
      if (outcome.readyToFinalize) await finalizeAndNotify(runId);
      return;
    } catch (e) {
      if (e instanceof PermanentError) {
        log.error({ message: e.message }, 'permanent failure — not retrying');
        return;
      }

      const isLastAttempt = attempt >= maxAttempts;

      if (isLastAttempt) {
        // LAST ATTEMPT. Recording a failure as a result instead of just
        // letting this throw is what keeps a run from hanging one job short
        // of finalizing forever -- an unreachable page is a real finding,
        // whatever kind of error caused it. This used to only cover
        // RetryableError; anything else (e.g. a rate-limiter/Redis blip) fell
        // through to a bare throw, which Promise.allSettled in
        // auditRunWorkflow swallows silently -- the page just vanished from
        // the run's count instead of showing up as a tracked failure.
        const message = e instanceof Error ? e.message : String(e);
        log.error({ attempts: attempt, message }, 'retries exhausted — recording an error row');
        const extracted = errorResultFor('RETRIES_EXHAUSTED');
        const outcome = await recordAuditResult(prisma, {
          runId, pageId, url, strategy,
          extracted, rawJson: null, fieldJson: null,
          markdownReport: buildMarkdownReport({ url, strategy, generatedAt: new Date(), result: extracted }),
          isFailure: true,
        });
        if (outcome.readyToFinalize) await finalizeAndNotify(runId);
        return;
      }

      const wait = e instanceof RetryableError ? (e.retryAfterMs ?? backoffMs(attempt)) : backoffMs(attempt);
      await sleepMs(wait);
    }
  }
}

async function readRunStatusStep(runId: string): Promise<string | null> {
  'use step';
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
  return run?.status ?? null;
}

/** Backstop: finalizes a run left 'running'/'queued' that nothing else finalized. */
async function reconcileIfNeededStep(runId: string): Promise<void> {
  'use step';
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run && (run.status === 'running' || run.status === 'queued')) {
    await finalizeAndNotify(runId);
  }
}

/**
 * Orchestrates one run: dispatch pages in batches (replaces
 * WORKER_CONCURRENCY), observe pause/stop at each batch boundary (replaces
 * queue.pause()/drain()), finalize once everything has reported.
 *
 * This function itself runs in a sandboxed VM -- no Node built-ins, no fetch,
 * no setTimeout. All real work happens in the "use step" functions above;
 * this only orchestrates them.
 */
export async function auditRunWorkflow(runId: string, pairs: AuditPair[], batchSize: number): Promise<void> {
  'use workflow';

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((p) => auditOnePageStep(runId, p.pageId, p.url, p.strategy)));

    let status = await readRunStatusStep(runId);
    if (status !== 'running' && status !== 'paused') return; // cancelled, or already terminal

    // Mirrors BullMQ's queue.pause(): nothing new starts while paused, but
    // the batch just above had already been dispatched and is left to finish.
    // sleep() suspends for free (no compute charged) while held, so this
    // costs nothing during a long hold -- unlike an actual poll loop would.
    while (status === 'paused') {
      await sleep('20s');
      status = await readRunStatusStep(runId);
      if (status !== 'running' && status !== 'paused') return;
    }
  }

  await reconcileIfNeededStep(runId);
}

/** Starts (or restarts, for a resume) the run's audit workflow. */
export async function startAuditRun(runId: string, pairs: AuditPair[]): Promise<void> {
  const batchSize = getEnv().WORKER_CONCURRENCY;
  await start(auditRunWorkflow, [runId, pairs, batchSize]);
}
