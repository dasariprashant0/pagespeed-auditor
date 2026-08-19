import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMarkdownReport } from '../lib/report/markdown.ts';
import {
  upsertAiSection,
  extractAiSection,
  hasAiSection,
  AI_START,
  AI_END,
  AI_PLACEHOLDER,
} from '../lib/report/aiSection.ts';
import { extractResult } from '../lib/psi/extract.ts';
import type { PsiResponse } from '../lib/psi/types.ts';

const load = (n: string): PsiResponse =>
  JSON.parse(readFileSync(`test/fixtures/psi/${n}.json`, 'utf8'));

// Fixed clock -- the generator takes generatedAt precisely so this is stable.
const AT = new Date('2026-08-19T14:32:00Z');

const report = (fixture: string, extra: Partial<Parameters<typeof buildMarkdownReport>[0]> = {}) =>
  buildMarkdownReport({
    url: 'https://example.com/pricing',
    strategy: 'mobile',
    generatedAt: AT,
    result: extractResult(load(fixture)),
    ...extra,
  });

describe('markdown report', () => {
  test('has every section the spec requires', () => {
    const md = report('mobile-field-full');
    for (const h of [
      '# https://example.com/pricing — Mobile',
      '## Scores',
      '## Core Web Vitals (Lab)',
      '## Field Data (Real Users, 28-day)',
      '## Opportunities',
      '## Diagnostics',
      '## AI Recommendation',
    ]) {
      assert.ok(md.includes(h), `missing section: ${h}`);
    }
  });

  test('is deterministic for a fixed generatedAt', () => {
    assert.equal(report('mobile-field-full'), report('mobile-field-full'));
  });

  test('records the audit time and Lighthouse version', () => {
    const md = report('mobile-field-full');
    assert.ok(md.includes('Audited: 2026-08-19 14:32:00 UTC'));
    assert.ok(/Lighthouse 13\./.test(md));
  });

  test('INP is labelled as unavailable in lab, pointing at TBT', () => {
    // The single most important line in the report: it must never look like we
    // measured INP, and never silently show TBT under an INP label.
    const md = report('mobile-field-full');
    assert.ok(/\| INP \| — \| Not available in lab/.test(md), 'INP row must explain itself');
    assert.ok(md.includes('is the lab proxy'));
  });

  test('delta column appears only when there is a previous run', () => {
    assert.ok(!report('mobile-field-full').includes('vs. previous'));
    const withPrev = report('mobile-field-full', {
      previousScores: { performance: 80, accessibility: 90, bestPractices: 100, seo: 100 },
    });
    assert.ok(withPrev.includes('vs. previous'));
    assert.ok(/▲|▼|—/.test(withPrev));
  });

  test('field data present renders a table, not the empty-state note', () => {
    const md = report('mobile-no-field');
    assert.ok(md.includes('75th percentile'));
    assert.ok(!md.includes('Not enough real-user data'));
  });

  test('absent field data reads as a normal state, not an error', () => {
    const md = buildMarkdownReport({
      url: 'https://example.com/obscure',
      strategy: 'mobile',
      generatedAt: AT,
      result: extractResult({ lighthouseResult: { categories: {}, audits: {} } } as PsiResponse),
    });
    assert.ok(md.includes('Not enough real-user data for this URL'));
    assert.ok(!/error|failed/i.test(md.split('## Field Data')[1].split('##')[0]));
  });

  test('origin fallback is labelled as site-wide, never as page data', () => {
    const res = extractResult({
      originLoadingExperience: {
        overall_category: 'FAST',
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1200, category: 'FAST' } },
      },
      lighthouseResult: { categories: {}, audits: {} },
    } as PsiResponse);
    const md = buildMarkdownReport({ url: 'https://x.test/', strategy: 'mobile', generatedAt: AT, result: res });
    assert.ok(md.includes('Showing site-wide real-user data'));
  });

  test('a runtime error produces a short honest report, not a padded one', () => {
    const res = extractResult({
      lighthouseResult: { runtimeError: { code: 'NO_FCP' }, requestedUrl: 'https://x.test/' },
    } as PsiResponse);
    const md = buildMarkdownReport({ url: 'https://x.test/', strategy: 'mobile', generatedAt: AT, result: res });
    assert.ok(md.includes('## Audit failed'));
    assert.ok(md.includes('NO_FCP'));
    assert.ok(!md.includes('## Core Web Vitals'), 'should not render empty metric tables');
    assert.ok(md.includes(AI_START), 'sentinels must still be present for later use');
  });

  test('pipes in audit titles do not break the tables', () => {
    const md = report('mobile-no-field');
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) {
      const cells = line.split(/(?<!\\)\|/).length;
      assert.ok(cells >= 3, `malformed table row: ${line}`);
    }
  });

  test('starts with the placeholder, and reports no recommendation yet', () => {
    const md = report('mobile-field-full');
    assert.ok(md.includes(AI_PLACEHOLDER));
    assert.equal(hasAiSection(md), false);
    assert.equal(extractAiSection(md), null);
  });
});

