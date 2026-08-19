import { prisma } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import { bucketOf } from '../psi/buckets.ts';
import type { Bucket, MetricId, PsiStrategy } from '../psi/types.ts';
import { issueKindFromGroup } from './issues.service.ts';
import { getPageScoreHistory } from './results.service.ts';
import type { AuditItemDTO, FieldDataDTO, FieldMetricDTO, PageReportDTO } from './types.ts';

/**
 * The single-page report view.
 *
 * This is the one place in the read layer that may touch rawJson, and only for
 * one row, only for audit descriptions, and only when asked. Everything else --
 * scores, metrics, field data, the issue lists -- comes from real columns and
 * the AuditIssue side table.
 */

// ---------------------------------------------------------------------------
// Field data
// ---------------------------------------------------------------------------

/**
 * Same mapping as lib/psi/extract.ts uses on the write side. Duplicated rather
 * than imported because extract.ts does not export it; if that changes, delete
 * this copy.
 */
const CRUX_KEYS: Record<string, MetricId> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'lcp',
  INTERACTION_TO_NEXT_PAINT: 'inp',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls',
  FIRST_CONTENTFUL_PAINT_MS: 'fcp',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'ttfb',
};

export interface FieldColumns {
  fieldSource: string | null;
  fieldOverall: string | null;
  fieldLcp: number | null;
  fieldInp: number | null;
  fieldCls: number | null;
  fieldFcp: number | null;
  fieldTtfb: number | null;
}

const BUCKETS: readonly Bucket[] = ['good', 'ni', 'poor'];

/** [good, needs-improvement, poor] proportions, pulled out of the trimmed blob. */
function distributionsFromJson(fieldJson: unknown): Partial<Record<MetricId, [number, number, number]>> {
  const out: Partial<Record<MetricId, [number, number, number]>> = {};
  if (typeof fieldJson !== 'object' || fieldJson === null) return out;

  const metrics = (fieldJson as { metrics?: unknown }).metrics;
  if (typeof metrics !== 'object' || metrics === null) return out;

  for (const [rawKey, raw] of Object.entries(metrics as Record<string, unknown>)) {
    // Accept the CrUX key or our own short id -- the blob is trimmed by the
    // writer and should not dictate the reader's shape.
    const id = CRUX_KEYS[rawKey] ?? (['lcp', 'inp', 'cls', 'fcp', 'ttfb'].includes(rawKey) ? (rawKey as MetricId) : undefined);
    if (!id || typeof raw !== 'object' || raw === null) continue;

    const d = (raw as { distributions?: unknown }).distributions;
    if (!Array.isArray(d) || d.length < 3) continue;

    out[id] = [0, 1, 2].map((i) => {
      const p = (d[i] as { proportion?: unknown } | undefined)?.proportion;
      return typeof p === 'number' ? p : 0;
    }) as [number, number, number];
  }
  return out;
}

/**
 * Builds the field block from the real columns, taking only the distribution
 * bars out of the JSON blob.
 *
 * The columns are the source of truth because a 90-day trend pulls thousands of
 * rows and a JSON path extraction cannot use an index (docs/PLAN.md schema
 * notes). Note fieldCls is stored ALREADY divided by 100.
 *
 * source 'none' is a normal state -- CrUX needs ~28 days of traffic before it
 * reports on a specific URL -- so it must never be surfaced as an error.
 */
export function buildFieldData(cols: FieldColumns, fieldJson?: unknown): FieldDataDTO {
  const source: FieldDataDTO['source'] =
    cols.fieldSource === 'page' || cols.fieldSource === 'origin_fallback' ? cols.fieldSource : 'none';

  if (source === 'none') return { source: 'none', overall: null, metrics: {} };

  const overall = BUCKETS.includes(cols.fieldOverall as Bucket) ? (cols.fieldOverall as Bucket) : null;
  const distributions = distributionsFromJson(fieldJson);

  const values: Array<[MetricId, number | null]> = [
    ['lcp', cols.fieldLcp],
    ['inp', cols.fieldInp],
    ['cls', cols.fieldCls],
    ['fcp', cols.fieldFcp],
    ['ttfb', cols.fieldTtfb],
  ];

  const metrics: FieldDataDTO['metrics'] = {};
  for (const [id, value] of values) {
    if (value === null) continue;
    const bucket = bucketOf(id, value);
    if (!bucket) continue;
    metrics[id] = { value, bucket, distribution: distributions[id] ?? null } satisfies FieldMetricDTO;
  }

  return { source, overall, metrics };
}

