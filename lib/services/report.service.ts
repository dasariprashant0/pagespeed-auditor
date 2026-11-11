import { getTenantPrisma } from '../db/tenant.ts';
import { NotFoundError } from '../errors.ts';
import { bucketOf, cwvAssessment } from '../psi/buckets.ts';
import { CRUX_KEYS, extractField } from '../psi/extract.ts';
import type { MetricId, PsiLoadingExperience, PsiResponse, PsiStrategy } from '../psi/types.ts';
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

export interface FieldColumns {
  fieldSource: string | null;
  fieldOverall: string | null;
  fieldLcp: number | null;
  fieldInp: number | null;
  fieldCls: number | null;
  fieldFcp: number | null;
  fieldTtfb: number | null;
}


/**
 * The CrUX block a row's field columns describe. fieldJsonOf stores BOTH blocks
 * as `{ loadingExperience, originLoadingExperience }`; reading `.metrics` off
 * the top level (as this used to) found nothing, so the distribution bars never
 * rendered for any real row. A bare `{ metrics }` blob is still accepted.
 */
function cruxBlockOf(fieldJson: unknown, source: FieldDataDTO['source']): unknown {
  if (typeof fieldJson !== 'object' || fieldJson === null) return null;
  const j = fieldJson as { loadingExperience?: unknown; originLoadingExperience?: unknown; metrics?: unknown };
  if (j.metrics) return j;
  return source === 'origin_fallback' ? j.originLoadingExperience : j.loadingExperience;
}

/** [good, needs-improvement, poor] proportions, pulled out of the trimmed blob. */
function distributionsFromJson(block: unknown): Partial<Record<MetricId, [number, number, number]>> {
  const out: Partial<Record<MetricId, [number, number, number]>> = {};
  if (typeof block !== 'object' || block === null) return out;

  const metrics = (block as { metrics?: unknown }).metrics;
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

  const distributions = distributionsFromJson(cruxBlockOf(fieldJson, source));

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

  // Re-derived from the metrics, not read from cols.fieldOverall: rows written
  // before 11 Nov 2026 hold PSI's overall_category, which counted FCP/TTFB.
  return { source, overall: cwvAssessment(metrics), metrics, origin: originFieldData(source, fieldJson) };
}

