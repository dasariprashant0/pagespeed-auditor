import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateD1Credentials } from '../lib/tenantDb/provision.ts';

/**
 * Only validateD1Credentials is unit-tested here -- validateNeonUrl and
 * runTenantMigrations need a real Postgres connection, and this codebase's
 * convention (see test/blob.test.ts's own history) is not to make the
 * standard suite depend on a live database. Those two were verified
 * directly against real throwaway databases instead; see the BUILD_LOG
 * entry for this phase for what was actually run and what it confirmed.
 */

function fakeD1(shape: { ok: boolean; success: boolean; status?: number }) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    return new Response(JSON.stringify({ success: shape.success, errors: shape.success ? [] : ['nope'] }), {
      status: shape.status ?? (shape.ok ? 200 : 403),
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('validateD1Credentials', () => {
  test('null (valid) on a successful response', async () => {
    const { fetchImpl, calls } = fakeD1({ ok: true, success: true });
    const result = await validateD1Credentials('acct', 'db', 'token', fetchImpl);
    assert.equal(result, null);
    assert.match(calls[0].url, /\/accounts\/acct\/d1\/database\/db\/query$/);
    assert.equal(calls[0].auth, 'Bearer token');
  });

  test('a message, not null, when Cloudflare rejects it', async () => {
    const { fetchImpl } = fakeD1({ ok: false, success: false, status: 403 });
    const result = await validateD1Credentials('acct', 'db', 'wrong-token', fetchImpl);
    assert.ok(result);
    assert.match(result!, /403/);
  });

  test('a message, not a throw, when the request itself fails', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await validateD1Credentials('acct', 'db', 'token', failing);
    assert.ok(result);
    assert.match(result!, /network down/);
  });
});
