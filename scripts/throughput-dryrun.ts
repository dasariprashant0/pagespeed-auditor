/**
 * THE GATE (docs/PLAN.md, M3).
 *
 * Every duration estimate in this project rests on one number: that we can
 * sustain ~0.75 PSI requests/second. This measures it end to end -- real Redis,
 * the real token bucket, the real concurrency model -- against a fake PSI that
 * reproduces the latency observed from the live API (11-24 s, occasionally
 * longer). Costs zero quota.
 *
 *   npm run throughput-dryrun            # ~90 s
 *   JOBS=200 npm run throughput-dryrun   # longer, tighter numbers
 *
 * If the achieved rate is materially below target, STOP -- the sweep-duration
 * estimates and the schedule-only design both need revisiting.
 */
import 'dotenv/config';
import { createRedis } from '../lib/redis.ts';
import { PsiRateLimiter } from '../lib/psi/rateLimiter.ts';

const JOBS = Number(process.env.JOBS ?? 60);
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 20);
const MAX = Number(process.env.PSI_RATE_MAX ?? 3);
const WINDOW = Number(process.env.PSI_RATE_WINDOW_MS ?? 4000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/** Observed live latency spread, so the simulation matches reality. */
const LATENCY_MIN = Number(process.env.FAKE_LATENCY_MIN ?? 11_000);
const LATENCY_MAX = Number(process.env.FAKE_LATENCY_MAX ?? 24_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeLatency = () => LATENCY_MIN + Math.random() * (LATENCY_MAX - LATENCY_MIN);

async function main() {
  const redis = createRedis(REDIS_URL);
  // Unique prefix so a previous run's buckets can't skew this one.
  const keyPrefix = `psa:dryrun:${process.pid}`;
  const limiter = new PsiRateLimiter({ redis, max: MAX, windowMs: WINDOW, keyPrefix });

  const target = limiter.ratePerSecond;
  const projectedFullSweep = (2000 / target / 60).toFixed(0);

  console.log(`\n  jobs=${JOBS} concurrency=${CONCURRENCY} limiter=${MAX}/${WINDOW}ms`);
  console.log(`  target ${target.toFixed(2)} req/s  |  fake PSI latency ${LATENCY_MIN / 1000}-${LATENCY_MAX / 1000}s`);
  console.log(`  (at target, a 2000-call sweep takes ~${projectedFullSweep} min)\n`);

  let started = 0;
  let done = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const startTimes: number[] = [];

  const t0 = Date.now();
  const queue = Array.from({ length: JOBS }, (_, i) => i);

  const progress = setInterval(() => {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(
      `\r  ${done}/${JOBS} done, ${inFlight} in flight, ${el.toFixed(0)}s, ${(done / el).toFixed(2)} req/s   `,
    );
  }, 1000);

  async function worker() {
    for (;;) {
      if (queue.length === 0) return;
      queue.shift();

      // The permit is what paces us -- exactly as the real processor will.
      await limiter.acquire();
      startTimes.push(Date.now());
      started++;
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);

      await sleep(fakeLatency()); // stands in for the PSI round trip

      inFlight--;
      done++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(progress);

  const elapsedS = (Date.now() - t0) / 1000;
  const achieved = JOBS / elapsedS;

  // Measure the steady state, not the ramp-up: the first `concurrency` jobs all
  // start near t=0 and would flatter the average.
  const steady = startTimes.slice(CONCURRENCY);
  const steadyRate =
    steady.length > 1 ? (steady.length - 1) / ((steady[steady.length - 1] - steady[0]) / 1000) : achieved;

  console.log(`\n\n  ── results ─────────────────────────────`);
  console.log(`  elapsed          ${elapsedS.toFixed(1)} s`);
  console.log(`  overall rate     ${achieved.toFixed(3)} req/s`);
  console.log(`  steady-state     ${steadyRate.toFixed(3)} req/s   (target ${target.toFixed(3)})`);
  console.log(`  peak in flight   ${peakInFlight}  (concurrency ${CONCURRENCY})`);
  console.log(`  started/done     ${started}/${done}`);

  const withinTolerance = Math.abs(steadyRate - target) <= 0.08;
  const notThrottledByConcurrency = peakInFlight < CONCURRENCY || steadyRate >= target - 0.08;

  console.log(`\n  projected 2000-call sweep: ${(2000 / steadyRate / 60).toFixed(0)} min\n`);

  await redis.del(...(await redis.keys(`${keyPrefix}*`)).slice(0, 1000)).catch(() => {});
  await redis.quit();

  if (!withinTolerance) {
    console.error(`  FAIL: steady-state ${steadyRate.toFixed(3)} req/s is outside ±0.08 of ${target}`);
    process.exit(1);
  }
  if (!notThrottledByConcurrency) {
    console.error('  FAIL: concurrency is the bottleneck, not the limiter — raise WORKER_CONCURRENCY');
    process.exit(1);
  }
  console.log('  PASS: sustained rate matches target.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