/** PSI's "Origin" tab, shown next to page-level data when both exist. */
function originFieldData(source: FieldDataDTO['source'], fieldJson: unknown): FieldDataDTO['origin'] {
  if (source !== 'page' || typeof fieldJson !== 'object' || fieldJson === null) return null;
  const origin = (fieldJson as { originLoadingExperience?: PsiLoadingExperience | null }).originLoadingExperience;
  if (!origin) return null;
  const f = extractField({ originLoadingExperience: origin } as PsiResponse);
  return f.source === 'none' ? null : { overall: f.overall, metrics: f.metrics };
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
  const { passed, notApplicable, manual, informative } = passedAuditsFromRawJson(rawJson, detailTables);
  const extras = auditExtrasFromRawJson(rawJson);
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
    details: detailTables.get(i.auditId) ?? [],
    ...(extras.get(i.auditId) ?? NO_EXTRAS),
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
      manual,
      informative,
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
    // A DOM node: what a person recognises (its text) plus where an agent finds
    // it (the selector). The snippet alone is often an anonymous <div>.
    if (o.type === 'node') {
      return [o.nodeLabel, o.selector].filter((s) => typeof s === 'string' && s).join(' — ') || String(o.snippet ?? '');
    }
    // A script position: file:line, the way DevTools prints it.
    if (o.type === 'source-location' && typeof o.url === 'string') {
      return typeof o.line === 'number' ? `${o.url}:${o.line + 1}` : o.url;
    }
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
    // Layout-shift scores and the like arrive as 0.1718218077239916.
    if (type === 'numeric' && !Number.isInteger(n)) return String(Number(n.toFixed(3)));
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
export function detailsFromRawJson(rawJson: unknown): Map<string, AuditDetailTable[]> {
  const out = new Map<string, AuditDetailTable[]>();
  const audits = (rawJson as { lighthouseResult?: { audits?: Record<string, unknown> } })?.lighthouseResult?.audits;
  if (!audits) return out;

  for (const [auditId, audit] of Object.entries(audits)) {
    const details = (audit as { details?: Record<string, unknown> }).details;
    if (!details) continue;
    const tables = tablesOf(details);
    if (tables.length > 0) out.set(auditId, tables);
  }

  return out;
}

type Raw = Record<string, unknown>;

/**
 * Every readable table inside one audit's `details`.
 *
 * Filmstrips, screenshots, treemaps and debugdata carry no readable evidence
 * and yield nothing. LH13's insights mostly use `list` -- a list of tables,
 * DOM nodes and sections -- which an earlier version skipped outright, so the
 * LCP breakdown, CLS culprits and request chains showed no evidence at all.
 */
function tablesOf(details: Raw, title?: string): AuditDetailTable[] {
  const items = Array.isArray(details.items) ? (details.items as unknown[]) : [];
  switch (details.type) {
    case 'table':
    case 'opportunity': {
      const t = tableOf(details, title);
      return t ? [t] : [];
    }
    case 'list':
      return items.flatMap((item) => {
        const o = item as Raw;
        if (o.type === 'node') {
          return [{ title, headings: [{ key: 'node', label: 'Element', type: 'node' }], rows: [{ node: cellToString(o) }], truncated: false }];
        }
        return typeof o === 'object' && o !== null ? tablesOf(o, title) : [];
      });
    case 'list-section': {
      const value = details.value as Raw | undefined;
      const sectionTitle = typeof details.title === 'string' ? details.title : title;
      if (value?.type === 'network-tree') return chainTable(value, sectionTitle);
      return value ? tablesOf(value, sectionTitle) : [];
    }
    case 'checklist': {
      // { key: { label, value: boolean } } -- document-latency-insight.
      const checks = Object.values((details.items ?? {}) as Record<string, Raw>);
      if (checks.length === 0) return [];
      return [{
        title,
        headings: [{ key: 'check', label: 'Check', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }],
        rows: checks.map((c) => ({ check: String(c.label ?? ''), status: c.value ? 'Passed' : 'Failed' })),
        truncated: false,
      }];
    }
    default:
      return [];
  }
}

function tableOf(details: Raw, title?: string): AuditDetailTable | null {
  const rawHeadings = Array.isArray(details.headings) ? (details.headings as Raw[]) : [];
  const headings = rawHeadings
    .map((o) => ({
      key: String(o.key ?? ''),
      // v10+ uses label/valueType; v9 used text/itemType.
      label: String(o.label ?? o.text ?? o.key ?? ''),
      type: String(o.valueType ?? o.itemType ?? 'text'),
      sub: o.subItemsHeading as Raw | undefined,
    }))
    .filter((h) => h.key);

  const rawItems = Array.isArray(details.items) ? (details.items as Raw[]) : [];
  if (headings.length === 0 || rawItems.length === 0) return null;

  const rows: Array<Record<string, string>> = [];
  for (const o of rawItems) {
    const row: Record<string, string> = {};
    for (const h of headings) row[h.key] = formatCell(o[h.key], h.type);
    rows.push(row);

    // Sub-rows (per-script breakdowns, a third party's individual requests,
    // a layout shift's causes) map onto the parent's columns through each
    // heading's subItemsHeading -- the same way Lighthouse renders them.
    const subs = (o.subItems as { items?: Raw[] } | undefined)?.items ?? [];
    for (const s of subs) {
      const sub: Record<string, string> = {};
      for (const [i, h] of headings.entries()) {
        const key = h.sub?.key;
        const v = typeof key === 'string' ? formatCell(s[key], String(h.sub?.valueType ?? h.type)) : '';
        sub[h.key] = i === 0 && v ? `↳ ${v}` : v;
      }
      if (Object.values(sub).some(Boolean)) rows.push(sub);
    }
  }

  return {
    title,
    headings: headings.map(({ key, label, type }) => ({ key, label, type })),
    rows,
    // Pruning caps items at 10 (30 for the deep ones), so a full cap implies more were cut.
    truncated: rawItems.length >= 10,
  };
}

/** The critical request chain, flattened depth-first with indentation. */
function chainTable(tree: Raw, title?: string): AuditDetailTable[] {
  const rows: Array<Record<string, string>> = [];
  const walk = (chains: unknown, depth: number) => {
    for (const node of Object.values((chains ?? {}) as Record<string, Raw>)) {
      rows.push({
        url: `${'  '.repeat(depth)}${depth > 0 ? '↳ ' : ''}${String(node.url ?? '')}`,
        time: formatCell(node.navStartToEndTime, 'ms'),
        size: formatCell(node.transferSize, 'bytes'),
        longest: node.isLongest ? 'yes' : '',
      });
      walk(node.children, depth + 1);
    }
  };
  walk(tree.chains, 0);
  if (rows.length === 0) return [];
  const longest = (tree.longestChain as { duration?: unknown } | undefined)?.duration;
  return [{
    title: title ?? (typeof longest === 'number' ? `Critical request chain — longest ${formatCell(longest, 'ms')}` : 'Critical request chain'),
    headings: [
      { key: 'url', label: 'Request', type: 'url' },
      { key: 'time', label: 'Finished at', type: 'ms' },
      { key: 'size', label: 'Transfer size', type: 'bytes' },
      { key: 'longest', label: 'On longest chain', type: 'text' },
    ],
    rows,
    truncated: false,
  }];
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
export function passedAuditsFromRawJson(
  rawJson: unknown,
  detailTables: Map<string, AuditDetailTable[]> = detailsFromRawJson(rawJson),
): {
  passed: AuditItemDTO[];
  notApplicable: AuditItemDTO[];
  manual: AuditItemDTO[];
  informative: AuditItemDTO[];
} {
  const lr = (rawJson as {
    lighthouseResult?: {
      audits?: Record<string, Record<string, unknown>>;
      categories?: Record<string, { auditRefs?: Array<{ id: string; group?: string }> }>;
    };
  })?.lighthouseResult;

  const passed: AuditItemDTO[] = [];
  const notApplicable: AuditItemDTO[] = [];
  const manual: AuditItemDTO[] = [];
  const informative: AuditItemDTO[] = [];
  if (!lr?.audits || !lr.categories) return { passed, notApplicable, manual, informative };

  const extras = auditExtrasFromRawJson(rawJson);
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
        details: detailTables.get(ref.id) ?? [],
        ...(extras.get(ref.id) ?? NO_EXTRAS),
      };

      // Informative insights before the passed check: Lighthouse scores them 1,
      // so they used to land in "Passed" with their evidence stripped -- the
      // LCP breakdown read as a passed audit with nothing in it. PSI lists them
      // under Insights, unscored. Only the visible groups: the `hidden` ones
      // (network-requests, debug payloads) PSI does not show either.
      if (mode === 'informative' && (ref.group === 'insights' || ref.group === 'diagnostics')) {
        seen.add(ref.id);
        informative.push(item);
      } else if (mode === 'manual') {
        seen.add(ref.id);
        manual.push(item);
      } else if (mode === 'notApplicable') {
        seen.add(ref.id);
        notApplicable.push(item);
      } else if (score !== null && score >= 0.9 && ref.group !== 'metrics' && ref.group !== 'hidden') {
        seen.add(ref.id);
        passed.push(item);
      }
    }
  }

  const byTitle = (a: AuditItemDTO, b: AuditItemDTO) => a.title.localeCompare(b.title);
  return {
    passed: passed.sort(byTitle),
    notApplicable: notApplicable.sort(byTitle),
    manual: manual.sort(byTitle),
    informative,
  };
}

