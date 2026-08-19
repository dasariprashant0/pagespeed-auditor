import type { ExtractedResult, MetricId, PsiStrategy, ExtractedScores } from '../psi/types.ts';
import { bucketOf } from '../psi/buckets.ts';
import { AI_PLACEHOLDER, aiBlock } from './aiSection.ts';
import {
  escapeCell,
  formatBucket,
  formatBytes,
  formatDelta,
  formatMetric,
  formatMs,
  formatScore,
  formatTimestamp,
} from './format.ts';

/**
 * Builds the stored markdown report for one AuditResult.
 *
 * PURE: no DB, no clock, no I/O. `generatedAt` is a parameter precisely so
 * snapshot tests are deterministic.
 *
 * Generated ONCE at audit time and stored in AuditResult.markdownReport. It is
 * the same artefact a human reads in the dashboard and an agent reads through
 * the MCP `get_report` tool, which is what keeps the two consistent.
 */

export interface ReportInput {
  url: string;
  strategy: PsiStrategy;
  generatedAt: Date;
  result: ExtractedResult;
  /** Scores from the previous successful audit, for the delta column. */
  previousScores?: ExtractedScores | null;
  /** Cap on rows listed per section. */
  maxItems?: number;
}

const CWV_ORDER: Array<{ id: MetricId | 'tbt'; label: string; core: boolean }> = [
  { id: 'lcp', label: 'LCP', core: true },
  { id: 'inp', label: 'INP', core: true },
  { id: 'cls', label: 'CLS', core: true },
  { id: 'fcp', label: 'FCP', core: false },
  { id: 'ttfb', label: 'TTFB', core: false },
];

function scoresTable(scores: ExtractedScores, prev?: ExtractedScores | null): string {
  const rows: Array<[string, number | null, number | null]> = [
    ['Performance', scores.performance, prev?.performance ?? null],
    ['Accessibility', scores.accessibility, prev?.accessibility ?? null],
    ['Best Practices', scores.bestPractices, prev?.bestPractices ?? null],
    ['SEO', scores.seo, prev?.seo ?? null],
  ];

  // Only show the delta column when there is a previous run to compare to --
  // a column of em-dashes on a first audit is noise.
  const withDelta = !!prev;
  const head = withDelta
    ? '| Category | Score | vs. previous |\n|---|---:|---:|'
    : '| Category | Score |\n|---|---:|';

  const body = rows
    .map(([label, cur, before]) =>
      withDelta
        ? `| ${label} | ${formatScore(cur)} | ${formatDelta(cur, before)} |`
        : `| ${label} | ${formatScore(cur)} |`,
    )
    .join('\n');

  return `${head}\n${body}`;
}

function labTable(result: ExtractedResult): string {
  const lines = CWV_ORDER.map(({ id, label }) => {
    const value = result.lab[id as keyof typeof result.lab] as number | null;

    // INP is a field metric; Lighthouse lab runs do not produce it. Say so
    // explicitly and point at TBT rather than leaving a bare em-dash that reads
    // like a bug, and rather than silently showing TBT under an INP label.
    if (id === 'inp' && value === null) {
      const tbt = result.lab.tbt;
      const note =
        tbt === null
          ? 'Not available in lab'
          : `Not available in lab — TBT ${formatMs(tbt)} is the lab proxy`;
      return `| INP | — | ${note} |`;
    }

    return `| ${label} | ${formatMetric(id, value)} | ${formatBucket(bucketOf(id, value))} |`;
  });

  // TBT is not a Core Web Vital but is the responsiveness signal lab can give.
  lines.push(
    `| TBT | ${formatMetric('tbt', result.lab.tbt)} | ${formatBucket(bucketOf('tbt', result.lab.tbt))} |`,
  );

  return `| Metric | Value | Rating |\n|---|---:|---|\n${lines.join('\n')}`;
}

function fieldSection(result: ExtractedResult): string {
  const f = result.field;

  if (f.source === 'none') {
    // A normal state for a low-traffic page, not an error. Worded so nobody
    // files a bug about it.
    return '> Not enough real-user data for this URL. Chrome UX Report needs roughly 28 days of sufficient traffic before it reports on a specific page. The lab data above is still accurate.';
  }

  const rows = CWV_ORDER.map(({ id, label }) => {
    const m = f.metrics[id as MetricId];
    if (!m) return `| ${label} | — | Not enough samples |`;
    return `| ${label} | ${formatMetric(id, m.value)} | ${formatBucket(m.bucket)} |`;
  }).join('\n');

  const preamble =
    f.source === 'origin_fallback'
      ? '> Showing site-wide real-user data — this page does not have enough traffic of its own.\n\n'
      : '';

  const overall = f.overall ? `\n\n**Overall:** ${formatBucket(f.overall)}` : '';

  return `${preamble}| Metric | 75th percentile | Rating |\n|---|---:|---|\n${rows}${overall}`;
}

function auditList(
  audits: ExtractedResult['audits'],
  kind: 'opportunity' | 'diagnostic' | 'other',
  max: number,
): string {
  const items = audits.filter((a) => a.kind === kind).slice(0, max);
  if (items.length === 0) return '_None found._';

  return items
    .map((a) => {
      const bits: string[] = [];
      if (a.savingsMs !== null) bits.push(`est. saving ${formatMs(a.savingsMs)}`);
      if (a.savingsBytes !== null) bits.push(formatBytes(a.savingsBytes));
      if (a.displayValue) bits.push(escapeCell(a.displayValue));
      const suffix = bits.length ? ` — ${bits.join(', ')}` : '';
      const prefix = kind === 'other' ? `[${a.category}] ` : '';
      return `- **${prefix}${escapeCell(a.title)}**${suffix}`;
    })
    .join('\n');
}

export function buildMarkdownReport(input: ReportInput): string {
  const { url, strategy, generatedAt, result, previousScores, maxItems = 10 } = input;
  const label = strategy === 'mobile' ? 'Mobile' : 'Desktop';

  const header = [
    `# ${url} — ${label}`,
    '',
    `Audited: ${formatTimestamp(generatedAt)}${
      result.lighthouseVersion ? ` · Lighthouse ${result.lighthouseVersion}` : ''
    }`,
  ].join('\n');

  // A page Lighthouse could not measure gets a short, honest report rather than
  // a full one padded with em-dashes.
  if (result.status === 'error') {
    return [
      header,
      '',
      '## Audit failed',
      '',
      `Lighthouse could not measure this page: \`${result.runtimeError}\`.`,
      '',
      'No scores are available for this run. Previous audits of this page are unaffected.',
      '',
      aiBlock(AI_PLACEHOLDER),
      '',
    ].join('\n');
  }

  return [
    header,
    '',
    '## Scores',
    '',
    scoresTable(result.scores, previousScores),
    '',
    '## Core Web Vitals (Lab)',
    '',
    labTable(result),
    '',
    '## Field Data (Real Users, 28-day)',
    '',
    fieldSection(result),
    '',
    '## Opportunities',
    '',
    auditList(result.audits, 'opportunity', maxItems),
    '',
    '## Diagnostics',
    '',
    auditList(result.audits, 'diagnostic', maxItems),
    '',
    '## Accessibility, Best Practices & SEO Issues',
    '',
    auditList(result.audits, 'other', maxItems),
    '',
    aiBlock(AI_PLACEHOLDER),
    '',
  ].join('\n');
}
