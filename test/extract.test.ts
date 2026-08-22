import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractScores,
  extractLab,
  extractField,
  extractAudits,
  extractResult,
  fieldSourceOf,
} from '../lib/psi/extract.ts';
import { pruneResponse } from '../lib/psi/prune.ts';
import type { PsiResponse } from '../lib/psi/types.ts';

const DIR = 'test/fixtures/psi';
const load = (n: string): PsiResponse => JSON.parse(readFileSync(`${DIR}/${n}.json`, 'utf8'));

// mobile-origin-fallback is deliberately NOT in this list: it's a minimal
// echo-page fixture, kept only to prove the field-data discriminator
// against a real capture (see the origin_fallback test below) -- its low
// bulk means it fails the generic "prunes more than 30%" assertion every
// other fixture here satisfies, the same reason desktop-basic (a near-empty
// page) already prunes the least of the three.
const FIXTURES = ['mobile-field-full', 'desktop-basic', 'mobile-no-field'] as const;

describe('scores', () => {
  for (const name of FIXTURES) {
    test(`${name}: all four categories are 0-100 integers`, () => {
      const s = extractScores(load(name));
      for (const [k, v] of Object.entries(s)) {
        assert.notEqual(v, null, `${k} should have run`);
        assert.ok(Number.isInteger(v), `${k}=${v} must be an integer`);
        assert.ok(v! >= 0 && v! <= 100, `${k}=${v} out of range`);
      }
    });
  }

  test('best-practices resolves despite the hyphenated response key', () => {
    // The request param is BEST_PRACTICES but the response key is
    // "best-practices". Getting this wrong yields a silent null.
    assert.notEqual(extractScores(load('mobile-field-full')).bestPractices, null);
  });

  test('a category that did not run is null, not 0', () => {
    const res = { lighthouseResult: { categories: { performance: { score: null } } } } as PsiResponse;
    assert.equal(extractScores(res).performance, null);
  });

  test('rounds rather than truncates', () => {
    const res = { lighthouseResult: { categories: { performance: { score: 0.925 } } } } as PsiResponse;
    assert.equal(extractScores(res).performance, 93);
  });
});

describe('lab metrics', () => {
  for (const name of FIXTURES) {
    test(`${name}: INP is absent from lab, TBT is present`, () => {
      const lab = extractLab(load(name));
      // This is the load-bearing assertion behind the nullable-inp column.
      assert.equal(lab.inp, null, 'lab INP must be null -- INP is field-only');
      assert.notEqual(lab.tbt, null, 'TBT is the lab proxy and must be populated');
    });

    test(`${name}: core lab timings extract`, () => {
      const lab = extractLab(load(name));
      for (const k of ['lcp', 'cls', 'fcp', 'ttfb', 'speedIndex'] as const) {
        assert.equal(typeof lab[k], 'number', `${k} should be numeric`);
      }
    });
  }

  test('TBT is never written into inp', () => {
    const lab = extractLab(load('mobile-field-full'));
    if (lab.tbt !== null && lab.tbt !== 0) assert.notEqual(lab.inp, lab.tbt);
  });
});

describe('field (CrUX) data', () => {
  test('CLS percentile is divided by 100', () => {
    // Recorded fixture has raw percentile 11, meaning CLS 0.11. Storing 11
    // would make every page look catastrophic.
    const f = extractField(load('mobile-no-field'));
    const cls = f.metrics.cls;
    assert.ok(cls, 'expected CLS field data in this fixture');
    assert.ok(cls!.value < 1, `CLS ${cls!.value} must be the real value, not x100`);
    assert.equal(Math.round(cls!.value * 100), 11);
  });

  test('non-CLS metrics keep their natural unit', () => {
    const f = extractField(load('mobile-no-field'));
    assert.ok((f.metrics.lcp?.value ?? 0) > 100, 'LCP is in ms, should not be scaled');
  });

  test('origin_fallback absent (not false) still means page-level data', () => {
    // PSI omits the key entirely on page data, so `=== true` is the only safe test.
    assert.equal(fieldSourceOf({ metrics: { X: { percentile: 1 } } }), 'page');
    assert.equal(fieldSourceOf({ metrics: { X: { percentile: 1 } }, origin_fallback: true }), 'origin_fallback');
  });

  test('missing field data is a normal state, not an error', () => {
    const f = extractField({} as PsiResponse);
    assert.equal(f.source, 'none');
    assert.deepEqual(f.metrics, {});
    assert.equal(f.overall, null);
  });

  test('falls back to origin data only when the page has none', () => {
    const res = {
      originLoadingExperience: {
        overall_category: 'FAST',
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1200, category: 'FAST' } },
      },
    } as PsiResponse;
    const f = extractField(res);
    assert.equal(f.source, 'origin_fallback', 'must be labelled as origin data, not page data');
    assert.equal(f.metrics.lcp?.value, 1200);
  });

  test('mobile-origin-fallback: a real captured origin_fallback response is labelled correctly', () => {
    // Every other case above is hand-built, per docs/RESUME_HERE.md's note
    // that this shape had never actually been seen in the wild as of 20 Aug
    // 2026 -- this fixture (test/fixtures/psi/mobile-origin-fallback.json,
    // httpbin.org, captured 22 Aug 2026) is a real PSI response where this
    // specific page has no CrUX entry of its own but its origin does.
    const f = extractField(load('mobile-origin-fallback'));
    assert.equal(f.source, 'origin_fallback');
    assert.ok(Object.keys(f.metrics).length > 0, 'origin-level metrics should still populate');
  });
});

