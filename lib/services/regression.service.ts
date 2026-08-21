import { getTenantPrisma } from '../db/tenant.ts';
import { bucketOf, BUCKET_RANK } from '../psi/buckets.ts';
import type { Bucket, MetricId } from '../psi/types.ts';

/**
 * Regression detection.
 *
 * The rule deliberately does NOT flag every drop. Lighthouse's lab scores
 * fluctuate run to run because throttling is simulated rather than physically
 * reproduced, so a single-run dip is usually noise. Flagging it trains people
 * to ignore the flag, which is worse than not having one.
 *
 * A regression is therefore one of:
 *   (a) a 10+ point drop that PERSISTS across two consecutive audits,
 *   (b) a single-run drop of 20+ points (too large to be throttling noise), or
 *   (c) a Core Web Vital crossing into a worse band and staying there.
 */

export const SUSTAINED_DROP = 10;
export const SINGLE_RUN_DROP = 20;

export type RegressionKind = 'sustained-drop' | 'single-run-drop' | 'cwv-downgrade';

export interface Regression {
  kind: RegressionKind;
  metric: string;
  label: string;
  /** Points for scores; bucket names for CWV. */
  from: string;
  to: string;
  delta: number | null;
  severity: 'warning' | 'critical';
}

export interface ScoreSnapshot {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  inp: number | null;
}

const SCORE_FIELDS = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['bestPractices', 'Best Practices'],
  ['seo', 'SEO'],
] as const;

const CWV_FIELDS = [
  ['lcp', 'LCP'],
  ['cls', 'CLS'],
  ['inp', 'INP'],
  ['fcp', 'FCP'],
  ['ttfb', 'TTFB'],
] as const;

/**
 * Compares up to three consecutive snapshots, newest first.
 *
 * Pure, so the noise rules are testable without a database -- which matters,
 * because the whole point is NOT firing on ordinary variance.
 */
export function detectRegressions(history: ScoreSnapshot[]): Regression[] {
  const [current, previous, older] = history;
  if (!current || !previous) return [];

  const out: Regression[] = [];

  for (const [field, label] of SCORE_FIELDS) {
    const now = current[field];
    const before = previous[field];
    if (now === null || before === null) continue;

    const drop = before - now;

    // (b) A drop this large is not simulated-throttling variance.
    if (drop >= SINGLE_RUN_DROP) {
      out.push({
        kind: 'single-run-drop', metric: field, label,
        from: String(before), to: String(now), delta: -drop, severity: 'critical',
      });
      continue; // don't also report it as sustained
    }

    // (a) Persisted across two audits: it dropped, and it has not recovered.
    if (older) {
      const olderScore = older[field];
      if (olderScore !== null && olderScore - before >= SUSTAINED_DROP && olderScore - now >= SUSTAINED_DROP) {
        out.push({
          kind: 'sustained-drop', metric: field, label,
          from: String(olderScore), to: String(now), delta: now - olderScore, severity: 'warning',
        });
      }
    }
  }

  // (c) A band change that stuck. One run in a worse band is noise; two is real.
  if (older) {
    for (const [field, label] of CWV_FIELDS) {
      const b0 = bucketOf(field as MetricId, current[field]);
      const b1 = bucketOf(field as MetricId, previous[field]);
      const b2 = bucketOf(field as MetricId, older[field]);
      if (!b0 || !b1 || !b2) continue;

      if (BUCKET_RANK[b1] > BUCKET_RANK[b2] && BUCKET_RANK[b0] >= BUCKET_RANK[b1]) {
        out.push({
          kind: 'cwv-downgrade', metric: field, label,
          from: bucketLabel(b2), to: bucketLabel(b0), delta: null,
          severity: b0 === 'poor' ? 'critical' : 'warning',
        });
      }
    }
  }

  return out;
}

function bucketLabel(b: Bucket): string {
  return b === 'good' ? 'Good' : b === 'ni' ? 'Needs improvement' : 'Poor';
}

/** The last three successful audits for a page, newest first. */
export async function regressionsForPage(organizationId: string, pageId: string, strategy: string): Promise<Regression[]> {
  const prisma = await getTenantPrisma(organizationId);
  const rows = await prisma.auditResult.findMany({
    where: { pageId, strategy, status: 'ok' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      performanceScore: true, accessibilityScore: true, bestPracticesScore: true, seoScore: true,
      lcp: true, cls: true, fcp: true, ttfb: true, inp: true,
    },
  });

  return detectRegressions(
    rows.map((r) => ({
      performance: r.performanceScore,
      accessibility: r.accessibilityScore,
      bestPractices: r.bestPracticesScore,
      seo: r.seoScore,
      lcp: r.lcp, cls: r.cls, fcp: r.fcp, ttfb: r.ttfb, inp: r.inp,
    })),
  );
}
