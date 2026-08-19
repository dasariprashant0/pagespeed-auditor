import { bucketFromCruxCategory } from './buckets.ts';
import type {
  ExtractedAudit,
  ExtractedField,
  ExtractedFieldMetric,
  ExtractedLab,
  ExtractedResult,
  ExtractedScores,
  FieldSource,
  IssueKind,
  MetricId,
  PsiAudit,
  PsiLoadingExperience,
  PsiResponse,
} from './types.ts';

/**
 * Turns a raw PSI v5 response into the flat shape the rest of the system stores.
 *
 * Pure and total: it never throws on a well-formed-but-sparse response, because
 * "this page has no field data" and "this category failed to run" are normal
 * states, not errors. Verified against recorded Lighthouse 13.4.1 fixtures.
 */

// --- scores ----------------------------------------------------------------

/** PSI reports 0..1 floats; we store 0..100 ints. null means "did not run". */
function pct(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return Math.round(score * 100);
}

export function extractScores(res: PsiResponse): ExtractedScores {
  const c = res.lighthouseResult?.categories ?? {};
  return {
    performance: pct(c.performance?.score),
    accessibility: pct(c.accessibility?.score),
    // Request param is BEST_PRACTICES; response key is hyphenated. Bracket access
    // is required, and it defeats TS's dotted-property inference.
    bestPractices: pct(c['best-practices']?.score),
    seo: pct(c.seo?.score),
  };
}

// --- lab metrics -----------------------------------------------------------

function numeric(audits: Record<string, PsiAudit> | undefined, id: string): number | null {
  const v = audits?.[id]?.numericValue;
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

export function extractLab(res: PsiResponse): ExtractedLab {
  const a = res.lighthouseResult?.audits;
  return {
    lcp: numeric(a, 'largest-contentful-paint'),
    cls: numeric(a, 'cumulative-layout-shift'),
    fcp: numeric(a, 'first-contentful-paint'),
    ttfb: numeric(a, 'server-response-time'),
    // INP is a FIELD metric. Lighthouse lab runs do not produce it -- absent on
    // every fixture recorded. Read it defensively in case a future LH adds it,
    // but never substitute TBT here: that silently poisons every trend and
    // regression comparison, because TBT values would be compared against INP
    // thresholds.
    inp: numeric(a, 'interaction-to-next-paint'),
    tbt: numeric(a, 'total-blocking-time'),
    speedIndex: numeric(a, 'speed-index'),
  };
}

// --- field (CrUX) data -----------------------------------------------------

/** PSI's CrUX metric keys -> our MetricId. */
const CRUX_KEYS: Record<string, MetricId> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'lcp',
  INTERACTION_TO_NEXT_PAINT: 'inp',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls',
  FIRST_CONTENTFUL_PAINT_MS: 'fcp',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'ttfb',
};

/**
 * Decides whether field data describes this URL, the origin, or is missing.
 *
 * `origin_fallback` is ABSENT rather than false on page-level data, so
 * `=== true` is the only safe test.
 */
export function fieldSourceOf(le: PsiLoadingExperience | undefined): FieldSource {
  if (!le?.metrics || Object.keys(le.metrics).length === 0) return 'none';
  return le.origin_fallback === true ? 'origin_fallback' : 'page';
}

function distributionOf(m: { distributions?: Array<{ proportion?: number }> }): [number, number, number] | null {
  const d = m.distributions;
  if (!Array.isArray(d) || d.length < 3) return null;
  return [d[0]?.proportion ?? 0, d[1]?.proportion ?? 0, d[2]?.proportion ?? 0];
}

export function extractField(res: PsiResponse): ExtractedField {
  // Prefer page-level data; fall back to the origin block only when the page
  // has none of its own. Both are labelled so the UI can say which it is showing.
  const page = res.loadingExperience;
  const origin = res.originLoadingExperience;

  const pageSource = fieldSourceOf(page);
  const le = pageSource === 'none' ? origin : page;
  const source: FieldSource = pageSource === 'none' ? (fieldSourceOf(origin) === 'none' ? 'none' : 'origin_fallback') : pageSource;

  if (source === 'none' || !le?.metrics) {
    return { source: 'none', overall: null, metrics: {} };
  }

  const metrics: Partial<Record<MetricId, ExtractedFieldMetric>> = {};
  for (const [rawKey, m] of Object.entries(le.metrics)) {
    const id = CRUX_KEYS[rawKey];
    if (!id) continue;
    const p = m.percentile;
    if (typeof p !== 'number' || Number.isNaN(p)) continue;

    // CLS is reported as an integer 100x the real value: percentile 11 == CLS 0.11.
    // Every other metric's percentile is already in its natural unit.
    const value = id === 'cls' ? p / 100 : p;

    const bucket = bucketFromCruxCategory(m.category);
    if (!bucket) continue;

    metrics[id] = { value, bucket, distribution: distributionOf(m) };
  }

  return { source, overall: bucketFromCruxCategory(le.overall_category), metrics };
}

// --- audits (opportunities / diagnostics / other) --------------------------

/**
 * Lighthouse 13 replaced the old `load-opportunities` group with `insights`.
 * Verified in fixtures: the performance category's auditRefs use exactly
 * `metrics`, `insights`, `diagnostics`, `hidden`.
 */
