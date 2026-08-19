/**
 * Shared data-transfer shapes for the service layer.
 *
 * Defined in ONE place deliberately: the queue/write side and the dashboard
 * read side are built separately, and without a single source of truth they
 * drift into two nearly-identical PageSummary types that don't quite match.
 *
 * Everything here must be JSON-serializable -- these cross the server/client
 * boundary. rawJson never appears in any of them.
 */

import type { Bucket, PsiStrategy } from '../psi/types.ts';

export type { PsiStrategy, Bucket };

export interface FourScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface SparkPoint {
  /** ISO timestamp. */
  t: string;
  v: number | null;
}

/** Counts of pages by score band, for the distribution bar on a group card. */
export interface ScoreDistribution {
  pass: number;
  average: number;
  fail: number;
  unaudited: number;
}

export interface GroupSummaryDTO {
  id: string;
  slug: string;
  name: string;
  isManual: boolean;
  pageCount: number;
  auditedCount: number;
  /** Mean of the latest performance scores. See docs/DECISIONS.md 2.6. */
  aggregate: FourScores;
  worstPerformance: number | null;
  worstPageId: string | null;
  distribution: ScoreDistribution;
  lastAuditedAt: string | null;
}

export interface PageListItemDTO {
  id: string;
  url: string;
  path: string;
  title: string | null;
  groupSlug: string | null;
  groupName: string | null;
  isActive: boolean;
  scores: FourScores;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  /** True when the latest result is an error row rather than a measurement. */
  hasError: boolean;
  lastAuditedAt: string | null;
}

export interface FieldMetricDTO {
  value: number;
  bucket: Bucket;
  distribution: [number, number, number] | null;
}

export interface FieldDataDTO {
  source: 'page' | 'origin_fallback' | 'none';
  overall: Bucket | null;
  metrics: Partial<Record<'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb', FieldMetricDTO>>;
}

export interface AuditItemDTO {
  auditId: string;
  title: string;
  description: string;
  category: 'performance' | 'accessibility' | 'best-practices' | 'seo';
  kind: 'opportunity' | 'diagnostic' | 'other';
  score: number | null;
  displayValue: string | null;
  savingsMs: number | null;
  savingsBytes: number | null;
}

export interface PageReportDTO {
  page: {
    id: string;
    url: string;
    path: string;
    title: string | null;
    groupSlug: string | null;
    groupName: string | null;
  };
  strategy: PsiStrategy;
  availability: { mobile: boolean; desktop: boolean };
  result: {
    id: string;
    status: 'ok' | 'error';
    runtimeError: string | null;
    fetchedAt: string;
    lighthouseVersion: string | null;
    scores: FourScores;
    previousScores: FourScores | null;
    lab: {
      lcp: number | null;
      inp: number | null;
      cls: number | null;
      fcp: number | null;
      ttfb: number | null;
      tbt: number | null;
      speedIndex: number | null;
    };
    field: FieldDataDTO;
    opportunities: AuditItemDTO[];
    diagnostics: AuditItemDTO[];
    other: AuditItemDTO[];
    markdownReport: string;
  } | null;
  history: Record<'performance' | 'accessibility' | 'bestPractices' | 'seo', SparkPoint[]>;
  recommendation: { content: string; model: string; generatedAt: string } | null;
}

export interface TopIssueDTO {
  auditId: string;
  title: string;
  kind: 'opportunity' | 'diagnostic' | 'other';
  category: string;
  pagesAffected: number;
  pagesTotal: number;
  totalSavingsMs: number | null;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface RunProgressDTO {
  runId: string;
  type: 'full_sweep' | 'group' | 'page';
  triggeredBy: 'schedule' | 'manual';
  status: RunStatus;
  scopeLabel: string | null;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  percentComplete: number;
  startedAt: string | null;
  finishedAt: string | null;
  etaSeconds: number | null;
  error: string | null;
}

export interface SiteSummaryDTO {
  id: string;
  name: string;
  baseUrl: string;
  sitemapUrl: string;
  pageCount: number;
  activePageCount: number;
  groupCount: number;
  auditedCount: number;
  lastSweepAt: string | null;
  siteAverage: FourScores;
}

/**
 * Groups holding fewer than this render collapsed under a single "Small groups"
 * card on the dashboard home. See docs/DECISIONS.md 5.1 -- the real site
 * produces 42 one-page groups, and 68 cards is not a usable home screen.
 * A display constant only: the data model is untouched.
 */
export const SMALL_GROUP_THRESHOLD = 3;
