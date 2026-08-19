import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPagespeed, buildPsiUrl, backoffMs } from '../lib/psi/client.ts';

const OPTS = { apiKey: 'test-key', timeoutMs: 5000 };

/** Minimal Response stand-in so tests never touch the network. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}
const fetchReturning = (r: Response | (() => Promise<never>)) =>
  (typeof r === 'function' ? r : async () => r) as unknown as typeof fetch;

const goodBody = JSON.parse(readFileSync('test/fixtures/psi/desktop-basic.json', 'utf8'));

describe('request shape', () => {
  test('sends four repeated category params, not a comma-joined one', () => {
    // Comma-joining silently returns Performance only, with no error at all.
    const u = new URL(buildPsiUrl('https://x.test/', 'mobile', OPTS));
    assert.deepEqual(u.searchParams.getAll('category'), [
      'PERFORMANCE',
      'ACCESSIBILITY',
      'BEST_PRACTICES',
      'SEO',
    ]);
  });

  test('carries url, strategy and key', () => {
    const u = new URL(buildPsiUrl('https://x.test/a?b=1', 'desktop', OPTS));
    assert.equal(u.searchParams.get('url'), 'https://x.test/a?b=1');
    assert.equal(u.searchParams.get('strategy'), 'desktop');
    assert.equal(u.searchParams.get('key'), 'test-key');
  });
});

describe('error classification', () => {
  test('200 with a complete body succeeds', async () => {
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(reply(200, goodBody)),
    });
    assert.equal(r.ok, true);
  });

  test('429 is retryable and reads Retry-After', async () => {
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(reply(429, { error: { message: 'slow down' } }, { 'retry-after': '30' })),
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'retryable');
    assert.equal(r.retryAfterMs, 30_000);
  });

  test('5xx is retryable', async () => {
    for (const s of [500, 502, 503, 504]) {
      const r = await runPagespeed('https://x.test/', 'mobile', {
        ...OPTS,
        fetchImpl: fetchReturning(reply(s, { error: { message: 'boom' } })),
      });
      assert.equal(r.ok, false);
      assert.equal(r.kind, 'retryable', `HTTP ${s} should be retryable`);
    }
  });

  test('403 is permanent — a bad key or exhausted quota is an operator problem', async () => {
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(reply(403, { error: { message: 'quota exceeded' } })),
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'permanent');
  });

  test('a real Lighthouse 400 is a CONTENT error, not a malformed request', async () => {
    // Captured verbatim from the live API against a URL returning HTTP 500.
    // Classifying this as permanent-and-discard would throw away a legitimate
    // "this page will not render" result.
    const captured = JSON.parse(readFileSync('test/fixtures/psi/mobile-runtime-error.error.json', 'utf8'));
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(reply(400, captured)),
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'content', 'must be storable as an error row, not discarded');
    assert.equal(r.code, 'NO_FCP', 'the Lighthouse error code should be extracted');
  });

  test('a 400 that is NOT a lighthouseUserError stays permanent', async () => {
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(
        reply(400, { error: { message: 'bad url', errors: [{ reason: 'invalid' }] } }),
      ),
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'permanent');
  });

  test('network failure and timeout are retryable', async () => {
    for (const err of [new Error('ECONNRESET'), Object.assign(new Error('timed out'), { name: 'AbortError' })]) {
      const r = await runPagespeed('https://x.test/', 'mobile', {
        ...OPTS,
        fetchImpl: fetchReturning(async () => { throw err; }),
      });
      assert.equal(r.ok, false);
      assert.equal(r.kind, 'retryable');
    }
  });

  test('a 200 with a truncated body is retryable, not a crash', async () => {
    // PSI does this under load. Parsing it as success would write null scores.
    for (const body of ['{"lighthouseResult":', { lighthouseResult: {} }, {}]) {
      const r = await runPagespeed('https://x.test/', 'mobile', {
        ...OPTS,
        fetchImpl: fetchReturning(reply(200, body)),
      });
      assert.equal(r.ok, false);
      assert.equal(r.kind, 'retryable');
    }
  });

  test('a 200 runtimeError body is accepted — extraction turns it into an error row', async () => {
    const r = await runPagespeed('https://x.test/', 'mobile', {
      ...OPTS,
      fetchImpl: fetchReturning(reply(200, { lighthouseResult: { runtimeError: { code: 'NO_LCP' } } })),
    });
    assert.equal(r.ok, true, 'the shape guard must not reject a legitimate runtimeError response');
  });
});

describe('backoff', () => {
  test('grows exponentially and caps at 15 minutes', () => {
    const noJitter = () => 0.5; // 0.5 + 0.5 = 1.0x
    assert.equal(backoffMs(1, noJitter), 30_000);
    assert.equal(backoffMs(2, noJitter), 60_000);
    assert.equal(backoffMs(3, noJitter), 120_000);
    assert.equal(backoffMs(20, noJitter), 900_000);
  });

  test('jitter spreads retries so a batch does not retry in lockstep', () => {
    const lo = backoffMs(3, () => 0);
    const hi = backoffMs(3, () => 1);
    assert.ok(lo < hi);
    assert.ok(lo >= 60_000 && hi <= 240_000);
  });
});
