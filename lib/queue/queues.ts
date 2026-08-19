import { Queue, type DefaultJobOptions } from 'bullmq';
import type Redis from 'ioredis';
import { getEnv } from '../env.ts';
import { PsiRateLimiter } from '../psi/rateLimiter.ts';
import { createRedis } from './connection.ts';
import { QUEUE_AUDIT, QUEUE_CONTROL } from './names.ts';
import type { AuditPageJobData, ControlJobData } from './jobs.ts';

/**
 * Lazily-created singletons for the producer side.
 *
 * Lazy because importing this module must not open a Redis connection: the
 * Next dev server imports the service layer on routes that never enqueue
 * anything, and a connection per HMR reload leaks file descriptors.
 */

let redis: Redis | undefined;
let auditQueue: Queue<AuditPageJobData> | undefined;
let controlQueue: Queue<ControlJobData> | undefined;
let limiter: PsiRateLimiter | undefined;

/** Shared connection for queues and the token bucket. */
export function getRedis(): Redis {
  redis ??= createRedis(getEnv().REDIS_URL);
  return redis;
}

/**
 * The audit queue's retry policy.
 *
 * `backoff.type: 'custom'` delegates to the worker's settings.backoffStrategy,
 * which calls backoffMs() from lib/psi/client.ts -- one definition of the
 * schedule rather than a second copy expressed in BullMQ's own exponential
 * options, which have no jitter.
 */
export function auditJobOptions(): DefaultJobOptions {
  return {
    attempts: getEnv().PSI_MAX_ATTEMPTS,
    backoff: { type: 'custom' },
    // Completed jobs are evicted, which is precisely why the DB unique
    // constraint -- not the deterministic jobId -- is the real idempotency
    // guarantee. Failures are kept a week so a sweep can be inspected after
    // the fact.
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

export function getAuditQueue(): Queue<AuditPageJobData> {
  const env = getEnv();
  auditQueue ??= new Queue<AuditPageJobData>(QUEUE_AUDIT, {
    connection: getRedis(),
    prefix: env.QUEUE_PREFIX,
    defaultJobOptions: auditJobOptions(),
  });
  return auditQueue;
}

export function getControlQueue(): Queue<ControlJobData> {
  const env = getEnv();
  controlQueue ??= new Queue<ControlJobData>(QUEUE_CONTROL, {
    connection: getRedis(),
    prefix: env.QUEUE_PREFIX,
    // Control jobs are cheap and idempotent; a couple of retries covers a
    // transient DB blip without needing the PSI backoff schedule.
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 200 } },
  });
  return controlQueue;
}

/**
 * The token bucket every PSI call passes through -- queued or synchronous.
 *
 * BullMQ's limiter governs queued jobs only, so a single-page audit triggered
 * from the dashboard would otherwise slip past it and push the sustained rate
 * over the line while a sweep is running.
 */
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

/** For scripts and graceful shutdown. Safe to call when nothing was created. */
export async function closeQueues(): Promise<void> {
  await Promise.all([auditQueue?.close(), controlQueue?.close()]);
  auditQueue = undefined;
  controlQueue = undefined;
  limiter = undefined;
  if (redis) {
    await redis.quit();
    redis = undefined;
  }
}
