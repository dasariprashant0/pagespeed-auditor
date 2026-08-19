import { getRedis } from './queues.ts';

/**
 * Worker liveness.
 *
 * The schedule ticker runs inside the worker process, so if that process is not
 * running, scheduled sweeps silently never happen -- no error, no missed-run
 * record, nothing in the UI. That is the worst kind of failure for a scheduler,
 * and it is exactly what happened here.
 *
 * The worker stamps a key every 20s; the app reads it and can say plainly
 * whether anything is listening.
 */
const KEY = 'worker:heartbeat';
const INTERVAL_MS = 20_000;
/** Three missed beats before we call it dead, to ride out a slow tick. */
const STALE_AFTER_MS = 70_000;

function key(): string {
  return `${process.env.QUEUE_PREFIX ?? 'psa'}:${KEY}`;
}

export function startHeartbeat(): NodeJS.Timeout {
  const redis = getRedis();
  const beat = () => {
    // Expiry slightly beyond the stale window: an absent key is itself the
    // signal, so a crashed worker cannot leave a stale-but-present timestamp.
    void redis.set(key(), String(Date.now()), 'PX', STALE_AFTER_MS + 20_000).catch(() => {});
  };
  beat();
  const timer = setInterval(beat, INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export interface WorkerHealth {
  alive: boolean;
  lastSeenSecondsAgo: number | null;
}

export async function workerHealth(): Promise<WorkerHealth> {
  try {
    const raw = await getRedis().get(key());
    if (!raw) return { alive: false, lastSeenSecondsAgo: null };
    const ageMs = Date.now() - Number(raw);
    return { alive: ageMs < STALE_AFTER_MS, lastSeenSecondsAgo: Math.round(ageMs / 1000) };
  } catch {
    // Redis itself being unreachable is a different problem, reported elsewhere.
    return { alive: false, lastSeenSecondsAgo: null };
  }
}
