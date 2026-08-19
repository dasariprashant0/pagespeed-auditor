import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectRegressions, type ScoreSnapshot } from '../lib/services/regression.service.ts';

const base: ScoreSnapshot = {
  performance: 80, accessibility: 90, bestPractices: 90, seo: 90,
  lcp: 2000, cls: 0.05, fcp: 1500, ttfb: 500, inp: null,
};
const snap = (o: Partial<ScoreSnapshot>): ScoreSnapshot => ({ ...base, ...o });

describe('regression detection is deliberately noise-tolerant', () => {
  test('a small single-run dip is NOT flagged', () => {
    // Lighthouse throttling is simulated, so ±8 points between runs is ordinary.
    // Flagging it trains people to ignore the flag.
    const r = detectRegressions([snap({ performance: 72 }), snap({ performance: 80 })]);
    assert.equal(r.length, 0);
  });

  test('a 20+ point single-run drop IS flagged, as critical', () => {
    const r = detectRegressions([snap({ performance: 55 }), snap({ performance: 80 })]);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, 'single-run-drop');
    assert.equal(r[0].severity, 'critical');
    assert.equal(r[0].delta, -25);
  });

  test('a 10-point drop that PERSISTS is flagged', () => {
    // 80 -> 68 -> 67: dropped and stayed down.
    const r = detectRegressions([
      snap({ performance: 67 }), snap({ performance: 68 }), snap({ performance: 80 }),
    ]);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, 'sustained-drop');
    assert.equal(r[0].severity, 'warning');
  });

  test('a 10-point drop that RECOVERS is not flagged', () => {
    // 80 -> 68 -> 79: this is the case the persistence rule exists for.
    const r = detectRegressions([
      snap({ performance: 79 }), snap({ performance: 68 }), snap({ performance: 80 }),
    ]);
    assert.equal(r.length, 0);
  });

  test('a large drop is reported once, not twice', () => {
    const r = detectRegressions([
      snap({ performance: 50 }), snap({ performance: 78 }), snap({ performance: 80 }),
    ]);
    assert.equal(r.filter((x) => x.metric === 'performance').length, 1);
  });
});

describe('Core Web Vital band changes', () => {
  test('a band drop that sticks is flagged', () => {
    // LCP 2000 (Good) -> 3000 (NI) -> 3200 (NI).
    const r = detectRegressions([snap({ lcp: 3200 }), snap({ lcp: 3000 }), snap({ lcp: 2000 })]);
    const lcp = r.find((x) => x.metric === 'lcp');
    assert.ok(lcp, 'expected an LCP downgrade');
    assert.equal(lcp!.from, 'Good');
    assert.equal(lcp!.to, 'Needs improvement');
  });

  test('a band drop that bounces back is not flagged', () => {
    const r = detectRegressions([snap({ lcp: 2100 }), snap({ lcp: 3000 }), snap({ lcp: 2000 })]);
    assert.equal(r.filter((x) => x.metric === 'lcp').length, 0);
  });

  test('falling into Poor is critical, not merely a warning', () => {
    const r = detectRegressions([snap({ lcp: 5000 }), snap({ lcp: 4500 }), snap({ lcp: 2000 })]);
    assert.equal(r.find((x) => x.metric === 'lcp')?.severity, 'critical');
  });

  test('movement WITHIN a band is not a regression', () => {
    // 2000 -> 2400 is worse but still Good; a band is the unit of meaning.
    const r = detectRegressions([snap({ lcp: 2400 }), snap({ lcp: 2200 }), snap({ lcp: 2000 })]);
    assert.equal(r.filter((x) => x.metric === 'lcp').length, 0);
  });

  test('a null metric never produces a regression', () => {
    // INP is null in lab on every page; it must not generate noise.
    const r = detectRegressions([snap({}), snap({}), snap({})]);
    assert.equal(r.filter((x) => x.metric === 'inp').length, 0);
  });
});

describe('insufficient history', () => {
  test('one audit yields nothing', () => {
    assert.deepEqual(detectRegressions([snap({})]), []);
  });
  test('two audits can only trigger the single-run rule', () => {
    const r = detectRegressions([snap({ performance: 40 }), snap({ performance: 80 })]);
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, 'single-run-drop');
  });
});
