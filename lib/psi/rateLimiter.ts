/**
 * The real PSI rate limiter: a fixed-window token bucket, shared by every
 * caller, backed by Postgres rather than Redis.
 *
 * Redis used to hold this (see docs/DECISIONS.md #16 for the full story of
 * why it was removed): a single incident showed that a Redis-backed
 * limiter, polled by WORKER_CONCURRENCY workers all denied most of the
 * time, generates enormous request volume against a service that bills by
 * the request -- Upstash's 500k/month cap gone in two sweeps. Postgres has
 * no such per-request meter, this app already depends on it unconditionally,
 * and the same atomicity guarantee the Lua script gave (check-and-increment
 * as one indivisible operation, so concurrent callers can't both read "2
 * used" and both write "3") is exactly what `INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING` gives for free.
 *
 * A single-page or single-group audit calls this too, not just a full
 * sweep -- one shared budget covers every path that calls PSI.
 */

export interface RateLimiterDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface RateLimiterOptions {
  db: RateLimiterDb;
  /** Permits per window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
  /** Which bucket row this limiter owns. Only "psi" exists today. */
  key?: string;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
  /** Injectable for tests; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PsiRateLimiter {
  private readonly db: RateLimiterDb;
  private readonly max: number;
  private readonly windowMs: number;
  private readonly key: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimiterOptions) {
    this.db = opts.db;
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.key = opts.key ?? 'psi';
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private windowStart(): bigint {
    return BigInt(Math.floor(this.now() / this.windowMs) * this.windowMs);
  }

  /**
   * One non-blocking attempt. The UPSERT is the whole atomic operation: a
   * fresh window resets the count to 1 (the CASE branch), the same window
   * increments it, and the row is created on first use. No separate
   * read-then-write exists for two concurrent callers to race inside of.
   */
  async tryAcquire(): Promise<{ ok: boolean }> {
    const windowStart = this.windowStart();
    const rows = await this.db.$queryRaw<Array<{ count: number | bigint }>>`
      INSERT INTO "RateLimitBucket" AS b (key, "windowStart", count)
      VALUES (${this.key}, ${windowStart}, 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN b."windowStart" = ${windowStart} THEN b.count + 1 ELSE 1 END,
        "windowStart" = ${windowStart}
      RETURNING count
    `;
    const count = Number(rows[0]?.count ?? 1);
    return { ok: count <= this.max };
  }

  /** Time until the bucket window rolls over and permits reset. */
  private msUntilNextWindow(): number {
    const rem = this.now() % this.windowMs;
    return this.windowMs - rem;
  }

  /**
   * Blocks until a permit is available. `signal` lets a shutting-down worker
   * stop waiting rather than holding the process open.
   *
   * Retries on the real window boundary -- deterministic, computed locally,
   * no round trip needed to learn it -- rather than busy-polling. See the
   * module comment and docs/DECISIONS.md #16 for why that distinction is
   * the entire point of this file.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error('rate limiter wait aborted');
      const { ok } = await this.tryAcquire();
      if (ok) return;
      // Jitter so every denied caller released by the same boundary doesn't
      // retry in the exact same instant.
      await this.sleep(this.msUntilNextWindow() + Math.floor(Math.random() * 150));
    }
  }

  /** Permits/second this configuration allows. Used in logs and the dry-run. */
  get ratePerSecond(): number {
    return (this.max / this.windowMs) * 1000;
  }
}
