import { sleep } from 'workflow';
import { start } from 'workflow/api';
import { getTenantPrisma } from '../db/tenant.ts';
import { d1CredentialsForOrg } from '../services/org.service.ts';
import { getEnv } from '../env.ts';
import { jobLogger } from '../logger.ts';
import { getPsiRateLimiter, pushRunLogEvent } from '../opsState.ts';
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
async function auditOnePageStep(
  organizationId: string,
  runId: string,
  pageId: string,
  url: string,
  strategy: PsiStrategy,
): Promise<void> {
  'use step';
  const log = jobLogger(runId, pageId, strategy);
  const maxAttempts = getEnv().PSI_MAX_ATTEMPTS;
  const prisma = await getTenantPrisma(organizationId);
  const d1 = (await d1CredentialsForOrg(organizationId)) ?? undefined;

  // For the live "what's running" terminal view only -- awaited so a
  // container frozen right after this step returns can't drop it (a
  // fire-and-forget call has no such guarantee in a serverless runtime), but
  // pushRunLogEvent swallows its own errors, so it can never fail the audit.
  await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'start', pageId, url, strategy });

  for (let attempt = 1; ; attempt++) {
    try {
      const outcome = await auditPage(
        { prisma, limiter: await getPsiRateLimiter(organizationId), organizationId, d1 },
        { runId, pageId, url, strategy },
      );
      if (!outcome.written) {
        log.info('replay — result already recorded, counter untouched');
        return;
      }
      await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'ok', pageId, url, strategy });
      if (outcome.readyToFinalize) await finalizeAndNotify(organizationId, runId);
      return;
    } catch (e) {
      if (e instanceof PermanentError) {
        // Recorded as a result, the same as the exhausted-retries branch
        // below and for the same reason: returning here without writing
        // anything means completedJobs/failedJobs never advance for this
        // job. shouldFinalize() only cares about completedJobs, so that's
        // "just never finalizes" -- survivable. But finalizeRun()'s
        // completed-vs-failed test is failedJobs >= totalJobs, and THAT
        // silently reads as "everything's fine" once the reconcile
        // backstop finalizes a run stuck at 0 completed for other reasons
        // -- a run where every page hit this exact branch reported
        // 'completed' with 0/2, not 'failed'. Observed live 21 Aug 2026.
        log.error({ message: e.message }, 'permanent failure — recording an error row, not retrying');
        await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'error', pageId, url, strategy, message: e.message });
        const extracted = errorResultFor(e.message);
        const outcome = await recordAuditResult(prisma, {
          runId, pageId, url, strategy,
          extracted, rawJson: null, fieldJson: null,
          markdownReport: buildMarkdownReport({ url, strategy, generatedAt: new Date(), result: extracted }),
          isFailure: true,
        }, d1);
        if (outcome.readyToFinalize) await finalizeAndNotify(organizationId, runId);
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
        await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'error', pageId, url, strategy, message });
        const extracted = errorResultFor('RETRIES_EXHAUSTED');
        const outcome = await recordAuditResult(prisma, {
          runId, pageId, url, strategy,
          extracted, rawJson: null, fieldJson: null,
          markdownReport: buildMarkdownReport({ url, strategy, generatedAt: new Date(), result: extracted }),
          isFailure: true,
        }, d1);
        if (outcome.readyToFinalize) await finalizeAndNotify(organizationId, runId);
        return;
      }

      const wait = e instanceof RetryableError ? (e.retryAfterMs ?? backoffMs(attempt)) : backoffMs(attempt);
      const message = e instanceof Error ? e.message : String(e);
      await pushRunLogEvent(organizationId, runId, { ts: Date.now(), kind: 'retry', pageId, url, strategy, message: `${message} — retrying in ${Math.round(wait / 1000)}s` });
      await sleepMs(wait);
    }
  }
}

async function readRunStatusStep(organizationId: string, runId: string): Promise<string | null> {
  'use step';
  const prisma = await getTenantPrisma(organizationId);
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
  return run?.status ?? null;
}

/** Backstop: finalizes a run left 'running'/'queued' that nothing else finalized. */
async function reconcileIfNeededStep(organizationId: string, runId: string): Promise<void> {
  'use step';
  const prisma = await getTenantPrisma(organizationId);
  const run = await prisma.auditRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run && (run.status === 'running' || run.status === 'queued')) {
    await finalizeAndNotify(organizationId, runId);
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
 *
 * `organizationId` is LAST here (and on `startAuditRun` below), unlike every
 * other function in this file, which all take it first. Deliberate, not an
 * oversight: `[runId, pairs, batchSize, organizationId]` is Vercel Workflow's
 * persisted argument list, and appending the new parameter at the end
 * minimizes the diff against what shipped before this parameter existed.
 */
export async function auditRunWorkflow(
  runId: string,
  pairs: AuditPair[],
  batchSize: number,
  organizationId: string,
): Promise<void> {
  'use workflow';

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map((p) => auditOnePageStep(organizationId, runId, p.pageId, p.url, p.strategy)),
    );

    let status = await readRunStatusStep(organizationId, runId);
    if (status !== 'running' && status !== 'paused') return; // cancelled, or already terminal

    // Mirrors BullMQ's queue.pause(): nothing new starts while paused, but
    // the batch just above had already been dispatched and is left to finish.
    // sleep() suspends for free (no compute charged) while held, so this
    // costs nothing during a long hold -- unlike an actual poll loop would.
    while (status === 'paused') {
      await sleep('20s');
      status = await readRunStatusStep(organizationId, runId);
      if (status !== 'running' && status !== 'paused') return;
    }
  }

  await reconcileIfNeededStep(organizationId, runId);
}

/** Starts (or restarts, for a resume) the run's audit workflow. */
export async function startAuditRun(runId: string, pairs: AuditPair[], organizationId: string): Promise<void> {
  const batchSize = getEnv().WORKER_CONCURRENCY;
  await start(auditRunWorkflow, [runId, pairs, batchSize, organizationId]);
}
