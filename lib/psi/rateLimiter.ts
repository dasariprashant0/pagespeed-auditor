import type Redis from 'ioredis';

/**
 * The real PSI rate limiter: a Redis token bucket shared by every caller.
 *
 * BullMQ has its own limiter, but it only governs *queued* jobs. A synchronous
 * single-page audit triggered from the dashboard would bypass it entirely and
 * push us over the sustained rate while a sweep is running. So both paths call
 * this, and BullMQ's limiter becomes a coarse second layer.
 *
 * Sliding window over fixed buckets: `max` permits per `windowMs`. Implemented
 * as one Lua script so the check-and-increment is atomic -- with 20 concurrent
 * workers, a read-then-write in JS would let several through at once.
 */

const ACQUIRE_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local n = redis.call('INCR', key)
if n == 1 then
  redis.call('PEXPIRE', key, ttl)
end
if n <= max then
  return {1, 0}
end
local pttl = redis.call('PTTL', key)
if pttl < 0 then pttl = ttl end
return {0, pttl}
`;

export interface RateLimiterOptions {
  redis: Redis;
  /** Permits per window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  keyPrefix?: string;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
  /** Injectable for tests; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PsiRateLimiter {
  private readonly redis: Redis;
  private readonly max: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions) {
    this.redis = opts.redis;
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.keyPrefix = opts.keyPrefix ?? 'psa:psi:rate';
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private bucketKey(): string {
    return `${this.keyPrefix}:${Math.floor(this.now() / this.windowMs)}`;
  }

  /** One non-blocking attempt. Returns ms to wait when denied. */
  async tryAcquire(): Promise<{ ok: boolean; retryAfterMs: number }> {
    const res = (await this.redis.eval(
      ACQUIRE_LUA,
      1,
      this.bucketKey(),
      String(this.max),
      // Two windows of TTL so a bucket key can't expire mid-window and reset the count.
      String(this.windowMs * 2),
    )) as [number, number];

    return { ok: res[0] === 1, retryAfterMs: res[1] };
  }

  /**
   * Blocks until a permit is available. `signal` lets a shutting-down worker
   * stop waiting rather than holding the process open.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error('rate limiter wait aborted');
      const { ok, retryAfterMs } = await this.tryAcquire();
      if (ok) return;
      // Small jitter so 20 workers released by the same expiry don't collide.
      await this.sleep(Math.max(25, retryAfterMs) + Math.floor(Math.random() * 50));
    }
  }

  /** Permits/second this configuration allows. Used in logs and the dry-run. */
  get ratePerSecond(): number {
    return (this.max / this.windowMs) * 1000;
  }
}
