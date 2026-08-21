import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// getEnv() caches on first call, so the test env vars it reads must be set
// before anything in this file (or a module it imports) calls it -- doing
// that here, at module scope, beats every test needing its own env dance.
// DATABASE_URL has no default in the schema (lib/env.ts) and getEnv()
// validates the whole thing at once, so it has to be set too even though
// nothing in this file touches a database -- this is the first test file
// to call getEnv() at all.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
process.env.CLOUDFLARE_D1_DATABASE_ID = 'test-db';
process.env.CLOUDFLARE_API_TOKEN = 'test-token';

const { pathnameFor, storeRawJson, fetchRawJson, deleteRawJsonBlobs } = await import('../lib/blob.ts');

describe('blob pathname', () => {
  test('is keyed by run, page and strategy, not the row id', () => {
    assert.equal(pathnameFor('run1', 'page1', 'mobile'), 'audit-raw-json/run1/page1-mobile.json');
  });

  test('mobile and desktop for the same page never collide', () => {
    assert.notEqual(pathnameFor('run1', 'page1', 'mobile'), pathnameFor('run1', 'page1', 'desktop'));
  });

  test('two different runs auditing the same page never collide', () => {
    assert.notEqual(pathnameFor('run1', 'page1', 'mobile'), pathnameFor('run2', 'page1', 'mobile'));
  });
});

/** A fake D1 HTTP endpoint: records every call, answers with canned rows. */
function fakeD1(rowsForSelect: Array<Record<string, unknown>> = []): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; sql: string; params: unknown[]; auth: string | null }>;
} {
  const calls: Array<{ url: string; sql: string; params: unknown[]; auth: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const { sql, params } = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
    calls.push({ url, sql, params, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    const results = /^SELECT/.test(sql) ? rowsForSelect : [];
    return new Response(JSON.stringify({ success: true, result: [{ results, success: true, meta: {} }] }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('storeRawJson', () => {
  test('upserts by pathname, with the JSON body stringified and an auth header', async () => {
    const { fetchImpl, calls } = fakeD1();
    const pathname = await storeRawJson('run1', 'page1', 'mobile', { score: 1 }, fetchImpl);

    assert.equal(pathname, 'audit-raw-json/run1/page1-mobile.json');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/accounts\/test-account\/d1\/database\/test-db\/query$/);
    assert.match(calls[0].sql, /ON CONFLICT\(pathname\) DO UPDATE/);
    assert.equal(calls[0].params[0], pathname);
    assert.equal(calls[0].params[1], JSON.stringify({ score: 1 }));
    assert.equal(calls[0].auth, 'Bearer test-token');
  });
});

describe('fetchRawJson', () => {
  test('parses the stored body back into an object', async () => {
    const { fetchImpl } = fakeD1([{ body: JSON.stringify({ score: 1 }) }]);
    const json = await fetchRawJson('audit-raw-json/run1/page1-mobile.json', fetchImpl);
    assert.deepEqual(json, { score: 1 });
  });

  test('returns null, not a throw, when nothing matches', async () => {
    const { fetchImpl } = fakeD1([]);
    const json = await fetchRawJson('audit-raw-json/missing.json', fetchImpl);
    assert.equal(json, null);
  });

  test('returns null, not a throw, when the request itself fails', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const json = await fetchRawJson('audit-raw-json/run1/page1-mobile.json', failing);
    assert.equal(json, null);
  });
});

describe('deleteRawJsonBlobs', () => {
  test('does nothing, and makes no request, for an empty list', async () => {
    const { fetchImpl, calls } = fakeD1();
    await deleteRawJsonBlobs([], fetchImpl);
    assert.equal(calls.length, 0);
  });

  test('one DELETE per pathname, all in one query', async () => {
    const { fetchImpl, calls } = fakeD1();
    await deleteRawJsonBlobs(['a.json', 'b.json', 'c.json'], fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.length, 3);
    assert.match(calls[0].sql, /IN \(\?, \?, \?\)/);
  });

  test('batches beyond the chunk size into multiple queries, not one giant one', async () => {
    const { fetchImpl, calls } = fakeD1();
    const pathnames = Array.from({ length: 150 }, (_, i) => `p${i}.json`);
    await deleteRawJsonBlobs(pathnames, fetchImpl);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params.length, 100);
    assert.equal(calls[1].params.length, 50);
  });

  test('a failing request is swallowed, not thrown -- a leaked row costs a fraction of a cent', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await assert.doesNotReject(() => deleteRawJsonBlobs(['a.json'], failing));
  });
});
