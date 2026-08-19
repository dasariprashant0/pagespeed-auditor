import type { PageReportDTO, AuditItemDTO } from '../services/types.ts';

/**
 * A report written for a coding agent, not for a person.
 *
 * The human report answers "how is this page doing". This answers "what should
 * I change", which needs different content:
 *
 *  - the actual offending resources, selectors and sizes, not just audit titles
 *  - the measured cost of each problem, so the agent can order its own work
 *  - what is already fine, so it does not 'fix' passing things
 *  - explicit uncertainty, so it does not invent a stack it cannot see
 *
 * Deliberately framework-agnostic. The tool cannot tell Webflow from Next.js
 * from WordPress, and guessing produces confidently wrong instructions -- so it
 * states the evidence precisely and lets the agent, which can read the repo,
 * decide how to apply it.
 */

export interface AgentReportOptions {
  /** Include audits that passed. Off by default: it is a lot of noise. */
  includePassed?: boolean;
  /** Rows of evidence per audit. */
  maxRows?: number;
}

export function buildAgentReport(report: PageReportDTO, opts: AgentReportOptions = {}): string {
  const r = report.result;
  const maxRows = opts.maxRows ?? 15;
  const out: string[] = [];

  out.push(`# Fix report: ${report.page.url}`);
  out.push('');
  out.push(`Tested as: **${report.strategy === 'mobile' ? 'mobile' : 'desktop'}**`);

  if (!r) {
    out.push('');
    out.push('This page has not been audited on this strategy, so there is nothing to act on.');
    return out.join('\n');
  }

  if (r.status === 'error') {
    out.push('');
    out.push('## The page could not be measured');
    out.push('');
    out.push(`Lighthouse returned \`${r.runtimeError}\`. It never rendered, so no metrics exist.`);
    out.push('');
    out.push('Likely causes, in the order worth checking:');
    out.push('- the URL returns a non-200 status, or redirects somewhere that does');
    out.push('- the page requires authentication');
    out.push('- rendering depends on JavaScript that throws before first paint');
    out.push('- a bot/WAF rule is blocking Google\'s crawler specifically');
    out.push('');
    out.push('Fix reachability first; performance work is meaningless until it renders.');
    return out.join('\n');
  }

  out.push(`Measured: ${new Date(r.fetchedAt).toISOString()} · Lighthouse ${r.lighthouseVersion ?? 'unknown'}`);
  if (r.environment.networkThrottling) {
    out.push(`Conditions: ${r.environment.device ?? ''} · ${r.environment.networkThrottling} · ${r.environment.cpuThrottling ?? ''}`);
  }
  out.push('');

  // --- what the agent is being asked to move ------------------------------
  out.push('## Current scores');
  out.push('');
  out.push('| Category | Score | |');
  out.push('|---|---:|---|');
  for (const [label, v] of [
    ['Performance', r.scores.performance],
    ['Accessibility', r.scores.accessibility],
    ['Best Practices', r.scores.bestPractices],
    ['SEO', r.scores.seo],
  ] as const) {
    out.push(`| ${label} | ${v ?? '—'} | ${band(v)} |`);
  }
  out.push('');

  out.push('## Metrics');
  out.push('');
  out.push('| Metric | Lab | Real users (75th pct) | Target |');
  out.push('|---|---:|---:|---|');
  const field = (k: 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb') => {
    const m = r.field.metrics[k];
    if (!m) return '—';
    return k === 'cls' ? m.value.toFixed(3) : ms(m.value);
  };
  out.push(`| LCP | ${ms(r.lab.lcp)} | ${field('lcp')} | under 2.5 s |`);
  out.push(`| CLS | ${r.lab.cls?.toFixed(3) ?? '—'} | ${field('cls')} | under 0.1 |`);
  out.push(`| INP | not measurable in lab | ${field('inp')} | under 200 ms |`);
  out.push(`| TBT | ${ms(r.lab.tbt)} | — | under 200 ms |`);
  out.push(`| FCP | ${ms(r.lab.fcp)} | ${field('fcp')} | under 1.8 s |`);
  out.push(`| TTFB | ${ms(r.lab.ttfb)} | ${field('ttfb')} | under 800 ms |`);
  out.push('');
  if (r.field.source === 'none') {
    out.push('> No real-user data for this URL — too little traffic for Chrome UX Report. Lab numbers only.');
  } else if (r.field.source === 'origin_fallback') {
    out.push('> Real-user figures are site-wide, not this page: it has too little traffic of its own. Treat them as context, not as this page\'s behaviour.');
  }
  out.push('');

  // --- the actionable part ------------------------------------------------
  const sections: Array<[string, AuditItemDTO[], string]> = [
    ['Problems to fix, highest impact first', r.opportunities, 'Each entry lists the specific resources responsible.'],
    ['Diagnostics', r.diagnostics, 'Contributing factors rather than direct wins.'],
    ['Accessibility, best practices and SEO', r.other, 'Usually concrete and cheap to fix.'],
  ];

  for (const [title, items, note] of sections) {
    if (items.length === 0) continue;
    out.push(`## ${title}`);
    out.push('');
    out.push(note);
    out.push('');

    for (const [i, a] of items.entries()) {
      out.push(`### ${i + 1}. ${a.title}`);
      const cost = [
        a.savingsMs !== null ? `saves ~${ms(a.savingsMs)}` : null,
        a.savingsBytes !== null ? `${kib(a.savingsBytes)} smaller` : null,
        a.displayValue,
      ].filter(Boolean);
      if (cost.length) out.push(`**Measured cost:** ${cost.join(' · ')}`);
      out.push('');
      if (a.description) {
        // Lighthouse descriptions carry the canonical explanation and a doc link.
        out.push(a.description.replace(/\s+/g, ' ').trim());
        out.push('');
      }
      if (a.details && a.details.rows.length > 0) {
        out.push('Affected:');
        out.push('');
        out.push(`| ${a.details.headings.map((h) => h.label).join(' | ')} |`);
        out.push(`|${a.details.headings.map(() => '---').join('|')}|`);
        for (const row of a.details.rows.slice(0, maxRows)) {
          out.push(`| ${a.details.headings.map((h) => (row[h.key] || '—').replace(/\|/g, '\\|')).join(' | ')} |`);
        }
        if (a.details.truncated) out.push('');
        if (a.details.truncated) out.push(`_(first ${Math.min(maxRows, a.details.rows.length)} shown)_`);
        out.push('');
      }
    }
  }

  if (opts.includePassed && r.passed.length > 0) {
    out.push('## Already passing — do not change these');
    out.push('');
    for (const a of r.passed) out.push(`- ${a.title}`);
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('## Instructions');
  out.push('');
  out.push('Work through the problems above in order; they are sorted by measured impact.');
  out.push('');
  out.push('- The resource URLs and selectors above are real and taken from this page. Locate them in the codebase before changing anything.');
  out.push('- This report cannot see the codebase, so it does not know the framework or build setup. Determine that yourself and apply the fix in the way that stack actually supports.');
  out.push('- Some findings may not be fixable from application code — a third-party tag, a CDN setting, a CMS constraint. Say so rather than working around it.');
  out.push('- Do not change anything listed as already passing.');
  out.push('- Re-run the audit afterwards to confirm the numbers moved.');

  return out.join('\n');
}

function ms(v: number | null): string {
  if (v === null) return '—';
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}
function kib(v: number): string {
  return v < 1024 ? `${Math.round(v)} B` : v < 1048576 ? `${Math.round(v / 1024)} KiB` : `${(v / 1048576).toFixed(1)} MiB`;
}
function band(v: number | null): string {
  if (v === null) return '';
  return v < 50 ? 'poor' : v < 90 ? 'needs work' : 'good';
}
