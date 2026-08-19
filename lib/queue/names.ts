import type { PsiStrategy } from '../psi/types.ts';

/**
 * Queue and job names, plus the deterministic job-id builders.
 *
 * TWO queues, not one. The audit queue carries BullMQ's rate limiter; the
 * control queue does not. If planSweep and finalizeRun shared the audit queue
 * they would consume limiter slots without making a PSI call -- a finalize job
 * would sit behind the 4-second window while the sweep it is finalizing has
 * already stopped. They also must keep running while the audit queue is paused
 * by a 429, which is exactly when a finalize is most likely to be pending.
 */

export const QUEUE_AUDIT = 'audit';
export const QUEUE_CONTROL = 'control';

export const JOB_AUDIT_PAGE = 'audit-page';
export const JOB_PLAN_SWEEP = 'plan-sweep';
export const JOB_FINALIZE_RUN = 'finalize-run';

/**
 * Deterministic ids are the first line of idempotency defence: re-enqueueing
 * the same (run, page, strategy) while the job still exists in Redis is a
 * no-op. It is only the FIRST line -- `removeOnComplete` eventually evicts the
 * job, after which AuditResult's @@unique([auditRunId, pageId, strategy]) is
 * what actually stops a duplicate result being written.
 */
export function auditJobId(runId: string, pageId: string, strategy: PsiStrategy): string {
  return `a:${runId}:${pageId}:${strategy}`;
}

/**
 * One id per run, so two workers crossing the completedJobs threshold at the
 * same instant enqueue the same job rather than finalizing twice.
 */
export function finalizeJobId(runId: string): string {
  return `f:${runId}`;
}

/** One id per site per scheduled tick, so a double-fired cron plans once. */
export function planSweepJobId(siteId: string, at: Date): string {
  return `p:${siteId}:${at.toISOString().slice(0, 16)}`;
}
