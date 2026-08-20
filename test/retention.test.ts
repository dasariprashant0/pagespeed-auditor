import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSiteHistory, deleteRuns } from '../lib/services/retention.service.ts';

/**
 * The JS-level orchestration, not the SQL. $queryRaw's actual windowing
 * query is Postgres-specific and not meaningfully unit-testable outside a
 * real database -- what's pinned down here is what retention.service.ts
 * does with whatever rows come back: which ones get deleted, which blob
 * keys get collected, and that an empty result never even attempts a
 * network call to Blob.
 */

interface StaleRow {
  id: string;
  pageId: string;
  bytes: number;
  rawJsonBlobKey: string | null;
}

function fakePrismaForPrune(staleRows: StaleRow[]) {
  const deletedIds: string[] = [];
  return {
    $queryRaw: async () => staleRows,
    auditResult: {
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        deletedIds.push(...where.id.in);
        return { count: where.id.in.length };
      },
    },
    deletedIds,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('pruneSiteHistory', () => {
  test('collects blob keys from stale rows and hands only the non-null ones to deleteBlobs', async () => {
    const prisma = fakePrismaForPrune([
      { id: 'r1', pageId: 'p1', bytes: 100, rawJsonBlobKey: 'audit-raw-json/run1/p1-mobile.json' },
      // A legacy inline row -- nothing in Blob to clean up for this one.
      { id: 'r2', pageId: 'p2', bytes: 50, rawJsonBlobKey: null },
    ]);
    const deletedBlobKeys: string[] = [];
    const summary = await pruneSiteHistory(prisma, 'site1', async (keys) => {
      deletedBlobKeys.push(...keys);
    });

    assert.equal(summary.resultsDeleted, 2);
    assert.equal(summary.pagesAffected, 2);
    assert.equal(summary.bytesFreedEstimate, 150);
    assert.deepEqual(deletedBlobKeys, ['audit-raw-json/run1/p1-mobile.json']);
    assert.deepEqual(prisma.deletedIds, ['r1', 'r2']);
  });

  test('nothing stale means no deletes and no attempt at blob cleanup', async () => {
    const prisma = fakePrismaForPrune([]);
    let blobCleanupCalled = false;
    const summary = await pruneSiteHistory(prisma, 'site1', async () => {
      blobCleanupCalled = true;
    });

    assert.equal(summary.resultsDeleted, 0);
    assert.equal(blobCleanupCalled, false, 'an empty prune must not even attempt to reach Blob');
  });
});

function fakePrismaForDeleteRuns(runs: Array<{ id: string; status: string }>, results: Array<{ rawJsonBlobKey: string | null }>) {
  return {
    auditRun: {
      findMany: async ({ where }: { where: { status: { in: string[] } } }) =>
        runs.filter((r) => where.status.in.includes(r.status)),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length }),
    },
    auditResult: {
      findMany: async () => results,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('deleteRuns', () => {
  test('excludes a run still in flight even if the caller asked for it', async () => {
    const prisma = fakePrismaForDeleteRuns(
      [{ id: 'running1', status: 'running' }, { id: 'done1', status: 'completed' }],
      [{ rawJsonBlobKey: 'k1' }],
    );
    const deletedBlobKeys: string[] = [];
    const { runsDeleted } = await deleteRuns(prisma, 'site1', ['running1', 'done1'], async (keys) => {
      deletedBlobKeys.push(...keys);
    });

    assert.equal(runsDeleted, 1, 'only the terminal run should be deletable');
    assert.deepEqual(deletedBlobKeys, ['k1']);
  });

  test('an empty selection is a no-op, not an error', async () => {
    const prisma = fakePrismaForDeleteRuns([], []);
    const result = await deleteRuns(prisma, 'site1', []);
    assert.deepEqual(result, { runsDeleted: 0, resultsDeleted: 0 });
  });
});
