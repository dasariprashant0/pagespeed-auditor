import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pruneResponse } from '../lib/psi/prune.ts';
import { extractField, fieldJsonOf } from '../lib/psi/extract.ts';
import {
  buildFieldData,
  detailsFromRawJson,
  environmentFromRawJson,
  passedAuditsFromRawJson,
} from '../lib/services/report.service.ts';
import type { PsiResponse } from '../lib/psi/types.ts';

const load = (n: string): PsiResponse =>
  JSON.parse(readFileSync(new URL(`./fixtures/psi/${n}.json`, import.meta.url), 'utf8'));

// Everything below reads the PRUNED response, which is what the report really
// sees -- evidence that pruning strips is evidence the report cannot show.
const stored = (n: string) => pruneResponse(load(n)).pruned;

describe('report shows what PSI returns', () => {
  test('field distribution bars survive the stored fieldJson shape', () => {
    const res = load('mobile-field-full');
    const f = extractField(res);
    const d = buildFieldData(
      {
        fieldSource: f.source,
        fieldOverall: f.overall,
        fieldLcp: f.metrics.lcp?.value ?? null,
        fieldInp: f.metrics.inp?.value ?? null,
        fieldCls: f.metrics.cls?.value ?? null,
        fieldFcp: f.metrics.fcp?.value ?? null,
        fieldTtfb: f.metrics.ttfb?.value ?? null,
      },
      fieldJsonOf(res),
    );
    assert.ok(d.metrics.lcp?.distribution, 'distribution was null for every real row before');
    assert.ok(d.origin, 'origin data is shown alongside page data');
    assert.ok(Object.keys(d.origin.metrics).length > 0);
  });

  test('list-type insights carry their evidence', () => {
    const tables = detailsFromRawJson(stored('mobile-no-field'));
    assert.ok(tables.get('cls-culprits-insight')?.some((t) => t.rows.length > 0), 'CLS culprits');
    assert.ok(tables.get('lcp-breakdown-insight')?.some((t) => t.rows.length > 0), 'LCP breakdown');
    const chain = tables.get('network-dependency-tree-insight')?.find((t) => t.headings.some((h) => h.key === 'longest'));
    assert.ok(chain && chain.rows.length > 1, 'critical request chain is flattened');
    assert.ok(tables.get('document-latency-insight')?.[0].rows.every((r) => r.status === 'Passed' || r.status === 'Failed'));
  });

  test('sub-items render as indented rows under their parent', () => {
    const t = detailsFromRawJson(stored('mobile-no-field')).get('cls-culprits-insight')!.flatMap((x) => x.rows);
    assert.ok(t.some((r) => Object.values(r)[0].startsWith('↳ ')), 'the font that caused the shift is listed');
  });

  test('informative insights and manual checks get their own sections', () => {
    const b = passedAuditsFromRawJson(stored('mobile-no-field'));
    assert.ok(b.informative.some((a) => a.auditId === 'lcp-breakdown-insight'));
    assert.ok(!b.passed.some((a) => a.auditId === 'lcp-breakdown-insight'), 'not a "passed" audit');
    assert.equal(b.manual.length, 11);
    assert.ok(!b.notApplicable.some((a) => b.manual.some((m) => m.auditId === a.auditId)));
    assert.ok(b.informative.find((a) => a.auditId === 'lcp-breakdown-insight')!.metrics.includes('LCP'));
  });

  test('run environment includes browser, warnings and redirect', () => {
    const e = environmentFromRawJson(stored('mobile-field-full'));
    assert.match(e.browser ?? '', /HeadlessChrome\/\d+.*CPU benchmark \d+/);
    assert.deepEqual(e.warnings, []);
    assert.equal(e.redirectedTo, null);
  });

  test('stack packs survive pruning, minus their inline icon', () => {
    const res = load('desktop-basic');
    (res.lighthouseResult as { stackPacks?: unknown }).stackPacks = [{ id: 'wp', title: 'WordPress', iconDataURL: 'data:x', descriptions: { 'unused-css-rules': 'Use a plugin' } }] as never;
    const packs = (pruneResponse(res).pruned.lighthouseResult as { stackPacks?: Array<Record<string, unknown>> }).stackPacks;
    assert.equal(packs?.[0].title, 'WordPress');
    assert.equal(packs?.[0].iconDataURL, undefined);
  });
});
