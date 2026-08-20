import Redis from 'ioredis';
import { getEnv } from './env.ts';
import { PsiRateLimiter } from './psi/rateLimiter.ts';

/**
 * The one thing still shared over Redis after the BullMQ removal: the PSI
 * token bucket (plain INCR/PEXPIRE via EVAL, no blocking commands) and the
 * scheduler heartbeat. Both are compatible with Upstash's serverless tier --
 * see docs/DECISIONS.md 2.4, which is exactly the incompatibility this
 * rewrite was partly done to get out from under (BullMQ needed blocking
 * BZPOPMIN on a dedicated connection; this doesn't).
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

let redis: Redis | undefined;

export function getRedis(): Redis {
  redis ??= createRedis(getEnv().REDIS_URL);
  return redis;
}

let limiter: PsiRateLimiter | undefined;

export function getPsiRateLimiter(): PsiRateLimiter {
  const env = getEnv();
  limiter ??= new PsiRateLimiter({
    redis: getRedis(),
    max: env.PSI_RATE_MAX,
    windowMs: env.PSI_RATE_WINDOW_MS,
    keyPrefix: `${env.QUEUE_PREFIX}:psi:rate`,
  });
  return limiter;
}

// --- scheduler heartbeat ----------------------------------------------------

/**
 * "Is the scheduler actually ticking."
 *
 * There is no long-lived worker process anymore, so a per-process heartbeat
 * interval doesn't apply -- instead the cron route stamps this once per
 * invocation. Stale-after is set to comfortably exceed the cron interval so
 * one slow or skipped tick doesn't flip the status red.
 */
const HEARTBEAT_KEY = 'scheduler:heartbeat';
const CRON_INTERVAL_MS = 15 * 60_000;
const STALE_AFTER_MS = CRON_INTERVAL_MS * 2 + 60_000;

function heartbeatKey(): string {
  return `${getEnv().QUEUE_PREFIX}:${HEARTBEAT_KEY}`;
}

export async function stampSchedulerHeartbeat(): Promise<void> {
  await getRedis()
    .set(heartbeatKey(), String(Date.now()), 'PX', STALE_AFTER_MS + 60_000)
    .catch(() => {});
}

export interface SchedulerHealth {
  alive: boolean;
  lastTickSecondsAgo: number | null;
}

export async function schedulerHealth(): Promise<SchedulerHealth> {
  try {
    const raw = await getRedis().get(heartbeatKey());
    if (!raw) return { alive: false, lastTickSecondsAgo: null };
    const ageMs = Date.now() - Number(raw);
    return { alive: ageMs < STALE_AFTER_MS, lastTickSecondsAgo: Math.round(ageMs / 1000) };
  } catch {
    return { alive: false, lastTickSecondsAgo: null };
  }
}

// --- live run log ------------------------------------------------------------

/**
 * "What is actually happening right now" for a run in flight -- the thing
 * BullMQ's delayed-job introspection used to answer and the Workflow
 * migration dropped (see the comment in app/api/runs/active/route.ts). Not
 * durable and not meant to be: a Redis list, capped and TTL'd, purely for a
 * live terminal-style view while someone is watching. Postgres already has
 * the durable record (AuditResult); this is not a second copy of it.
 */
export type RunLogEventKind = 'start' | 'ok' | 'retry' | 'error';

export interface RunLogEvent {
  ts: number;
  kind: RunLogEventKind;
  pageId: string;
  url: string;
  strategy: string;
  message?: string;
}

const RUN_LOG_MAX_LINES = 300;
const RUN_LOG_TTL_MS = 60 * 60_000;

function runLogKey(runId: string): string {
  return `${getEnv().QUEUE_PREFIX}:run:${runId}:log`;
}

/** Never lets a logging failure break the actual audit -- swallows its own errors. */
export async function pushRunLogEvent(runId: string, event: RunLogEvent): Promise<void> {
  const key = runLogKey(runId);
  const redis = getRedis();
  try {
    await redis.lpush(key, JSON.stringify(event));
    await redis.ltrim(key, 0, RUN_LOG_MAX_LINES - 1);
    await redis.pexpire(key, RUN_LOG_TTL_MS);
  } catch {
    /* the terminal view missing a line is not worth failing a step over */
  }
}

/** Oldest first, so new lines append at the bottom like a real terminal. */
export async function readRunLog(runId: string, limit = 150): Promise<RunLogEvent[]> {
  try {
    const raw = await getRedis().lrange(runLogKey(runId), 0, limit - 1);
    return raw
      .map((r) => {
        try {
          return JSON.parse(r) as RunLogEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is RunLogEvent => e !== null)
      .reverse();
  } catch {
    return [];
  }
}
