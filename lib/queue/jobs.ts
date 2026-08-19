import type { PsiStrategy } from '../psi/types.ts';

/**
 * Job payloads.
 *
 * Kept deliberately small and denormalized-once: a job may sit in Redis for an
 * hour, so anything read from it must be either immutable (ids) or cheap to
 * re-read (the URL is carried to save a query, and re-checked against the Page
 * row before it is used).
 */

export interface AuditPageJobData {
  runId: string;
  pageId: string;
  /** Carried for logging; the processor re-reads the Page row as the source of truth. */
  url: string;
  strategy: PsiStrategy;
}

export interface PlanSweepJobData {
  siteId: string;
  triggeredBy: 'schedule' | 'manual';
}

export interface FinalizeRunJobData {
  runId: string;
}

export type ControlJobData = PlanSweepJobData | FinalizeRunJobData;