describe('audits', () => {
  test('finds real issues and classifies insights as opportunities', () => {
    const audits = extractAudits(load('mobile-no-field'));
    assert.ok(audits.length > 0, 'expected failing audits on this page');

    // LH13 renamed load-opportunities -> insights. If this is empty, the group
    // mapping has regressed and every page will look clean.
    const opps = audits.filter((a) => a.kind === 'opportunity');
    assert.ok(opps.length > 0, 'no opportunities found -- insights group mapping broken?');
    assert.ok(audits.some((a) => a.auditId === 'render-blocking-insight'));
  });

  test('metrics-group audits are excluded (already stored as columns)', () => {
    const audits = extractAudits(load('mobile-no-field'));
    assert.ok(
      !audits.some((a) => a.auditId === 'cumulative-layout-shift'),
      'metric audits must not double-count as issues',
    );
  });

  test('only failing, scored audits are included', () => {
    for (const a of extractAudits(load('mobile-field-full'))) {
      assert.ok(a.score !== null && a.score < 0.9, `${a.auditId} scored ${a.score}`);
      assert.ok(['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode));
    }
  });

  test('savings come from metricSavings, and CLS is never counted as milliseconds', () => {
    const audits = extractAudits(load('mobile-no-field'));
    const rb = audits.find((a) => a.auditId === 'render-blocking-insight');
    assert.ok(rb, 'expected render-blocking-insight');
    // Fixture has metricSavings {LCP:600, FCP:600} and no overallSavingsMs.
    assert.equal(rb!.savingsMs, 600);

    const layoutShifts = audits.find((a) => a.auditId === 'layout-shifts');
    if (layoutShifts) {
      // Its only saving is CLS (0.172, unitless). Adding that to a ms total
      // would be nonsense, so it must be null.
      assert.equal(layoutShifts.savingsMs, null, 'CLS savings must not become milliseconds');
    }
  });

  test('a11y/SEO failures are captured as "other"', () => {
    const audits = extractAudits(load('mobile-no-field'));
    const a11y = audits.filter((a) => a.category === 'accessibility');
    assert.ok(a11y.length > 0, 'expected accessibility failures on this fixture');
    assert.ok(a11y.every((a) => a.kind === 'other'));
  });

  test('sorted by savings descending', () => {
    const audits = extractAudits(load('mobile-no-field'));
    const sav = audits.map((a) => a.savingsMs ?? 0);
    assert.deepEqual(sav, [...sav].sort((x, y) => y - x));
  });
});

describe('runtime errors', () => {
  test('a runtimeError yields an error row with null scores, not a throw', () => {
    const res = {
      lighthouseResult: { runtimeError: { code: 'NO_FCP' }, requestedUrl: 'https://x.test/' },
    } as PsiResponse;
    const r = extractResult(res);
    assert.equal(r.status, 'error');
    assert.equal(r.runtimeError, 'NO_FCP');
    assert.equal(r.scores.performance, null);
    assert.deepEqual(r.audits, []);
  });
});

describe('extractResult is total', () => {
  test('never throws on an empty or sparse response', () => {
    assert.doesNotThrow(() => extractResult({} as PsiResponse));
    assert.doesNotThrow(() => extractResult({ lighthouseResult: {} } as PsiResponse));
  });

  for (const name of FIXTURES) {
    test(`${name}: full extraction succeeds`, () => {
      const r = extractResult(load(name));
      assert.equal(r.status, 'ok');
      assert.ok(r.lighthouseVersion, 'lighthouseVersion should be captured');
      assert.ok(r.finalUrl, 'finalUrl should be captured');
    });
  }
});

describe('prune', () => {
  for (const name of FIXTURES) {
    test(`${name}: removes bulk and still round-trips`, () => {
      const raw = load(name);
      const { pruned, stats } = pruneResponse(raw);
      assert.ok(stats.removedPct > 30, `only removed ${stats.removedPct.toFixed(1)}%`);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(pruned)));
    });

    test(`${name}: pruning does not disturb extraction`, () => {
      // Prune must never mutate its input -- extraction runs on the original.
      const raw = load(name);
      const before = extractResult(raw);
      pruneResponse(raw);
      assert.deepEqual(extractResult(raw), before);
    });

    test(`${name}: the heavy keys are actually gone`, () => {
      const { pruned } = pruneResponse(load(name));
      const lr = pruned.lighthouseResult!;
      assert.equal(lr.fullPageScreenshot, undefined, 'fullPageScreenshot is a top-level key');
      assert.equal(lr.audits?.['screenshot-thumbnails'], undefined);
      assert.equal(lr.timing, undefined);
    });
  }
});