// ---------------------------------------------------------------------------
// Audit descriptions
// ---------------------------------------------------------------------------

/**
 * AuditIssue stores the title but not the description -- the description is
 * static prose repeated identically on every one of ~60k rows, which is not
 * worth storing 60k times. It lives in rawJson, so a report reads it from
 * there for its one row.
 *
 * Retention prunes rawJson after RAW_JSON_RETAIN_RUNS runs, so this is
 * best-effort by design: an older report loses the prose, not the finding.
 */
export function descriptionsFromRawJson(rawJson: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const audits = (rawJson as { lighthouseResult?: { audits?: unknown } } | null)?.lighthouseResult?.audits;
  if (typeof audits !== 'object' || audits === null) return out;

  for (const [id, audit] of Object.entries(audits as Record<string, unknown>)) {
    const d = (audit as { description?: unknown }).description;
    if (typeof d === 'string' && d.length > 0) out.set(id, d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Everything except rawJson, fieldJson and markdownReport, which are handled explicitly. */
const REPORT_RESULT_SELECT = {
  id: true,
  status: true,
  runtimeError: true,
  createdAt: true,
  lighthouseVersion: true,
  performanceScore: true,
  accessibilityScore: true,
  bestPracticesScore: true,
  seoScore: true,
  lcp: true,
  inp: true,
  cls: true,
  fcp: true,
  ttfb: true,
  tbt: true,
  speedIndex: true,
  fieldSource: true,
  fieldOverall: true,
  fieldLcp: true,
  fieldInp: true,
  fieldCls: true,
  fieldFcp: true,
  fieldTtfb: true,
  fieldJson: true,
  markdownReport: true,
  recommendation: {
    select: { content: true, model: true, status: true, generatedAt: true },
  },
} as const;

export interface PageReportOptions {
  historyLimit?: number;
  /** Off by default for callers that only need the numbers: it is the one query
   *  in the read layer that detoasts rawJson. */
  includeDescriptions?: boolean;
}

export async function getPageReport(
  pageId: string,
  strategy: PsiStrategy,
  opts: PageReportOptions = {},
): Promise<PageReportDTO> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      url: true,
      path: true,
      title: true,
      latestResultMobileId: true,
      latestResultDesktopId: true,
      group: { select: { slug: true, name: true } },
    },
  });
  if (!page) throw new NotFoundError(`Page ${pageId}`);

  // Availability is read from the results, not the pointers: it must stay
  // correct even if a pointer was never written, and it is one index-only
  // lookup on [pageId, strategy, createdAt].
  const strategies = await prisma.auditResult.findMany({
    where: { pageId },
    distinct: ['strategy'],
    select: { strategy: true },
  });
  const seen = new Set(strategies.map((s) => s.strategy));

  const pointerId = strategy === 'mobile' ? page.latestResultMobileId : page.latestResultDesktopId;
  const latest = pointerId
    ? await prisma.auditResult.findUnique({ where: { id: pointerId }, select: REPORT_RESULT_SELECT })
    : // Fallback rather than "no data": the pointer is a denormalization and a
      // stale or missing one must not hide a result that exists.
      await prisma.auditResult.findFirst({
        where: { pageId, strategy },
        orderBy: { createdAt: 'desc' },
        select: REPORT_RESULT_SELECT,
      });

  const base = {
    page: {
      id: page.id,
      url: page.url,
      path: page.path,
      title: page.title,
      groupSlug: page.group?.slug ?? null,
      groupName: page.group?.name ?? null,
    },
    strategy,
    availability: { mobile: seen.has('mobile'), desktop: seen.has('desktop') },
  };

  // Never audited on this strategy. A normal state -- desktop often lags
  // mobile -- so it returns an empty report, not an error.
  if (!latest) {
    return {
      ...base,
      result: null,
      history: { performance: [], accessibility: [], bestPractices: [], seo: [] },
      recommendation: null,
    };
  }

  const [previous, issues, history, rawRow] = await Promise.all([
    prisma.auditResult.findFirst({
      // status 'ok' only: comparing today's score against an error row's nulls
      // would read as "no previous data" on a page that has plenty.
      where: { pageId, strategy, status: 'ok', createdAt: { lt: latest.createdAt } },
      orderBy: { createdAt: 'desc' },
      select: {
        performanceScore: true,
        accessibilityScore: true,
        bestPracticesScore: true,
        seoScore: true,
      },
    }),
    prisma.auditIssue.findMany({
      where: { auditResultId: latest.id },
      select: {
        auditId: true,
        title: true,
        category: true,
        group: true,
        score: true,
        displayValue: true,
        savingsMs: true,
        savingsBytes: true,
      },
      // Savings first, then worst score: weight is 0 for every insight and
      // diagnostic in LH13 and is useless as a sort key.
      orderBy: [{ savingsMs: 'desc' }, { score: 'asc' }],
    }),
    getPageScoreHistory(pageId, strategy, opts.historyLimit),
    opts.includeDescriptions
      ? prisma.auditResult.findUnique({ where: { id: latest.id }, select: { rawJson: true } })
      : Promise.resolve(null),
  ]);

  const descriptions = descriptionsFromRawJson(rawRow?.rawJson ?? null);

  const items: AuditItemDTO[] = issues.map((i) => ({
    auditId: i.auditId,
    title: i.title,
    description: descriptions.get(i.auditId) ?? '',
    category: i.category as AuditItemDTO['category'],
    kind: issueKindFromGroup(i.group),
    score: i.score,
    displayValue: i.displayValue,
    savingsMs: i.savingsMs,
    savingsBytes: i.savingsBytes,
  }));

  const ok = latest.status === 'ok';
  const rec = latest.recommendation;

  return {
    ...base,
    result: {
      id: latest.id,
      status: ok ? 'ok' : 'error',
      runtimeError: latest.runtimeError,
      fetchedAt: latest.createdAt.toISOString(),
      lighthouseVersion: latest.lighthouseVersion,
      scores: {
        performance: latest.performanceScore,
        accessibility: latest.accessibilityScore,
        bestPractices: latest.bestPracticesScore,
        seo: latest.seoScore,
      },
      previousScores: previous
        ? {
            performance: previous.performanceScore,
            accessibility: previous.accessibilityScore,
            bestPractices: previous.bestPracticesScore,
            seo: previous.seoScore,
          }
        : null,
      lab: {
        lcp: latest.lcp,
        // Lab INP stays null here on purpose. The field block below carries the
        // real INP, and TBT is reported as TBT -- writing it here would have it
        // read against INP thresholds.
        inp: latest.inp,
        cls: latest.cls,
        fcp: latest.fcp,
        ttfb: latest.ttfb,
        tbt: latest.tbt,
        speedIndex: latest.speedIndex,
      },
      field: buildFieldData(latest, latest.fieldJson),
      opportunities: items.filter((i) => i.kind === 'opportunity'),
      diagnostics: items.filter((i) => i.kind === 'diagnostic'),
      other: items.filter((i) => i.kind === 'other'),
      markdownReport: latest.markdownReport,
    },
    history,
    // 'generating' and 'failed' are not shown as a recommendation: a half-written
    // body rendered as advice is worse than none.
    recommendation:
      rec && rec.status === 'complete'
        ? { content: rec.content, model: rec.model, generatedAt: rec.generatedAt.toISOString() }
        : null,
  };
}
