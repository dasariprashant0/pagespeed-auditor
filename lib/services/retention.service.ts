import type { PrismaClient } from '@prisma/client';
import { logger } from '../logger.ts';
import { deleteRawJsonBlobs } from '../blob.ts';

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
 *
 * `prisma` is a parameter, not a module-level import, the same as
 * run.service.ts/audit.service.ts -- it's what lets a test pass a fake one
 * instead of needing a real database (see test/retention.test.ts).
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
 *
 * `deleteBlobs` defaults to the real Blob delete and only exists as a
 * parameter so a test can substitute a spy and assert on which keys were
 * collected, without attempting a real network call.
 */
export async function pruneSiteHistory(
  prisma: PrismaClient,
  siteId: string,
  deleteBlobs: (pathnames: string[]) => Promise<void> = deleteRawJsonBlobs,
): Promise<RetentionSummary> {
  const keep = keepRuns();

  // DISTINCT-ON-style windowing in one statement: doing it per page would be
  // ~1,500 round trips on a site this size.
  const stale = await prisma.$queryRaw<
    Array<{ id: string; pageId: string; bytes: number; rawJsonBlobKey: string | null }>
  >`
    SELECT id, "pageId", COALESCE(LENGTH("rawJson"::text), 0) AS bytes, "rawJsonBlobKey"
    FROM (
      SELECT r.id,
             r."pageId",
             r."rawJson",
             r."rawJsonBlobKey",
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
  // Postgres bytes only -- a blob's bytes aren't in this table to begin
  // with, so freeing them isn't part of "how much did THIS query reclaim".
  const bytes = stale.reduce((n, s) => n + Number(s.bytes), 0);
  const blobKeys = stale.map((s) => s.rawJsonBlobKey).filter((k): k is string => k !== null);

  // AuditIssue and Recommendation cascade from AuditResult, so one delete takes
  // the whole run with it and cannot leave orphans behind. The Blob objects
  // are a separate store the DB cascade can't reach -- cleaned up explicitly,
  // best-effort, after the rows that reference them are actually gone.
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const res = await prisma.auditResult.deleteMany({ where: { id: { in: chunk } } });
    deleted += res.count;
  }
  await deleteBlobs(blobKeys);

  const summary: RetentionSummary = {
    keepRuns: keep,
    resultsDeleted: deleted,
    pagesAffected: new Set(stale.map((s) => s.pageId)).size,
    bytesFreedEstimate: bytes,
  };
  logger.info({ siteId, ...summary }, 'history pruned');
  return summary;
}

/**
 * Deletes specific historical checks entirely, at the operator's choice --
 * not an age-based prune. AuditResult/AuditIssue/Recommendation cascade from
 * AuditRun, so one deleteMany takes a whole run's data with it.
 *
 * Scoped to siteId, same as pruneSiteHistory: a run id is a Server Action
 * argument and therefore not proof the caller's organisation owns it.
 *
 * Excludes anything not yet terminal -- deleting a run's row out from under a
 * workflow step that is still writing to it would break the FK it depends on
 * mid-flight, not just lose history.
 */
export async function deleteRuns(
  prisma: PrismaClient,
  siteId: string,
  runIds: string[],
  deleteBlobs: (pathnames: string[]) => Promise<void> = deleteRawJsonBlobs,
): Promise<{ runsDeleted: number; resultsDeleted: number }> {
  if (runIds.length === 0) return { runsDeleted: 0, resultsDeleted: 0 };

  const deletable = await prisma.auditRun.findMany({
    where: { siteId, id: { in: runIds }, status: { in: ['completed', 'failed', 'cancelled', 'skipped'] } },
    select: { id: true },
  });
  const ids = deletable.map((r) => r.id);
  if (ids.length === 0) return { runsDeleted: 0, resultsDeleted: 0 };

  // Fetched before the cascade, not after: once the AuditRun rows are gone,
  // so are the AuditResult rows that name their Blob objects -- there is no
  // reading them back afterwards to know what to clean up.
  const results = await prisma.auditResult.findMany({
    where: { auditRunId: { in: ids } },
    select: { rawJsonBlobKey: true },
  });
  const blobKeys = results.map((r) => r.rawJsonBlobKey).filter((k): k is string => k !== null);

  const { count: runsDeleted } = await prisma.auditRun.deleteMany({ where: { id: { in: ids } } });
  await deleteBlobs(blobKeys);
  return { runsDeleted, resultsDeleted: results.length };
}

/** What history actually exists, for the Settings storage panel. */
export async function historyOverview(
  prisma: PrismaClient,
  siteId: string,
): Promise<{
  keepRuns: number;
  totalResults: number;
  distinctRuns: number;
  oldest: Date | null;
  storageBytes: number;
  /** Results whose JSON lives in Vercel Blob rather than inline -- not
   * counted in storageBytes above, which is Postgres-only. Billed
   * separately, and much cheaper per GB -- see docs/DECISIONS.md §13. */
  blobBackedResults: number;
}> {
  const [agg, runs, storage, blobBackedResults] = await Promise.all([
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
    prisma.auditResult.count({ where: { page: { siteId }, rawJsonBlobKey: { not: null } } }),
  ]);

  return {
    keepRuns: keepRuns(),
    totalResults: agg._count.id,
    distinctRuns: runs,
    oldest: agg._min.createdAt,
    // On-disk, after Postgres compresses the JSON. Smaller than the raw
    // payload, and the honest number for "how much space is this costing".
    storageBytes: Number(storage[0]?.bytes ?? 0),
    blobBackedResults,
  };
}
