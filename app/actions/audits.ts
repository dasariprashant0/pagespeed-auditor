'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { defaultSite, requireRunAccess } from '@/lib/services/tenant.service';
import { BOTH_STRATEGIES, createRun, expandScope, findActiveRun, failedResultsForRun, type FailedResult } from '@/lib/services/run.service';
import { enqueueAuditJobs } from '@/lib/queue/producers';
import { estimateRun, formatDuration } from '@/lib/services/estimate.service';
import type { PsiStrategy } from '@/lib/services/types';

export type QueueResult =
  | { ok: true; runId: string; jobs: number; eta: string; measured: boolean }
  | { ok: false; error: string };

/**
 * Queues an on-demand audit for one page or one group.
 *
 * Always queued, never run inline. The spec allows a synchronous path for small
 * jobs, but measured PSI latency on this site is ~60 s per call -- so even a
 * single page in both strategies is a two-minute request that would sit past
 * most proxy timeouts. Queuing costs one poll and behaves identically at any
 * size.
 *
 * There is deliberately NO whole-site variant: sweeps are schedule-only.
 * See docs/DECISIONS.md 2.2.
 */
export async function queueAuditAction(input: {
  kind: 'page' | 'group';
  ref: string;
  strategies?: PsiStrategy[];
}): Promise<QueueResult> {
  // Server Actions are public HTTP endpoints regardless of what proxy.ts
  // matches, so this is the actual authorization boundary. Running audits
  // spends the organisation's PSI quota, so a viewer must not be able to.
  const ctx = await requireCapability('audits:run');

  const site = await defaultSite(ctx.organizationId);
  if (!site) return { ok: false, error: 'No site configured.' };

  const strategies = input.strategies?.length ? input.strategies : BOTH_STRATEGIES;
  const scope = { kind: input.kind, ref: input.ref, strategies };

  // One run at a time per site. Two concurrent runs would share the rate
  // limiter and each appear stalled for twice as long.
  const active = await findActiveRun(prisma, site.id);
  if (active) {
    return { ok: false, error: `Another audit is already running (${active.type}). Wait for it to finish.` };
  }

  const pairs = await expandScope(prisma, site.id, scope);
  if (pairs.length === 0) return { ok: false, error: 'Nothing to audit here.' };

  const runId = await createRun(prisma, {
    siteId: site.id,
    type: input.kind,
    triggeredBy: 'manual',
    scope,
    totalJobs: pairs.length,
  });

  await enqueueAuditJobs(runId, pairs);

  const estimate = await estimateRun(pairs.length, site.id);
  revalidatePath('/', 'layout');

  return {
    ok: true,
    runId,
    jobs: pairs.length,
    eta: formatDuration(estimate.seconds),
    measured: estimate.measured,
  };
}

/**
 * Re-measure only the pages a run could not measure.
 *
 * A separate run rather than a mutation of the old one: the original stays in
 * the history exactly as it happened, and the retry gets its own progress bar
 * and its own outcome. Its scope is pinned to the failed pairs of that run, so
 * it cannot quietly widen into a second full sweep if the sitemap has grown --
 * which is a mistake this codebase has already made once, on resume.
 */
export async function retryFailedAction(input: { runId: string }): Promise<QueueResult> {
  const ctx = await requireCapability('audits:run');
  await requireRunAccess(ctx.organizationId, input.runId);

  const site = await defaultSite(ctx.organizationId);
  if (!site) return { ok: false, error: 'No site configured.' };

  const active = await findActiveRun(prisma, site.id);
  if (active) {
    return { ok: false, error: 'Something is already running. Wait for it to finish, then retry.' };
  }

  const scope = { kind: 'retry' as const, ref: input.runId, strategies: BOTH_STRATEGIES };
  const pairs = await expandScope(prisma, site.id, scope);
  if (pairs.length === 0) {
    return { ok: false, error: 'Nothing left to retry — those pages are no longer in your sitemap.' };
  }

  const runId = await createRun(prisma, {
    siteId: site.id,
    type: 'group',
    triggeredBy: 'manual',
    scope,
    totalJobs: pairs.length,
  });

  await enqueueAuditJobs(runId, pairs);

  const estimate = await estimateRun(pairs.length, site.id);
  revalidatePath('/', 'layout');

  return {
    ok: true,
    runId,
    jobs: pairs.length,
    eta: formatDuration(estimate.seconds),
    measured: estimate.measured,
  };
}

/** The pages a run could not measure, for the failures panel. */
export async function failedResultsAction(input: {
  runId: string;
}): Promise<{ ok: true; failures: FailedResult[] } | { ok: false; error: string }> {
  const ctx = await requireCapability('reports:read');
  await requireRunAccess(ctx.organizationId, input.runId);
  try {
    return { ok: true, failures: await failedResultsForRun(prisma, input.runId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not load the failures.' };
  }
}
