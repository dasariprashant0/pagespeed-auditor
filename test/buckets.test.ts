import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, bucketFromCruxCategory, scoreBand, isWorse, THRESHOLDS } from '../lib/psi/buckets.ts';

describe('CWV buckets', () => {
  test('boundaries are inclusive at good, exclusive at poor', () => {
    assert.equal(bucketOf('lcp', 2500), 'good', '2500ms is exactly Good');
    assert.equal(bucketOf('lcp', 2501), 'ni');
    assert.equal(bucketOf('lcp', 4000), 'ni', '4000ms is still NI, not Poor');
    assert.equal(bucketOf('lcp', 4001), 'poor');
  });

  test('CLS uses unitless thresholds', () => {
    assert.equal(bucketOf('cls', 0.1), 'good');
    assert.equal(bucketOf('cls', 0.11), 'ni');
    assert.equal(bucketOf('cls', 0.26), 'poor');
  });

  test('null and NaN are absent, not zero', () => {
    assert.equal(bucketOf('lcp', null), null);
    assert.equal(bucketOf('lcp', undefined), null);
    assert.equal(bucketOf('lcp', NaN), null);
    // 0 is a real, excellent value -- must NOT be treated as missing.
    assert.equal(bucketOf('cls', 0), 'good');
  });

  test('tbt has thresholds but is not addressable as a CWV metric id', () => {
    assert.equal(bucketOf('tbt', 200), 'good');
    assert.equal(bucketOf('tbt', 601), 'poor');
    // INP thresholds must differ from TBT's, or conflating them would be silent.
    assert.notDeepEqual(THRESHOLDS.inp, THRESHOLDS.tbt);
  });
});

describe('CrUX category vocabulary', () => {
  test('accepts the FAST/AVERAGE/SLOW vocabulary PSI actually emits', () => {
    assert.equal(bucketFromCruxCategory('FAST'), 'good');
    assert.equal(bucketFromCruxCategory('AVERAGE'), 'ni');
    assert.equal(bucketFromCruxCategory('SLOW'), 'poor');
  });

  test('also accepts the GOOD/NEEDS_IMPROVEMENT/POOR vocabulary from CrUX proper', () => {
    assert.equal(bucketFromCruxCategory('GOOD'), 'good');
    assert.equal(bucketFromCruxCategory('NEEDS_IMPROVEMENT'), 'ni');
    assert.equal(bucketFromCruxCategory('POOR'), 'poor');
  });

  test('unknown or missing category is null, never a guess', () => {
    assert.equal(bucketFromCruxCategory(undefined), null);
    assert.equal(bucketFromCruxCategory('WAT'), null);
  });
});

describe('score bands match PSI', () => {
  test('red <50, orange 50-89, green 90+', () => {
    assert.equal(scoreBand(49), 'fail');
    assert.equal(scoreBand(50), 'average');
    assert.equal(scoreBand(89), 'average');
    assert.equal(scoreBand(90), 'pass');
    assert.equal(scoreBand(0), 'fail', '0 is a real failing score, not missing');
    assert.equal(scoreBand(null), null);
  });
});

describe('bucket ordering', () => {
  test('worse means further from good', () => {
    assert.ok(isWorse('poor', 'ni'));
    assert.ok(isWorse('ni', 'good'));
    assert.ok(!isWorse('good', 'good'));
    assert.ok(!isWorse('good', 'poor'));
  });
});
