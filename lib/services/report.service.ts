import { getTenantPrisma } from '../db/tenant.ts';
import { NotFoundError } from '../errors.ts';
import { bucketOf } from '../psi/buckets.ts';
import type { Bucket, MetricId, PsiStrategy } from '../psi/types.ts';
import { issueKindFromGroup } from './issues.service.ts';
import { getPageScoreHistory } from './results.service.ts';
import { fetchRawJson } from '../blob.ts';
import { d1CredentialsForOrg } from './org.service.ts';
import type {
  AuditDetailTable,
  AuditItemDTO,
  FieldDataDTO,
  FieldMetricDTO,
  PageReportDTO,
  RunEnvironmentDTO,
} from './types.ts';

/**
 * The single-page report view.
 *
 * This is the one place in the read layer that may touch rawJson, and only ever
 * for a single row: the audit descriptions and evidence tables live nowhere
 * else. Every list and aggregate path reads real columns and the AuditIssue
 * side table instead, which is the whole reason that table exists.
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
 * Retention removes whole results past RESULT_RETAIN_RUNS, so this is
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
  // Newest complete answer only. The rest of the history is loaded separately
  // by the panel, so a report render never carries ten bodies it will not show.
  recommendations: {
    where: { status: 'complete' },
    orderBy: { version: 'desc' },
    take: 1,
    select: { content: true, model: true, status: true, generatedAt: true, version: true, durationMs: true },
  },
} as const;

export interface PageReportOptions {
  historyLimit?: number;
  /** Off by default for callers that only need the numbers: it is the one query
   *  in the read layer that detoasts rawJson. */
  includeDescriptions?: boolean;
}

