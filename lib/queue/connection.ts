import Redis from 'ioredis';

/**
 * ioredis connection factory.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ -- its blocking commands
 * (BZPOPMIN) must be allowed to wait indefinitely rather than being failed by
 * the client's own retry cap.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