const NO_EXTRAS = { metrics: [] as string[], stackTips: [] as AuditItemDTO['stackTips'] };

/**
 * Per-audit metric tags and stack-pack tips, keyed by audit id.
 *
 * Tags are the `metricSavings` keys, which is what PSI's "Show audits relevant
 * to: FCP / LCP / TBT / CLS" filter keys on. Stack tips exist only on rows
 * written after stackPacks stopped being pruned (11 Nov 2026), and only when
 * Lighthouse detected a stack it has a pack for.
 */
export function auditExtrasFromRawJson(rawJson: unknown): Map<string, Pick<AuditItemDTO, 'metrics' | 'stackTips'>> {
  const out = new Map<string, Pick<AuditItemDTO, 'metrics' | 'stackTips'>>();
  const lr = (rawJson as {
    lighthouseResult?: {
      audits?: Record<string, { metricSavings?: Record<string, unknown> }>;
      stackPacks?: Array<{ title?: string; descriptions?: Record<string, string> }>;
    };
  })?.lighthouseResult;
  if (!lr?.audits) return out;

  for (const [id, a] of Object.entries(lr.audits)) {
    const metrics = Object.keys(a.metricSavings ?? {});
    const stackTips = (lr.stackPacks ?? []).flatMap((p) =>
      p.descriptions?.[id] ? [{ stack: String(p.title ?? 'Stack'), tip: p.descriptions[id] }] : [],
    );
    if (metrics.length || stackTips.length) out.set(id, { metrics, stackTips });
  }
  return out;
}

