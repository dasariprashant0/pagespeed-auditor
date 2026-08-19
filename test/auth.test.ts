import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

import {
  BCRYPT_COST,
  hashPassword,
  verifyPassword,
  isUsableHash,
  verifyCredentials,
} from '../lib/auth/password.ts';
import {
  SESSION_COOKIE,
  JWT_ALG,
  JWT_ISSUER,
  JWT_AUDIENCE,
  MIN_SECRET_LENGTH,
  daysToSeconds,
  sessionKey,
  signSession,
  verifySession,
} from '../lib/auth/session.ts';
import {
  LOGIN_RATE_LIMIT,
  decide,
  retryAfterMinutes,
  MemoryRateLimitStore,
} from '../lib/auth/rate-limit.ts';

/**
 * Pure tests only -- no Next runtime, no Redis, no DB. Everything Next-aware
 * (lib/http/*, app/actions/auth.ts) is deliberately not imported here; those
 * modules pull in next/headers and cannot load under `node --test`.
 */

const PASSWORD = 'correct-horse-battery-staple';
const SECRET = 'x'.repeat(MIN_SECRET_LENGTH);

describe('password hashing', () => {
  let realHash: string;

  before(async () => {
    realHash = await hashPassword(PASSWORD);
  });

  test('round-trips at the configured cost', async () => {
    assert.equal(await verifyPassword(PASSWORD, realHash), true);
    assert.equal(await verifyPassword(PASSWORD + 'x', realHash), false);
    // The cost is baked into the hash, so this is the only place it is
    // actually observable -- bumping BCRYPT_COST without regenerating the
    // hash in .env changes nothing.
    assert.equal(realHash.split('$')[2], String(BCRYPT_COST).padStart(2, '0'));
  });

  test('salts, so the same password never produces the same hash', async () => {
    assert.notEqual(await hashPassword(PASSWORD), realHash);
  });

  test('isUsableHash rejects everything that is not modular-crypt bcrypt', () => {
    assert.equal(isUsableHash(realHash), true);
    assert.equal(isUsableHash(` ${realHash} `), true, 'a trailing newline from a shell paste is survivable');
    assert.equal(isUsableHash(''), false);
    assert.equal(isUsableHash('   '), false);
    assert.equal(isUsableHash(PASSWORD), false, 'a plaintext password in the env var is not a hash');
    assert.equal(isUsableHash(realHash.slice(0, -1)), false, 'truncated by a copy/paste');
    assert.equal(isUsableHash('$2y$12$' + 'a'.repeat(53)), true, 'other bcrypt prefixes are still bcrypt');
  });

  test('an unusable hash always fails, and never throws', async () => {
    // The case that matters most: a fresh checkout ships an empty
    // AUTH_PASSWORD_HASH, and a blank password must not walk straight in.
    assert.equal(await verifyPassword('', ''), false);

    for (const bad of ['   ', 'not-a-hash', realHash.slice(0, -1)]) {
      assert.equal(await verifyPassword(PASSWORD, bad), false);
    }
  });
});

describe('verifyCredentials', () => {
  // Cost 4 on purpose: these tests exercise the decision logic, not bcrypt,
  // and the real cost is asserted above. At cost 12 this block alone costs
  // several seconds of CI time for no extra coverage.
  const USER = 'admin';
  let cheapHash: string;

  before(async () => {
    cheapHash = await bcrypt.hash(PASSWORD, 4);
  });

  test('accepts the configured credential', async () => {
    const r = await verifyCredentials(
      { username: USER, password: PASSWORD },
      { username: USER, passwordHash: cheapHash },
    );
    assert.deepEqual(r, { ok: true });
  });

  test('a wrong password and a wrong username are indistinguishable to the caller', async () => {
    const wrongPassword = await verifyCredentials(
      { username: USER, password: 'nope' },
      { username: USER, passwordHash: cheapHash },
    );
    const wrongUsername = await verifyCredentials(
      { username: 'someone-else', password: PASSWORD },
      { username: USER, passwordHash: cheapHash },
    );
    assert.deepEqual(wrongPassword, { ok: false, reason: 'invalid' });
    assert.deepEqual(wrongUsername, { ok: false, reason: 'invalid' });
  });

  test('an empty configured hash never authenticates anyone', async () => {
    // The failure mode this guards: a fresh checkout ships AUTH_PASSWORD_HASH=''
    // and a naive compare would let a blank password straight in.
    for (const password of ['', PASSWORD, 'anything at all']) {
      const r = await verifyCredentials(
        { username: USER, password },
        { username: USER, passwordHash: '' },
      );
      assert.deepEqual(r, { ok: false, reason: 'not_configured' });
    }
  });

  test('a whitespace-only or corrupt configured hash is not_configured, not invalid', async () => {
    // Distinguishing these matters: 'invalid' sends the operator hunting for a
    // typo in a password that was never configured.
    for (const hash of ['   ', '\n', 'changeme', cheapHash.slice(0, -3)]) {
      const r = await verifyCredentials(
        { username: USER, password: PASSWORD },
        { username: USER, passwordHash: hash },
      );
      assert.deepEqual(r, { ok: false, reason: 'not_configured' }, `hash: ${JSON.stringify(hash)}`);
    }
  });

  test('an unknown username still costs a bcrypt compare', async () => {
    // Timing assertions are flaky, so this measures the floor rather than a
    // ratio: a short-circuited rejection would return in well under a
    // millisecond, which is the leak we are preventing.
    const t = Date.now();
    await verifyCredentials(
      { username: 'ghost', password: PASSWORD },
      { username: USER, passwordHash: cheapHash },
    );
    assert.ok(Date.now() - t >= 1, 'unknown username returned too fast to have hashed anything');
  });
});

