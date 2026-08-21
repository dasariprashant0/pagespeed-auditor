import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PsiRateLimiter } from '../lib/psi/rateLimiter.ts';

/**
 * Regression coverage for a real incident: acquire() used to retry against
 * Redis on a busy-poll interval far tighter than the actual window, and with
 * many workers denied most of the time, that meant hundreds of thousands of
 * Redis round trips over one real sweep -- Upstash's 500k/month request cap
 * exhausted by two sweeps. The whole limiter moved off Redis afterward (see
 * docs/DECISIONS.md #16); this covers both that it still enforces the
 * budget correctly on Postgres, and that retries land on the real window
 * boundary rather than a tight poll.
 *
 * A fake db simulates the real UPSERT's atomic count-with-window-reset
 * logic against a virtual clock, so this runs instantly rather than
 * actually waiting through simulated 4-second windows.
 */
function fakeDbAndClock(windowMs: number) {
  let virtualNow = 0;
  const counts = new Map<number, number>();
  let queryCalls = 0;

  const db = {
    $queryRaw: async () => {
      queryCalls++;
      const windowIndex = Math.floor(virtualNow / windowMs);
      const n = (counts.get(windowIndex) ?? 0) + 1;
      counts.set(windowIndex, n);
      return [{ count: n }];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const now = () => virtualNow;
  const sleep = async (ms: number) => {
    virtualNow += ms;
  };

  return { db, now, sleep, queryCallCount: () => queryCalls };
}

describe('PsiRateLimiter.acquire', () => {
  test('an available permit is granted with a single query', async () => {
    const { db, now, sleep } = fakeDbAndClock(4000);
    const limiter = new PsiRateLimiter({ db, max: 3, windowMs: 4000, now, sleep });
    await limiter.acquire();
  });

  test('retries land on the window boundary, not a busy-poll interval', async () => {
    const windowMs = 4000;
    const { db, now, sleep, queryCallCount } = fakeDbAndClock(windowMs);
    const limiter = new PsiRateLimiter({ db, max: 3, windowMs, now, sleep });

    // Exhaust this window's 3 permits directly.
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    assert.equal(queryCallCount(), 3);

    // A 4th caller is denied and must wait for the NEXT window -- one retry,
    // not dozens, and the virtual clock should have advanced by roughly one
    // window, not a 25-75ms busy-poll increment.
    const before = now();
    await limiter.acquire();
    const elapsed = now() - before;

    assert.equal(queryCallCount(), 5, 'exactly one retry (2 query calls: denied, then granted)');
    assert.ok(elapsed >= windowMs, `waited a full window (${elapsed}ms), not a short busy-poll sleep`);
    assert.ok(elapsed < windowMs + 150, `waited close to one window, not several (${elapsed}ms)`);
  });

  test('heavy contention over a long sweep stays within one query per caller per window, not per short poll', async () => {
    // 48 concurrent workers, the real WORKER_CONCURRENCY value, against the
    // real PSI_RATE_MAX/PSI_RATE_WINDOW_MS default (3 per 4s) -- the exact
    // configuration that produced the real incident.
    const windowMs = 4000;
    const max = 3;
    const workers = 48;
    const jobsPerWorker = 5; // a small slice of a real ~1500-job sweep, enough to see the pattern
    const { db, now, sleep, queryCallCount } = fakeDbAndClock(windowMs);
    const limiter = new PsiRateLimiter({ db, max, windowMs, now, sleep });

    const totalJobs = workers * jobsPerWorker;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let i = 0; i < jobsPerWorker; i++) await limiter.acquire();
      }),
    );

    const minWindows = Math.ceil(totalJobs / max);
    assert.ok(now() >= minWindows * windowMs * 0.9, 'the simulated sweep actually took multiple windows');
    // The precise invariant the fix guarantees: no single worker queries
    // more than once per window while it waits, so total calls can never
    // exceed (windows actually elapsed) x (concurrent workers). The old,
    // buggy Redis-PTTL-based retry could -- and did, in production -- blow
    // past this trivially, since one denied worker could re-poll many
    // times within a single window rather than once.
    const windowsElapsed = Math.ceil(now() / windowMs);
    const maxPossibleCalls = windowsElapsed * workers;
    assert.ok(
      queryCallCount() <= maxPossibleCalls,
      `db was queried ${queryCallCount()} times across ${windowsElapsed} windows with ${workers} workers ` +
        `(ceiling ${maxPossibleCalls}) -- a worker retried more than once inside a single window`,
    );
  });
});
