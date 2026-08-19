'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { BOTH_STRATEGIES, createRun, expandScope, findActiveRun } from '@/lib/services/run.service';
import { enqueueAuditJobs } from '@/lib/queue/producers';
import type { PsiStrategy } from '@/lib/services/types';

export type QueueResult =
  | { ok: true; runId: string; jobs: number; etaMinutes: number }
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
  // matches, so this is the actual authorization boundary.
  await requireSession();

  const env = getEnv();
  const site = await prisma.site.findFirst({ select: { id: true } });
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

  const rate = (env.PSI_RATE_MAX / env.PSI_RATE_WINDOW_MS) * 1000;
  revalidatePath('/', 'layout');

  return { ok: true, runId, jobs: pairs.length, etaMinutes: Math.max(1, Math.ceil(pairs.length / rate / 60)) };
}
