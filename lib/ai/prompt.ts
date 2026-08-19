import type { PageReportDTO } from '../services/types.ts';

/**
 * Builds the recommendation prompt.
 *
 * Sends the STRUCTURED findings, not the raw PSI JSON: the raw response is
 * 150 KB of mostly-irrelevant detail, and the parts that matter are already
 * extracted. Trimming is not only about cost -- a model given the whole blob
 * spends its attention summarising it back rather than deciding what to fix.
 */
export function buildRecommendationPrompt(
  report: PageReportDTO,
  opts: { previous?: string | null } = {},
): string {
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
      // The audit id is included so the advice can be checked back against the
      // Lighthouse audit it came from rather than taken on trust.
      lines.push(`  - [${a.auditId}] ${a.title}${bits.length ? ` (${bits.join(', ')})` : ''}`);
      // Concrete offenders, with their numbers. Passing only the first column
      // produced advice like "optimise your images" -- true, useless. Passing
      // the URL AND its size produces "the 1.2 MB hero at /img/hero.png".
      for (const row of a.details?.rows.slice(0, 4) ?? []) {
        const cells = Object.entries(row)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .slice(0, 4)
          .map(([k, v]) => `${k}=${String(v).slice(0, 140)}`);
        if (cells.length) lines.push(`      ${cells.join('  ')}`);
      }
    }
    lines.push('');
  };

  // What changed since the last measurement. Without it the model cannot tell
  // a long-standing problem from something that broke this week, and those want
  // different advice.
  const prev = r.previousScores;
  if (prev) {
    const spark = report.history.performance;
    const when = spark.length > 1 ? ` on ${spark[spark.length - 2].t.slice(0, 10)}` : '';
    const delta = (now: number | null, before: number | null) =>
      now === null || before === null ? '' : ` (${now > before ? '+' : ''}${now - before})`;
    lines.push(
      `Previous measurement${when}: performance ${prev.performance ?? '—'}${delta(r.scores.performance, prev.performance)}, ` +
      `accessibility ${prev.accessibility ?? '—'}, best practices ${prev.bestPractices ?? '—'}, SEO ${prev.seo ?? '—'}.`,
    );
    lines.push('');
  }

  section('Opportunities', r.opportunities);
  section('Diagnostics', r.diagnostics);
  section('Accessibility / Best Practices / SEO issues', r.other);

  if (opts.previous) {
    lines.push('A previous answer for this same measurement is below. The reader asked again, so');
    lines.push('they were not satisfied with it: go deeper on the evidence rather than rephrasing.');
    lines.push('---');
    lines.push(opts.previous.slice(0, 4000));
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  return v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`;
}

export const SYSTEM_PROMPT = `You are advising a web engineering team on one page of their site, using its PageSpeed Insights results. Someone will act on what you write today, so it has to be correct and specific enough to start work from.

Accuracy comes first:
- Use only the evidence given. Never invent a filename, URL, element, script, library or number that does not appear above.
- Quote the measured savings the data gives. Do not estimate a number the data does not contain; if you must reason to a figure, say it is an estimate and show what you based it on.
- Do not guess the stack. Nothing above says what framework, CMS or CDN this site uses. If a fix depends on that, describe the change in terms of what must end up in the served HTML or headers.
- Lab and field data measure different things. Never present a lab number as what real users experience, and never treat TBT as INP.
- If the evidence does not support a confident recommendation, say what to measure or check next instead of filling the space.

Then make it actionable. For each fix, in priority order:
1. What to change, concretely — the specific resource, request, element or header, named from the evidence.
2. Why it is costing them, with the measured number attached.
3. Roughly what it should recover, and how confident that is.

Also:
- Lead with the single change that moves the numbers most. Order by impact, not by category.
- Group findings that share one root cause into one fix rather than repeating it. If the real problem is architectural — a heavy bundle, a blocking third-party tag, an unoptimised image pipeline — say so plainly instead of listing micro-optimisations around it.
- Say when something is cheap to do and when it is a project. A team needs to know which two things to do this afternoon.
- Skip anything already passing. Do not restate the scores back or explain what PageSpeed is.

Markdown, no preamble, under 450 words.`;
