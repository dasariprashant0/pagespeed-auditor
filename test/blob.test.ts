import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathnameFor } from '../lib/blob.ts';

/**
 * Just the pathname logic -- storeRawJson/fetchRawJson/deleteRawJsonBlobs
 * all call the real @vercel/blob SDK and need a live token this test suite
 * deliberately doesn't have (see docs/DECISIONS.md §13). What's actually
 * worth pinning down offline is that the naming scheme can't collide.
 */
describe('blob pathname', () => {
  test('is keyed by run, page and strategy, not the row id', () => {
    assert.equal(pathnameFor('run1', 'page1', 'mobile'), 'audit-raw-json/run1/page1-mobile.json');
  });

  test('mobile and desktop for the same page never collide', () => {
    assert.notEqual(pathnameFor('run1', 'page1', 'mobile'), pathnameFor('run1', 'page1', 'desktop'));
  });

  test('two different runs auditing the same page never collide', () => {
    assert.notEqual(pathnameFor('run1', 'page1', 'mobile'), pathnameFor('run2', 'page1', 'mobile'));
  });
});
