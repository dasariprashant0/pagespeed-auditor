/**
 * Fixed-window rate limit for the login form.
 *
 * Per-process, in memory -- not shared across however many app processes
 * run, and reset by a Next dev reload. This used to be Redis-backed for
 * exactly that reason, with an in-memory fallback for whenever Redis was
 * unreachable ("Redis is a nice-to-have here. Never let a hung client hold
 * up a login"). Redis was removed from the app entirely afterward (see
 * docs/DECISIONS.md #16) for the OTHER thing it did -- the PSI rate limiter
 * -- and once that was gone, keeping a whole separate service alive for
 * this one "nice to have" stopped making sense: the fallback this file
 * already had for Redis being down IS the correct behaviour here, not a
 * degraded one, so it's simply the only behaviour now.
 *
 * Fixed window rather than sliding: at 10 attempts per 15 minutes the boundary
 * burst (up to 20 across two adjacent windows) is irrelevant against a bcrypt
 * cost-12 compare, and a fixed window is one counter instead of a sorted set.
 */

export const LOGIN_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 } as const;

const KEY_PREFIX = 'psa:login-attempts:';

export interface RateLimitHit {
  /** Attempts recorded in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  ttlMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in the window; 0 once blocked. */
  remaining: number;
  /** Milliseconds until the caller may try again; 0 while allowed. */
  retryAfterMs: number;
}

/**
 * The counting rule, isolated from any I/O so it can be tested exhaustively.
 * `count` is post-increment, so the Nth attempt arrives here as count === N.
 */
export function decide(hit: RateLimitHit, max: number = LOGIN_RATE_LIMIT.max): RateLimitDecision {
  const allowed = hit.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - hit.count),
    retryAfterMs: allowed ? 0 : Math.max(0, hit.ttlMs),
  };
}

/** Round up, because "try again in 0 minutes" is a lie. */
export function retryAfterMinutes(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}

export class MemoryRateLimitStore {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  // Not a constructor parameter property: Node's strip-only TypeScript mode
  // rejects those, and this class is exercised directly by `node --test`.
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  hit(key: string, windowMs: number): RateLimitHit {
    const t = this.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= t) {
      const fresh = { count: 1, resetAt: t + windowMs };
      this.windows.set(key, fresh);
      this.prune(t);
      return { count: 1, ttlMs: windowMs };
    }

    existing.count += 1;
    return { count: existing.count, ttlMs: existing.resetAt - t };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Expired windows are only ever read by the key that created them, so
   * nothing evicts them otherwise -- and the key is an attacker-controlled IP,
   * which makes unbounded growth a memory-exhaustion vector rather than an
   * untidiness.
   */
  private prune(t: number): void {
    if (this.windows.size < 512) return;
    for (const [k, v] of this.windows) {
      if (v.resetAt <= t) this.windows.delete(k);
    }
  }
}

const memoryStore = new MemoryRateLimitStore();

/** Record one login attempt for `ip` and say whether it may proceed. */
export async function consumeLoginAttempt(ip: string): Promise<RateLimitDecision> {
  return decide(memoryStore.hit(KEY_PREFIX + ip, LOGIN_RATE_LIMIT.windowMs));
}

/**
 * Clear the counter after a successful login, so one person fat-fingering
 * their password nine times doesn't leave the office IP nearly locked out.
 */
export async function resetLoginAttempts(ip: string): Promise<void> {
  memoryStore.reset(KEY_PREFIX + ip);
}