describe('AI section splice', () => {
  test('replaces the placeholder in place', () => {
    const md = report('mobile-field-full');
    const out = upsertAiSection(md, 'Fix the render-blocking CSS first.');
    assert.ok(out.includes('Fix the render-blocking CSS first.'));
    assert.ok(!out.includes(AI_PLACEHOLDER));
    assert.equal(extractAiSection(out), 'Fix the render-blocking CSS first.');
  });

  test('regenerating replaces rather than stacking', () => {
    let md = report('mobile-field-full');
    md = upsertAiSection(md, 'First pass.');
    md = upsertAiSection(md, 'Second pass.');
    md = upsertAiSection(md, 'Third pass.');

    assert.equal(md.split(AI_START).length - 1, 1, 'exactly one start sentinel');
    assert.equal(md.split(AI_END).length - 1, 1, 'exactly one end sentinel');
    assert.equal((md.match(/## AI Recommendation/g) ?? []).length, 1);
    assert.ok(!md.includes('First pass.'));
    assert.equal(extractAiSection(md), 'Third pass.');
  });

  test('THE trap: an AI body with its own ## headings does not truncate the doc', () => {
    // Heading-based splitting would cut the body at "## Quick wins" and eat more
    // of the document on every regeneration. This is why sentinels exist.
    const body = [
      'Summary line.',
      '',
      '## Quick wins',
      '- Inline critical CSS',
      '',
      '## Root cause',
      'The shared CDN serves uncompressed assets.',
    ].join('\n');

    const md = upsertAiSection(report('mobile-field-full'), body);
    assert.ok(md.includes('## Quick wins'));
    assert.ok(md.includes('## Root cause'));
    assert.equal(extractAiSection(md), body);

    // And the surrounding report survives intact.
    assert.ok(md.includes('## Opportunities'));
    assert.ok(md.includes('## Core Web Vitals (Lab)'));

    // A second pass must still find the right boundaries.
    const again = upsertAiSection(md, 'Replaced.');
    assert.equal(extractAiSection(again), 'Replaced.');
    assert.ok(!again.includes('Quick wins'));
  });

  test('THE other trap: a body echoing a literal sentinel cannot corrupt the block', () => {
    const hostile = `Do this.\n${AI_END}\n## Injected\nrogue content\n${AI_START}`;
    const md = upsertAiSection(report('mobile-field-full'), hostile);

    assert.equal(md.split(AI_START).length - 1, 1);
    assert.equal(md.split(AI_END).length - 1, 1);

    // Still replaceable afterwards -- the real failure mode is a document that
    // can never be updated again.
    const again = upsertAiSection(md, 'Clean.');
    assert.equal(extractAiSection(again), 'Clean.');
  });

  test('appends a block when sentinels are missing entirely', () => {
    const legacy = '# Old report\n\n## Scores\n\nsome content\n';
    const out = upsertAiSection(legacy, 'New advice.');
    assert.ok(out.includes(AI_START) && out.includes(AI_END));
    assert.equal(extractAiSection(out), 'New advice.');
    assert.ok(out.includes('some content'), 'must not destroy the existing report');
  });

  test('surrounding report bytes are untouched by a splice', () => {
    const md = report('mobile-field-full');
    const before = md.slice(0, md.indexOf(AI_START));
    const after = upsertAiSection(md, 'Advice.');
    assert.equal(after.slice(0, after.indexOf(AI_START)), before);
  });
});
