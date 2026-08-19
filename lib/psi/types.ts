/**
 * Narrow hand-written types for the parts of the PSI v5 response we consume.
 *
 * Deliberately not exhaustive: the real response has ~150 audits and a lot of
 * shape we never touch. Everything here was verified against recorded fixtures
 * from Lighthouse 13.4.1 (see test/fixtures/psi/), not from documentation.
 */

export type PsiStrategy = 'mobile' | 'desktop';

/** Our internal, normalized rating. PSI's own vocabularies map onto this. */
export type Bucket = 'good' | 'ni' | 'poor';

/** The five metrics we track. INP is field-only -- see extractLab(). */
export type MetricId = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb';

/**
 * Whether field data describes THIS url, the whole origin, or is absent.
 *
 * 'origin_fallback' matters: CrUX substitutes origin-wide data when a page has
 * too little traffic. Showing that as page data makes a thin page look great on
 * numbers borrowed from the homepage.
 */
export type FieldSource = 'page' | 'origin_fallback' | 'none';

export interface PsiAuditDetailHeading {
  key?: string | null;
  /** LH10+ */ label?: string;
  /** LH9  */ text?: string;
  /** LH10+ */ valueType?: string;
  /** LH9  */ itemType?: string;
}

export interface PsiAuditDetails {
  type?: string;
  headings?: PsiAuditDetailHeading[];
  items?: Array<Record<string, unknown>>;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
}

export interface PsiAudit {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  numericUnit?: string;
  details?: PsiAuditDetails;
  /** LH13's real savings signal. overallSavingsMs is usually null or 0. */
  metricSavings?: { LCP?: number; FCP?: number; CLS?: number; TBT?: number };
}

export interface PsiAuditRef {
  id: string;
  weight: number;
  /** 'metrics' | 'insights' | 'diagnostics' | 'hidden' | a11y/seo subgroups | undefined */
  group?: string;
  acronym?: string;
}

export interface PsiCategory {
  id?: string;
  title?: string;
  /** 0..1, or null when the category failed to run. null != 0. */
  score?: number | null;
  auditRefs?: PsiAuditRef[];
}

export interface PsiLighthouseResult {
  requestedUrl?: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  mainDocumentUrl?: string;
  lighthouseVersion?: string;
  fetchTime?: string;
  runWarnings?: unknown[];
  runtimeError?: { code?: string; message?: string };
  audits?: Record<string, PsiAudit>;
  categories?: Record<string, PsiCategory>;
  categoryGroups?: Record<string, { title?: string; description?: string }>;
  timing?: unknown;
  entities?: unknown;
  fullPageScreenshot?: unknown;
}

export interface PsiCruxMetric {
  /** In the metric's natural unit -- EXCEPT CLS, which is the real value x100. */
  percentile?: number;
  /** Observed as FAST | AVERAGE | SLOW. CrUX proper also emits GOOD/NEEDS_IMPROVEMENT/POOR. */
  category?: string;
  distributions?: Array<{ min?: number; max?: number; proportion?: number }>;
}

export interface PsiLoadingExperience {
  id?: string;
  initial_url?: string;
  overall_category?: string;
  metrics?: Record<string, PsiCruxMetric>;
  /**
   * ABSENT (not false) on page-level data -- treat undefined as "not a fallback".
   */
  origin_fallback?: boolean;
}

export interface PsiResponse {
  kind?: string;
  id?: string;
  analysisUTCTimestamp?: string;
  loadingExperience?: PsiLoadingExperience;
  originLoadingExperience?: PsiLoadingExperience;
  lighthouseResult?: PsiLighthouseResult;
}

// ---------------------------------------------------------------------------
// Extracted shapes -- what the rest of the system actually consumes.
// ---------------------------------------------------------------------------

export interface ExtractedScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface ExtractedLab {
  lcp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  /** Lab INP. Absent on every real page observed; kept for completeness. */
  inp: number | null;
  /** The lab proxy for responsiveness. NEVER store this in `inp`. */
  tbt: number | null;
  speedIndex: number | null;
}

export interface ExtractedFieldMetric {
  value: number;
  bucket: Bucket;
  /** proportions [good, needs-improvement, poor] */
  distribution: [number, number, number] | null;
}

export interface ExtractedField {
  source: FieldSource;
  overall: Bucket | null;
  metrics: Partial<Record<MetricId, ExtractedFieldMetric>>;
}

export type IssueKind = 'opportunity' | 'diagnostic' | 'other';

export interface ExtractedAudit {
  auditId: string;
  title: string;
  description: string;
  category: 'performance' | 'accessibility' | 'best-practices' | 'seo';
  kind: IssueKind;
  score: number | null;
  scoreDisplayMode: string;
  displayValue: string | null;
  /** Milliseconds only. CLS savings are unitless and excluded by design. */
  savingsMs: number | null;
  savingsBytes: number | null;
  weight: number;
}

export interface ExtractedResult {
  status: 'ok' | 'error';
  runtimeError: string | null;
  finalUrl: string | null;
  lighthouseVersion: string | null;
  fetchTime: string | null;
  scores: ExtractedScores;
  lab: ExtractedLab;
  field: ExtractedField;
  audits: ExtractedAudit[];
}