function perfKind(group: string | undefined, details: PsiAudit['details']): IssueKind | null {
  switch (group) {
    case 'insights':
      return 'opportunity';
    case 'diagnostics':
      return 'diagnostic';
    case 'metrics':
      // Already stored as first-class columns; would double-count as an issue.
      return null;
    case 'hidden': {
      // Not blanket-skippable: `layout-shifts` lives here, scores 0, and carries
      // real CLS savings. But so do the screenshots and debug payloads. Keep the
      // ones that render as tables, drop the media.
      const t = details?.type;
      return t === 'table' || t === 'opportunity' ? 'diagnostic' : null;
    }
    default:
      return null; // ungrouped / budgets -> informational
  }
}

/** Modes that represent a real pass/fail judgement. */
const SCORED_MODES = new Set(['binary', 'numeric', 'metricSavings']);

/** Lighthouse's own pass threshold. */
const PASS_THRESHOLD = 0.9;

function savingsMsOf(a: PsiAudit): number | null {
  // In LH13 details.overallSavingsMs is null or 0 almost everywhere; the real
  // signal moved to metricSavings. CLS is deliberately excluded -- it is
  // unitless and must not be summed into a millisecond total.
  const ms = a.metricSavings ?? {};
  const candidates = [ms.LCP, ms.FCP, ms.TBT, a.details?.overallSavingsMs].filter(
    (v): v is number => typeof v === 'number' && v > 0,
  );
  return candidates.length ? Math.max(...candidates) : null;
}

export function extractAudits(res: PsiResponse): ExtractedAudit[] {
  const lr = res.lighthouseResult;
  const audits = lr?.audits;
  const categories = lr?.categories;
  if (!audits || !categories) return [];

  const out: ExtractedAudit[] = [];
  const seen = new Set<string>();

  const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

  for (const catId of CATEGORIES) {
    const refs = categories[catId]?.auditRefs ?? [];

    for (const ref of refs) {
      const a = audits[ref.id];
      if (!a) continue;

      const mode = a.scoreDisplayMode ?? '';
      if (!SCORED_MODES.has(mode)) continue;
      if (a.score === null || a.score === undefined) continue;
      if (a.score >= PASS_THRESHOLD) continue;

      let kind: IssueKind | null;
      if (catId === 'performance') {
        kind = perfKind(ref.group, a.details);
      } else {
        // a11y / best-practices / SEO use many sub-groups (a11y-aria, seo-crawl,
        // ...) with no flat opportunity/diagnostic split. Trying to map them is
        // pointless; a failing scored audit is simply an issue.
        kind = 'other';
      }
      if (!kind) continue;

      // An audit can appear in more than one category's refs; keep the first.
      const key = `${catId}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        auditId: ref.id,
        title: a.title ?? ref.id,
        description: a.description ?? '',
        category: catId,
        kind,
        score: a.score,
        scoreDisplayMode: mode,
        displayValue: a.displayValue ?? null,
        savingsMs: savingsMsOf(a),
        savingsBytes:
          typeof a.details?.overallSavingsBytes === 'number' ? a.details.overallSavingsBytes : null,
        // weight is 0 for every insight and diagnostic in LH13 -- captured for
        // completeness, but it is useless as a sort key. Rank by savings, then
        // by score ascending.
        weight: ref.weight ?? 0,
      });
    }
  }

  out.sort((x, y) => (y.savingsMs ?? 0) - (x.savingsMs ?? 0) || (x.score ?? 1) - (y.score ?? 1));
  return out;
}

// --- top level -------------------------------------------------------------

export function extractResult(res: PsiResponse): ExtractedResult {
  const lr = res.lighthouseResult;
  const runtimeError = lr?.runtimeError?.code ?? null;

  // A runtimeError means Lighthouse could not measure the page (it 4xx'd, never
  // painted, ...). That is a real, storable outcome -- not a transport failure --
  // so it gets an error row with null scores rather than being retried.
  if (runtimeError) {
    return {
      status: 'error',
      runtimeError,
      finalUrl: lr?.finalDisplayedUrl ?? lr?.finalUrl ?? lr?.requestedUrl ?? null,
      lighthouseVersion: lr?.lighthouseVersion ?? null,
      fetchTime: lr?.fetchTime ?? null,
      scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
      lab: { lcp: null, cls: null, fcp: null, ttfb: null, inp: null, tbt: null, speedIndex: null },
      field: { source: 'none', overall: null, metrics: {} },
      audits: [],
    };
  }

  return {
    status: 'ok',
    runtimeError: null,
    finalUrl: lr?.finalDisplayedUrl ?? lr?.finalUrl ?? lr?.requestedUrl ?? null,
    lighthouseVersion: lr?.lighthouseVersion ?? null,
    fetchTime: lr?.fetchTime ?? null,
    scores: extractScores(res),
    lab: extractLab(res),
    field: extractField(res),
    audits: extractAudits(res),
  };
}

/** The ~2 KB field blob worth keeping on the row, without the full response. */
export function fieldJsonOf(res: PsiResponse): unknown {
  if (!res.loadingExperience && !res.originLoadingExperience) return null;
  return {
    loadingExperience: res.loadingExperience ?? null,
    originLoadingExperience: res.originLoadingExperience ?? null,
  };
}