/** The device, throttling and version the numbers were produced under. */
export function environmentFromRawJson(rawJson: unknown): RunEnvironmentDTO {
  const lr = (rawJson as {
    lighthouseResult?: {
      lighthouseVersion?: string;
      userAgent?: string;
      fetchTime?: string;
      requestedUrl?: string;
      finalDisplayedUrl?: string;
      finalUrl?: string;
      runWarnings?: unknown[];
      configSettings?: {
        formFactor?: string;
        throttlingMethod?: string;
        throttling?: Record<string, number>;
      };
      environment?: { benchmarkIndex?: number; hostUserAgent?: string };
    };
  })?.lighthouseResult;

  const cfg = lr?.configSettings;
  const th = cfg?.throttling;
  const finalUrl = lr?.finalDisplayedUrl ?? lr?.finalUrl ?? null;

  return {
    lighthouseVersion: lr?.lighthouseVersion ?? null,
    userAgent: lr?.userAgent ?? null,
    device: cfg?.formFactor ? (cfg.formFactor === 'mobile' ? 'Emulated mobile' : 'Emulated desktop') : null,
    networkThrottling:
      th && typeof th.rttMs === 'number'
        ? `${th.rttMs} ms TCP RTT, ${Math.round((th.throughputKbps ?? 0) / 1024)} Mbps throughput (${cfg?.throttlingMethod ?? 'simulated'})`
        : null,
    cpuThrottling: th && typeof th.cpuSlowdownMultiplier === 'number' ? `${th.cpuSlowdownMultiplier}x slowdown` : null,
    browser: browserOf(lr?.environment),
    fetchedAt: lr?.fetchTime ?? null,
    redirectedTo: finalUrl && lr?.requestedUrl && sameUrl(finalUrl, lr.requestedUrl) === false ? finalUrl : null,
    warnings: (lr?.runWarnings ?? []).filter((w): w is string => typeof w === 'string' && w.length > 0),
  };
}

/** A trailing slash or #fragment is not a redirect worth a banner. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  return norm(a) === norm(b);
}

function browserOf(env: { benchmarkIndex?: number; hostUserAgent?: string } | undefined): string | null {
  const chrome = env?.hostUserAgent?.match(/HeadlessChrome\/[\d.]+/)?.[0] ?? null;
  const bench = typeof env?.benchmarkIndex === 'number' ? `CPU benchmark ${env.benchmarkIndex}` : null;
  return [chrome, bench].filter(Boolean).join(' · ') || null;
}