describe('session tokens', () => {
  test('issue/verify round trip carries the username and the expiry', async () => {
    const now = new Date('2026-08-19T12:00:00Z');
    const ttl = daysToSeconds(30);
    const token = await signSession({ username: 'admin', secret: SECRET, ttlSeconds: ttl, now });

    const claims = await verifySession(token, SECRET);
    assert.ok(claims, 'a freshly signed token must verify');
    assert.equal(claims.username, 'admin');
    assert.equal(claims.issuedAt, Math.floor(now.getTime() / 1000));
    assert.equal(claims.expiresAt, claims.issuedAt + ttl);
  });

  test('an expired token is rejected', async () => {
    const token = await signSession({
      username: 'admin',
      secret: SECRET,
      ttlSeconds: 60,
      now: new Date(Date.now() - 3600_000),
    });
    assert.equal(await verifySession(token, SECRET), null);
  });

  test('a tampered token is rejected', async () => {
    const token = await signSession({ username: 'admin', secret: SECRET, ttlSeconds: 3600 });
    const [header, payload, signature] = token.split('.');

    // Re-encoded payload claiming a different subject, original signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'root' }),
    ).toString('base64url');
    assert.equal(await verifySession(`${header}.${forgedPayload}.${signature}`, SECRET), null);

    // Signature mangled, payload untouched.
    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    assert.equal(await verifySession(`${header}.${payload}.${flipped}`, SECRET), null);

    assert.equal(await verifySession('not.a.token', SECRET), null);
    assert.equal(await verifySession('', SECRET), null);
  });

  test('a token signed with a different secret is rejected', async () => {
    const token = await signSession({ username: 'admin', secret: 'y'.repeat(64), ttlSeconds: 3600 });
    assert.equal(await verifySession(token, SECRET), null);
  });

  test('an unsigned alg:none token is rejected', async () => {
    // Without the pinned `algorithms` option jose would happily accept this.
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const iat = Math.floor(Date.now() / 1000);
    const forged = `${b64({ alg: 'none' })}.${b64({
      sub: 'admin',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat,
      exp: iat + 3600,
    })}.`;
    assert.equal(await verifySession(forged, SECRET), null);
  });

  test('a token from another app signed with the same secret is rejected', async () => {
    // Issuer and audience are what stop a leaked secret being reusable across
    // services, so they have to actually be checked.
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: JWT_ALG })
      .setSubject('admin')
      .setIssuer('some-other-app')
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    assert.equal(await verifySession(foreign, SECRET), null);
  });

  test('a weak secret fails closed on both sides', async () => {
    assert.throws(() => sessionKey('short'), /at least 32 characters/);
    await assert.rejects(
      signSession({ username: 'admin', secret: 'short', ttlSeconds: 60 }),
      /at least 32 characters/,
      'signing with a weak secret must be loud, not silent',
    );

    const token = await signSession({ username: 'admin', secret: SECRET, ttlSeconds: 3600 });
    // Verification swallows it into a null instead: a misconfigured deployment
    // logs nobody in rather than crashing every request.
    assert.equal(await verifySession(token, 'short'), null);
  });

  test('daysToSeconds', () => {
    assert.equal(daysToSeconds(1), 86_400);
    assert.equal(daysToSeconds(30), 2_592_000);
  });
});