export async function getPageReport(
  organizationId: string,
  pageId: string,
  strategy: PsiStrategy,
  opts: PageReportOptions = {},
): Promise<PageReportDTO> {
  const prisma = await getTenantPrisma(organizationId);
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
    getPageScoreHistory(organizationId, pageId, strategy, opts.historyLimit),
    // Always fetched now: the report view needs both descriptions and the
    // evidence tables, and this is a single row rather than a list query.
    prisma.auditResult.findUnique({ where: { id: latest.id }, select: { rawJson: true, rawJsonBlobKey: true } }),
  ]);

  // Blob first (where every new row's JSON actually lives), falling back to
  // the inline column for rows written before the move -- see
  // docs/DECISIONS.md §13. Never both: recordAuditResult never sets both.
  const rawJson = rawRow?.rawJsonBlobKey
    ? await fetchRawJson(rawRow.rawJsonBlobKey, (await d1CredentialsForOrg(organizationId)) ?? undefined)
    : rawRow?.rawJson ?? null;

  const descriptions = descriptionsFromRawJson(rawJson);
  const detailTables = detailsFromRawJson(rawJson);
  const { passed, notApplicable } = passedAuditsFromRawJson(rawJson);
  const screenshot = screenshotFromRawJson(rawJson);
  const environment = environmentFromRawJson(rawJson);

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
    details: detailTables.get(i.auditId) ?? null,
  }));

  const ok = latest.status === 'ok';
  const rec = latest.recommendations[0] ?? null;

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
      passed,
      notApplicable,
      screenshot,
      environment,
      markdownReport: latest.markdownReport,
    },
    history,
    // 'generating' and 'failed' are not shown as a recommendation: a half-written
    // body rendered as advice is worse than none.
    recommendation:
      rec && rec.status === 'complete'
        ? {
            content: rec.content,
            model: rec.model,
            generatedAt: rec.generatedAt.toISOString(),
            version: rec.version,
            durationMs: rec.durationMs,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Audit evidence tables
// ---------------------------------------------------------------------------

/** Values Lighthouse nests as objects rather than scalars. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // Node references and link/url/code wrappers all carry the useful text here.
    for (const k of ['url', 'text', 'snippet', 'selector', 'value', 'label', 'path']) {
      const inner = o[k];
      if (typeof inner === 'string' && inner) return inner;
      if (typeof inner === 'number') return String(inner);
    }
  }
  return '';
}

/** Bytes and milliseconds arrive as raw numbers; render them the way PSI does. */
function formatCell(raw: unknown, type: string): string {
  const s = cellToString(raw);
  if (s === '') return '';
  const n = typeof raw === 'number' ? raw : Number(s);
  if (!Number.isNaN(n) && typeof raw === 'number') {
    if (type === 'bytes') {
      return n < 1024 ? `${Math.round(n)} B` : n < 1048576 ? `${Math.round(n / 1024)} KiB` : `${(n / 1048576).toFixed(1)} MiB`;
    }
    if (type === 'ms' || type === 'timespanMs') {
      return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
    }
  }
  return s;
}

/**
 * Pulls each audit's evidence table out of the stored (pruned) rawJson.
 *
 * Read-time extraction is fine HERE and nowhere else: this is one row for one
 * page, not a list query. Pruning already capped items at 10 and truncated the
 * strings inside them, so `truncated` tells the UI to say "showing first 10"
 * rather than implying the list is complete.
 */
export function detailsFromRawJson(rawJson: unknown): Map<string, AuditDetailTable> {
  const out = new Map<string, AuditDetailTable>();
  const audits = (rawJson as { lighthouseResult?: { audits?: Record<string, unknown> } })?.lighthouseResult?.audits;
  if (!audits) return out;

  for (const [auditId, audit] of Object.entries(audits)) {
    const details = (audit as { details?: Record<string, unknown> }).details;
    if (!details) continue;

    const type = String(details.type ?? '');
    // Only tabular shapes carry readable evidence; filmstrips, screenshots,
    // treemaps and debugdata do not.
    if (type !== 'table' && type !== 'opportunity' && type !== 'list') continue;

    const rawHeadings = Array.isArray(details.headings) ? details.headings : [];
    const headings = rawHeadings
      .map((h) => {
        const o = h as Record<string, unknown>;
        return {
          key: String(o.key ?? ''),
          // v10+ uses label/valueType; v9 used text/itemType.
          label: String(o.label ?? o.text ?? o.key ?? ''),
          type: String(o.valueType ?? o.itemType ?? 'text'),
        };
      })
      .filter((h) => h.key);

    const rawItems = Array.isArray(details.items) ? details.items : [];
    if (headings.length === 0 || rawItems.length === 0) continue;

    const rows = rawItems.map((item) => {
      const o = item as Record<string, unknown>;
      const row: Record<string, string> = {};
      for (const h of headings) row[h.key] = formatCell(o[h.key], h.type);
      return row;
    });

    // Pruning caps items at 10, so a full ten strongly implies more were cut.
    out.set(auditId, { headings, rows, truncated: rawItems.length >= 10 });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Full-report extras: screenshot, passed audits, run conditions
// ---------------------------------------------------------------------------

/** The final screenshot as a data: URI, or null if pruning or the run dropped it. */
export function screenshotFromRawJson(rawJson: unknown): string | null {
  const shot = (rawJson as { lighthouseResult?: { audits?: Record<string, { details?: { data?: unknown } }> } })
    ?.lighthouseResult?.audits?.['final-screenshot']?.details?.data;
  return typeof shot === 'string' && shot.startsWith('data:') ? shot : null;
}

/**
 * The audits that PASSED or did not apply.
 *
 * These are not in AuditIssue -- that table only holds failures, deliberately,
 * because it exists to make the site-wide "top issues" aggregate fast. But a
 * report showing only failures reads as a list of complaints rather than an
 * assessment, and PSI shows both, so they are recovered from rawJson here. This
 * is one row for one page, not a list query.
 */
export function passedAuditsFromRawJson(rawJson: unknown): {
  passed: AuditItemDTO[];
  notApplicable: AuditItemDTO[];
} {
  const lr = (rawJson as {
    lighthouseResult?: {
      audits?: Record<string, Record<string, unknown>>;
      categories?: Record<string, { auditRefs?: Array<{ id: string; group?: string }> }>;
    };
  })?.lighthouseResult;

  const passed: AuditItemDTO[] = [];
  const notApplicable: AuditItemDTO[] = [];
  if (!lr?.audits || !lr.categories) return { passed, notApplicable };

  const seen = new Set<string>();
  const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

  for (const catId of CATEGORIES) {
    for (const ref of lr.categories[catId]?.auditRefs ?? []) {
      if (seen.has(ref.id)) continue;
      const a = lr.audits[ref.id];
      if (!a) continue;

      const mode = String(a.scoreDisplayMode ?? '');
      const score = typeof a.score === 'number' ? a.score : null;

      const item: AuditItemDTO = {
        auditId: ref.id,
        title: String(a.title ?? ref.id),
        description: String(a.description ?? ''),
        category: catId,
        kind: 'other',
        score,
        displayValue: typeof a.displayValue === 'string' ? a.displayValue : null,
        savingsMs: null,
        savingsBytes: null,
        details: null,
      };

      if (mode === 'notApplicable' || mode === 'manual') {
        seen.add(ref.id);
        notApplicable.push(item);
      } else if (score !== null && score >= 0.9) {
        seen.add(ref.id);
        passed.push(item);
      }
    }
  }

  const byTitle = (a: AuditItemDTO, b: AuditItemDTO) => a.title.localeCompare(b.title);
  return { passed: passed.sort(byTitle), notApplicable: notApplicable.sort(byTitle) };
}

/** The device, throttling and version the numbers were produced under. */
export function environmentFromRawJson(rawJson: unknown): RunEnvironmentDTO {
  const lr = (rawJson as {
    lighthouseResult?: {
      lighthouseVersion?: string;
      userAgent?: string;
      fetchTime?: string;
      configSettings?: { formFactor?: string; throttlingMethod?: string; throttling?: Record<string, number> };
      environment?: { benchmarkIndex?: number };
    };
  })?.lighthouseResult;

  const cfg = lr?.configSettings;
  const th = cfg?.throttling;

  return {
    lighthouseVersion: lr?.lighthouseVersion ?? null,
    userAgent: lr?.userAgent ?? null,
    device: cfg?.formFactor ? (cfg.formFactor === 'mobile' ? 'Emulated mobile' : 'Emulated desktop') : null,
    networkThrottling:
      th && typeof th.rttMs === 'number'
        ? `${th.rttMs} ms TCP RTT, ${Math.round((th.throughputKbps ?? 0) / 1024)} Mbps throughput (${cfg?.throttlingMethod ?? 'simulated'})`
        : null,
    cpuThrottling: th && typeof th.cpuSlowdownMultiplier === 'number' ? `${th.cpuSlowdownMultiplier}x slowdown` : null,
    fetchedAt: lr?.fetchTime ?? null,
  };
}
