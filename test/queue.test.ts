import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditJobId, finalizeJobId, planSweepJobId } from '../lib/queue/names.ts';
import { shouldFinalize, percentComplete, etaSeconds, diffMissingPairs } from '../lib/services/run.service.ts';

describe('job ids are legal BullMQ custom ids', () => {
  test('never contain a colon', () => {
    // BullMQ v6 namespaces its own Redis keys with ':' and rejects a custom id
    // containing one. It throws at ENQUEUE time, so the run row is created and
    // then gets zero jobs -- a run that can never reach totalJobs and never
    // finalizes. Found by running it, not by review.
    const ids = [
      auditJobId('run123', 'page456', 'mobile'),
      finalizeJobId('run123'),
      planSweepJobId('site1', new Date('2026-08-19T14:32:00Z')),
    ];
    for (const id of ids) {
      assert.ok(!id.includes(':'), `job id "${id}" contains a colon`);
    }
  });

  test('are unique per (run, page, strategy) and stable', () => {
    assert.notEqual(auditJobId('r', 'p', 'mobile'), auditJobId('r', 'p', 'desktop'));
    assert.notEqual(auditJobId('r', 'p1', 'mobile'), auditJobId('r', 'p2', 'mobile'));
    // Stability is what makes a replayed enqueue a no-op.
    assert.equal(auditJobId('r', 'p', 'mobile'), auditJobId('r', 'p', 'mobile'));
  });

  test('one finalize id per run, so a race enqueues once', () => {
    assert.equal(finalizeJobId('abc'), finalizeJobId('abc'));
    assert.notEqual(finalizeJobId('abc'), finalizeJobId('abd'));
  });
});

describe('finalize threshold', () => {
  test('fires only when every job has reported', () => {
    assert.equal(shouldFinalize({ completedJobs: 9, totalJobs: 10 }), false);
    assert.equal(shouldFinalize({ completedJobs: 10, totalJobs: 10 }), true);
  });

  test('tolerates overshoot rather than hanging', () => {
    // A replay that slipped past the guard must not leave the run un-finalizable.
    assert.equal(shouldFinalize({ completedJobs: 11, totalJobs: 10 }), true);
  });

  test('an empty run does not finalize on a zero total', () => {
    assert.equal(shouldFinalize({ completedJobs: 0, totalJobs: 0 }), false);
  });
});

describe('progress maths', () => {
  test('percent is clamped and divide-by-zero safe', () => {
    assert.equal(percentComplete(0, 0), 0);
    assert.equal(percentComplete(5, 10), 50);
    assert.equal(percentComplete(11, 10), 100);
  });

  test('eta is null until there is something to extrapolate from', () => {
    const now = new Date('2026-08-19T12:01:00Z');
    const started = new Date('2026-08-19T12:00:00Z');
    assert.equal(etaSeconds(0, 10, started, now), null, 'no completed jobs yet');
    assert.equal(etaSeconds(10, 10, started, now), null, 'already done');
    assert.equal(etaSeconds(0, 10, null, now), null, 'never started');
    // 5 of 10 in 60s -> 60s remaining.
    assert.equal(etaSeconds(5, 10, started, now), 60);
  });
});

describe('resume', () => {
  test('re-enqueues only the pairs with no result', () => {
    const expected = [
      { pageId: 'a', url: 'u', strategy: 'mobile' as const },
      { pageId: 'a', url: 'u', strategy: 'desktop' as const },
      { pageId: 'b', url: 'v', strategy: 'mobile' as const },
    ];
    const done = [
      { pageId: 'a', strategy: 'mobile' },
      { pageId: 'b', strategy: 'mobile' },
    ];
    const missing = diffMissingPairs(expected, done);
    assert.equal(missing.length, 1);
    assert.deepEqual(missing[0], { pageId: 'a', url: 'u', strategy: 'desktop' });
  });
});