describe('proxy.ts / lib-auth drift', () => {
  // proxy.ts runs on the Edge runtime and cannot import lib/auth/session.ts,
  // so it duplicates these four constants. Both files claim this test catches
  // the drift; that claim has to be true or the comments are worse than none.
  const source = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');

  test('duplicated constants still match', () => {
    for (const [name, value] of Object.entries({
      SESSION_COOKIE,
      JWT_ALG,
      JWT_ISSUER,
      JWT_AUDIENCE,
    })) {
      assert.match(
        source,
        new RegExp(`const ${name} = '${value}'`),
        `proxy.ts has drifted from lib/auth/session.ts on ${name} (expected '${value}')`,
      );
    }
  });

  test('imports nothing that would break the Edge runtime', () => {
    const allowed = new Set(['next/server', 'jose']);
    const imported = [...source.matchAll(/^import[^']*'([^']+)'/gm)].map((m) => m[1]);

    assert.ok(imported.length > 0, 'import scan found nothing -- the regex has rotted');
    for (const spec of imported) {
      assert.ok(allowed.has(spec), `proxy.ts imports '${spec}'; only ${[...allowed].join(', ')} run on Edge`);
    }
  });

  test('the login route and the API front doors stay out of the matcher', () => {
    // Matching /login redirects it to itself; matching /api/auth blocks the
    // login POST; /api/mcp must get its own bearer auth, never a 302.
    for (const excluded of ['login', 'api/auth', 'api/mcp']) {
      assert.ok(source.includes(excluded), `proxy.ts matcher no longer excludes ${excluded}`);
    }
  });
});

describe('login rate limit', () => {
  const { max, windowMs } = LOGIN_RATE_LIMIT;

  test('decide() blocks only once the count passes max', () => {
    // count is post-increment: the Nth attempt arrives as count === N.
    assert.deepEqual(decide({ count: 1, ttlMs: windowMs }), {
      allowed: true,
      remaining: max - 1,
      retryAfterMs: 0,
    });
    assert.deepEqual(decide({ count: max, ttlMs: 1000 }), {
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
    assert.deepEqual(decide({ count: max + 1, ttlMs: 1000 }), {
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
  });

  test('decide() never reports a negative wait', () => {
    // Redis PTTL returns -1/-2 for keys with no expiry or none at all.
    assert.equal(decide({ count: max + 1, ttlMs: -2 }).retryAfterMs, 0);
    assert.equal(decide({ count: max + 5, ttlMs: -1 }).remaining, 0);
  });

  test('retryAfterMinutes rounds up, because "0 minutes" is a lie', () => {
    assert.equal(retryAfterMinutes(0), 1);
    assert.equal(retryAfterMinutes(1), 1);
    assert.equal(retryAfterMinutes(60_000), 1);
    assert.equal(retryAfterMinutes(60_001), 2);
    assert.equal(retryAfterMinutes(15 * 60_000), 15);
  });

  test('the memory store counts a fixed window and then resets it', () => {
    let clock = 1_000_000;
    const store = new MemoryRateLimitStore(() => clock);

    for (let i = 1; i <= max; i++) {
      const hit = store.hit('ip', windowMs);
      assert.equal(hit.count, i);
      assert.equal(decide(hit).allowed, true, `attempt ${i} of ${max} should be allowed`);
    }

    const blocked = store.hit('ip', windowMs);
    assert.equal(blocked.count, max + 1);
    assert.equal(decide(blocked).allowed, false);

    // TTL counts down within the window rather than restarting on each hit.
    clock += windowMs - 1;
    assert.equal(store.hit('ip', windowMs).ttlMs, 1);

    // One millisecond later the window has rolled over.
    clock += 1;
    const fresh = store.hit('ip', windowMs);
    assert.deepEqual(fresh, { count: 1, ttlMs: windowMs });
    assert.equal(decide(fresh).allowed, true);
  });

  test('windows are per key, and reset() clears one', () => {
    const clock = 0;
    const store = new MemoryRateLimitStore(() => clock);

    for (let i = 0; i < max + 1; i++) store.hit('a', windowMs);
    assert.equal(decide(store.hit('b', windowMs)).allowed, true, 'one IP must not lock out another');

    store.reset('a');
    assert.equal(store.hit('a', windowMs).count, 1, 'a successful login clears the counter');
  });
});
