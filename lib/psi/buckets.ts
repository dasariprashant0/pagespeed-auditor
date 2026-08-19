import type { Bucket, MetricId } from './types.ts';

/**
 * Core Web Vitals thresholds (web.dev / Chrome's published boundaries).
 * `good` when v <= good; `poor` when v > poor; otherwise `ni`.
 *
 * TBT is not a Core Web Vital but is shown as the lab proxy for INP, so it has
 * thresholds here too. It is deliberately NOT in MetricId -- nothing should be
 * able to accidentally run the INP bucket rule against a TBT value.
 */
export const THRESHOLDS: Record<MetricId | 'tbt', { good: number; poor: number; unit: 'ms' | 'unitless' }> = {
  lcp: { good: 2500, poor: 4000, unit: 'ms' },
  inp: { good: 200, poor: 500, unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, unit: 'unitless' },
  fcp: { good: 1800, poor: 3000, unit: 'ms' },
  ttfb: { good: 800, poor: 1800, unit: 'ms' },
  tbt: { good: 200, poor: 600, unit: 'ms' },
};

export function bucketOf(metric: MetricId | 'tbt', value: number | null | undefined): Bucket | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const t = THRESHOLDS[metric];
  if (value <= t.good) return 'good';
  if (value > t.poor) return 'poor';
  return 'ni';
}

/** Ordering for "did this get worse?" comparisons. */
export const BUCKET_RANK: Record<Bucket, number> = { good: 0, ni: 1, poor: 2 };

export function isWorse(a: Bucket, b: Bucket): boolean {
  return BUCKET_RANK[a] > BUCKET_RANK[b];
}

/**
 * PSI emits two different vocabularies for the same idea, and which one you get
 * depends on the field. Observed in fixtures: both per-metric `category` and
 * `overall_category` use FAST/AVERAGE/SLOW. The CrUX API proper uses
 * GOOD/NEEDS_IMPROVEMENT/POOR. Accept both rather than betting on one.
 */
export function bucketFromCruxCategory(category: string | null | undefined): Bucket | null {
  switch (category?.toUpperCase()) {
    case 'FAST':
    case 'GOOD':
      return 'good';
    case 'AVERAGE':
    case 'NEEDS_IMPROVEMENT':
      return 'ni';
    case 'SLOW':
    case 'POOR':
      return 'poor';
    default:
      return null;
  }
}

/** PSI's own score bands: red <50, orange 50-89, green 90+. */
export type ScoreBand = 'fail' | 'average' | 'pass';

export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score < 50) return 'fail';
  if (score < 90) return 'average';
  return 'pass';
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  good: 'Good',
  ni: 'Needs improvement',
  poor: 'Poor',
};
