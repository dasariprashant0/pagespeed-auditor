import { getTenantPrisma } from '../db/tenant.ts';
import { getEnv } from '../env.ts';

/**
 * How long a run will actually take, derived from this site's own measured PSI
 * latency rather than a constant.
 *
 * A constant would be wrong by roughly 3x in either direction: light pages
 * answer in 11-24 s while pages on this site average around 60 s, and the
 * difference decides whether the worker pool or the rate limiter is the
 * bottleneck. Both are modelled below.
 */

export interface RunEstimate {
  jobs: number;
  /** Median measured PSI call duration, ms. */
  medianCallMs: number;
  /** Requests/second the run can actually sustain. */
  throughputPerSecond: number;
  seconds: number;
  /** True when the number comes from measured history rather than the fallback. */
  measured: boolean;
  sampleSize: number;
}

/** Used only until this site has measured anything of its own. */
const FALLBACK_CALL_MS = 25_000;

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Throughput is whichever constraint binds first:
 *  - the rate limiter (max requests per window), or
 *  - the worker pool (concurrency / call duration).
 *
 * Ignoring the second is what made an earlier configuration silently three
 * times slower than intended.
 */
export function throughputPerSecond(callMs: number, concurrency: number, rateMax: number, rateWindowMs: number): number {
  const limiterRate = (rateMax / rateWindowMs) * 1000;
  const poolRate = concurrency / (callMs / 1000);
  return Math.min(limiterRate, poolRate);
}

export async function estimateRun(organizationId: string, jobs: number, siteId?: string): Promise<RunEstimate> {
  const prisma = await getTenantPrisma(organizationId);
  const env = getEnv();

  // Recent history only: the site changes, and so does its latency.
  const recent = await prisma.auditResult.findMany({
    where: { durationMs: { not: null }, ...(siteId ? { page: { siteId } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { durationMs: true },
  });

  const samples = recent.map((r) => r.durationMs!).filter((n) => n > 0);
  const median = medianOf(samples);
  const callMs = median ?? FALLBACK_CALL_MS;

  const rate = throughputPerSecond(callMs, env.WORKER_CONCURRENCY, env.PSI_RATE_MAX, env.PSI_RATE_WINDOW_MS);

  // The final call still has to finish after the last one starts, which matters
  // a lot on a short run and not at all on a long one.
  const seconds = Math.round(jobs / rate + callMs / 1000);

  return {
    jobs,
    medianCallMs: callMs,
    throughputPerSecond: rate,
    seconds,
    measured: median !== null,
    sampleSize: samples.length,
  };
}

/** "about 4 minutes" / "about 35 seconds" — no false precision. */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `about ${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `about ${h} hour${h === 1 ? '' : 's'}` : `about ${h}h ${m}m`;
}
