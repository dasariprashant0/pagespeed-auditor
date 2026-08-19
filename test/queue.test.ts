import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { auditJobId, finalizeJobId, planSweepJobId } from '../lib/queue/names.ts';
import { shouldFinalize, percentComplete, etaSeconds, diffMissingPairs } from '../lib/services/run.service.ts';
import { throughputPerSecond, medianOf, formatDuration } from '../lib/services/estimate.service.ts';

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

describe('run estimates come from measured latency', () => {
  test('throughput is whichever constraint binds first', () => {
    // Fast pages: the rate limiter binds (0.75/s), not the 48-worker pool.
    assert.equal(throughputPerSecond(10_000, 48, 3, 4000).toFixed(2), '0.75');

    // Slow pages: with only 4 workers and 60s calls the POOL binds at 0.067/s.
    // Missing this is what silently tripled sweep time before.
    assert.ok(throughputPerSecond(60_000, 4, 3, 4000) < 0.1);

    // 48 workers over 60s calls clears the limiter again.
    assert.equal(throughputPerSecond(60_000, 48, 3, 4000).toFixed(2), '0.75');
  });

  test('median ignores outliers a mean would follow', () => {
    assert.equal(medianOf([10, 20, 30]), 20);
    assert.equal(medianOf([10, 20, 30, 900]), 25);
    assert.equal(medianOf([]), null);
  });

  test('durations are phrased without false precision', () => {
    assert.equal(formatDuration(37), 'about 35 seconds');
    assert.equal(formatDuration(300), 'about 5 minutes');
    assert.equal(formatDuration(3600), 'about 1 hour');
    assert.equal(formatDuration(5400), 'about 1h 30m');
  });
});
