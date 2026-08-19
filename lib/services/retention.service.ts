import { prisma } from '../db.ts';
import { logger } from '../logger.ts';

/**
 * How much history is kept.
 *
 * The point of this tool is comparison over time -- "we scheduled weekly, it is
 * the end of the month, what changed" -- so a run's results, its markdown and
 * its AI recommendation are kept together as one unit. Pruning them separately
 * would leave a report you can open but whose evidence has been deleted.
 *
 * Ten runs per page and strategy is roughly two months of weekly checks, or ten
 * days of daily ones. Older results are removed ENTIRELY rather than hollowed
 * out: a row that still exists but has lost its rawJson renders an agent report
 * with no evidence tables, which is worse than saying the run has aged out.
 */

export const DEFAULT_KEEP_RUNS = 10;

export interface RetentionSummary {
  keepRuns: number;
  resultsDeleted: number;
  pagesAffected: number;
  bytesFreedEstimate: number;
}

function keepRuns(): number {
  const n = Number(process.env.RESULT_RETAIN_RUNS ?? DEFAULT_KEEP_RUNS);
  // A value under 2 would leave nothing to compare against, which defeats the
  // purpose; treat it as a misconfiguration rather than obeying it.
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : DEFAULT_KEEP_RUNS;
}

/**
 * Deletes results beyond the keep window, per (page, strategy).
 *
 * Scoped to one site so a large tenant cannot stall another's pruning, and so
 * it can run straight after that site's sweep finalizes.
 */
export async function pruneSiteHistory(siteId: string): Promise<RetentionSummary> {
  const keep = keepRuns();

  // DISTINCT-ON-style windowing in one statement: doing it per page would be
  // ~1,500 round trips on a site this size.
  const stale = await prisma.$queryRaw<Array<{ id: string; pageId: string; bytes: number }>>`
    SELECT id, "pageId", COALESCE(LENGTH("rawJson"::text), 0) AS bytes
    FROM (
      SELECT r.id,
             r."pageId",
             r."rawJson",
             ROW_NUMBER() OVER (
               PARTITION BY r."pageId", r.strategy
               ORDER BY r."createdAt" DESC
             ) AS rn
      FROM "AuditResult" r
      JOIN "Page" p ON p.id = r."pageId"
      WHERE p."siteId" = ${siteId}
    ) ranked
    WHERE rn > ${keep}
  `;

  if (stale.length === 0) {
    return { keepRuns: keep, resultsDeleted: 0, pagesAffected: 0, bytesFreedEstimate: 0 };
  }

  const ids = stale.map((s) => s.id);
  const bytes = stale.reduce((n, s) => n + Number(s.bytes), 0);

  // AuditIssue and Recommendation cascade from AuditResult, so one delete takes
  // the whole run with it and cannot leave orphans behind.
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await prisma.auditResult.deleteMany({ where: { id: { in: chunk } } });
    deleted += res.count;
  }

  const summary: RetentionSummary = {
    keepRuns: keep,
    resultsDeleted: deleted,
    pagesAffected: new Set(stale.map((s) => s.pageId)).size,
    bytesFreedEstimate: bytes,
  };
  logger.info({ siteId, ...summary }, 'history pruned');
  return summary;
}

/** Removes runs that no longer have any results, so the run list stays honest. */
export async function pruneEmptyRuns(siteId: string): Promise<number> {
  const res = await prisma.auditRun.deleteMany({
    where: {
      siteId,
      results: { none: {} },
      status: { in: ['completed', 'failed', 'skipped'] },
      // Never touch anything recent: a run that is finalizing legitimately has
      // no results for a moment.
      startedAt: { lt: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  return res.count;
}

export interface HistoryDepth {
  pageId: string;
  path: string;
  strategy: string;
  runs: number;
  oldest: Date | null;
  newest: Date | null;
}

/** What history actually exists, for the Settings storage panel. */
export async function historyOverview(siteId: string): Promise<{
  keepRuns: number;
  totalResults: number;
  distinctRuns: number;
  oldest: Date | null;
  storageBytes: number;
}> {
  const [agg, runs, storage] = await Promise.all([
    prisma.auditResult.aggregate({
      where: { page: { siteId } },
      _count: { id: true },
      _min: { createdAt: true },
    }),
    prisma.auditRun.count({ where: { siteId } }),
    // pg_column_size reads the STORED (compressed, possibly out-of-line) size
    // rather than materialising the value. LENGTH("rawJson"::text) had to
    // detoast and cast every stored PSI response -- ~90 MB of decompression on
    // this site -- which is why opening Settings took over three seconds and
    // got slower with every sweep.
    prisma.$queryRaw<Array<{ bytes: bigint | null }>>`
      SELECT SUM(pg_column_size(r."rawJson") + pg_column_size(r."markdownReport")) AS bytes
      FROM "AuditResult" r JOIN "Page" p ON p.id = r."pageId"
      WHERE p."siteId" = ${siteId}
    `,
  ]);

  return {
    keepRuns: keepRuns(),
    totalResults: agg._count.id,
    distinctRuns: runs,
    oldest: agg._min.createdAt,
    // On-disk, after Postgres compresses the JSON. Smaller than the raw
    // payload, and the honest number for "how much space is this costing".
    storageBytes: Number(storage[0]?.bytes ?? 0),
  };
}
