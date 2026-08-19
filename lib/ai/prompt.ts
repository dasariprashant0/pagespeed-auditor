import type { PageReportDTO } from '../services/types.ts';

/**
 * Builds the recommendation prompt.
 *
 * Sends the STRUCTURED findings, not the raw PSI JSON: the raw response is
 * 150 KB of mostly-irrelevant detail, and the parts that matter are already
 * extracted. Trimming is not only about cost -- a model given the whole blob
 * spends its attention summarising it back rather than deciding what to fix.
 */
export function buildRecommendationPrompt(report: PageReportDTO): string {
  const r = report.result;
  if (!r) return '';

  const lines: string[] = [];
  lines.push(`URL: ${report.page.url}`);
  lines.push(`Strategy: ${report.strategy}`);
  lines.push('');
  lines.push('Scores (0-100):');
  lines.push(`  Performance ${r.scores.performance}, Accessibility ${r.scores.accessibility}, Best Practices ${r.scores.bestPractices}, SEO ${r.scores.seo}`);
  lines.push('');

  lines.push('Lab metrics:');
  lines.push(`  LCP ${fmt(r.lab.lcp)}  CLS ${r.lab.cls?.toFixed(3) ?? '—'}  FCP ${fmt(r.lab.fcp)}  TTFB ${fmt(r.lab.ttfb)}  TBT ${fmt(r.lab.tbt)}`);
  lines.push('  (INP is field-only; Lighthouse lab runs do not measure it.)');
  lines.push('');

  if (r.field.source === 'none') {
    lines.push('Field data: none — this URL has too little traffic for CrUX.');
  } else {
    const which = r.field.source === 'origin_fallback' ? 'origin-level (page has too little traffic)' : 'page-level';
    lines.push(`Field data (${which}):`);
    for (const [k, m] of Object.entries(r.field.metrics)) {
      if (m) lines.push(`  ${k.toUpperCase()} ${k === 'cls' ? m.value.toFixed(3) : fmt(m.value)} (${m.bucket})`);
    }
  }
  lines.push('');

  const section = (title: string, items: typeof r.opportunities) => {
    if (items.length === 0) return;
    lines.push(`${title}:`);
    for (const a of items.slice(0, 12)) {
      const bits = [
        a.savingsMs !== null ? `saves ~${fmt(a.savingsMs)}` : null,
        a.savingsBytes !== null ? `${Math.round(a.savingsBytes / 1024)} KiB` : null,
        a.displayValue,
      ].filter(Boolean);
      lines.push(`  - ${a.title}${bits.length ? ` [${bits.join(', ')}]` : ''}`);
      // A couple of concrete offenders make the advice specific instead of generic.
      const rows = a.details?.rows.slice(0, 3) ?? [];
      for (const row of rows) {
        const first = Object.values(row).find((v) => v);
        if (first) lines.push(`      ${String(first).slice(0, 120)}`);
      }
    }
    lines.push('');
  };

  section('Opportunities', r.opportunities);
  section('Diagnostics', r.diagnostics);
  section('Accessibility / Best Practices / SEO issues', r.other);

  return lines.join('\n');
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

export const SYSTEM_PROMPT = `You are advising a web engineering team on a specific page of their site, using its PageSpeed Insights results.

Write a short, prioritised fix list. Rules:
- Lead with the change that will move the numbers most, and say roughly how much.
- Be specific to the evidence given. Name the actual files, requests or elements when they appear in the data.
- If the biggest problem is architectural (a heavy framework bundle, a third-party tag, an unoptimised image pipeline), say so plainly rather than listing micro-optimisations around it.
- Skip anything already passing. Do not restate the scores back.
- If the data does not support a confident recommendation, say what to measure next instead of guessing.
- No preamble, no summary of what PageSpeed is. Markdown, under 400 words.`;
