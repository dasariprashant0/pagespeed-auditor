import { prisma } from './db.ts';
import { getEnv } from './env.ts';
import { PsiRateLimiter } from './psi/rateLimiter.ts';

/**
 * Everything that used to live in Redis (lib/redis.ts, now removed) lives in
 * Postgres instead: the PSI rate limiter, the scheduler heartbeat, and the
 * live run log. See docs/DECISIONS.md #16 for the incident that prompted
 * this and why none of the three ever actually needed a separate,
 * request-metered service once BullMQ -- the one thing that DID need
 * Redis's blocking commands -- was removed.
 */

let limiter: PsiRateLimiter | undefined;

export function getPsiRateLimiter(): PsiRateLimiter {
  const env = getEnv();
  limiter ??= new PsiRateLimiter({
    db: prisma,
    max: env.PSI_RATE_MAX,
    windowMs: env.PSI_RATE_WINDOW_MS,
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

export async function stampSchedulerHeartbeat(): Promise<void> {
  await prisma.keyValue
    .upsert({
      where: { key: HEARTBEAT_KEY },
      update: { value: String(Date.now()) },
      create: { key: HEARTBEAT_KEY, value: String(Date.now()) },
    })
    .catch(() => {});
}

export interface SchedulerHealth {
  alive: boolean;
  lastTickSecondsAgo: number | null;
}

export async function schedulerHealth(): Promise<SchedulerHealth> {
  try {
    const row = await prisma.keyValue.findUnique({ where: { key: HEARTBEAT_KEY } });
    if (!row) return { alive: false, lastTickSecondsAgo: null };
    const ageMs = Date.now() - Number(row.value);
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
 * durable and not meant to be a second copy of AuditResult: rows are
 * deleted once their run finalizes (see finalizeAndNotify), purely a live
 * terminal-style view for while someone is watching.
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

/** Never lets a logging failure break the actual audit -- swallows its own errors. */
export async function pushRunLogEvent(runId: string, event: RunLogEvent): Promise<void> {
  try {
    await prisma.runLogEvent.create({
      data: {
        runId,
        kind: event.kind,
        pageId: event.pageId,
        url: event.url,
        strategy: event.strategy,
        message: event.message ?? null,
      },
    });
    // Trimmed roughly, not exactly, to RUN_LOG_MAX_LINES -- an occasional
    // over-eager delete by a few rows costs nothing, and checking on every
    // single write would double the query count for no real benefit.
    if (Math.random() < 0.05) {
      const excess = await prisma.runLogEvent.findMany({
        where: { runId },
        orderBy: { createdAt: 'desc' },
        skip: RUN_LOG_MAX_LINES,
        select: { id: true },
        take: 500,
      });
      if (excess.length > 0) {
        await prisma.runLogEvent.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
      }
    }
  } catch {
    /* the terminal view missing a line is not worth failing a step over */
  }
}

/** Oldest first, so new lines append at the bottom like a real terminal. */
export async function readRunLog(runId: string, limit = 150): Promise<RunLogEvent[]> {
  try {
    const rows = await prisma.runLogEvent.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows
      .map((r) => ({
        ts: r.createdAt.getTime(),
        kind: r.kind as RunLogEventKind,
        pageId: r.pageId,
        url: r.url,
        strategy: r.strategy,
        message: r.message ?? undefined,
      }))
      .reverse();
  } catch {
    return [];
  }
}

/** Called once a run is terminal -- the live log has nothing left to show. */
export async function clearRunLog(runId: string): Promise<void> {
  await prisma.runLogEvent.deleteMany({ where: { runId } }).catch(() => {});
}
