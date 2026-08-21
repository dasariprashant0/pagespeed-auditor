import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, isUsableHash, BCRYPT_COST } from '../lib/auth/password.ts';
import { signSession, verifySession, daysToSeconds } from '../lib/auth/session.ts';
import { signPendingAuth, verifyPendingAuth } from '../lib/auth/pendingAuth.ts';

const SECRET = 'a'.repeat(64);

describe('password hashing', () => {
  test('round-trips, and a wrong password fails', async () => {
    const hash = await hashPassword('correct-horse-battery');
    assert.ok(await verifyPassword('correct-horse-battery', hash));
    assert.equal(await verifyPassword('wrong', hash), false);
  });

  test('an empty or malformed hash never authenticates', async () => {
    // A half-configured deployment must not be loggable-into with anything,
    // including an empty password.
    for (const bad of ['', 'not-a-hash', '$2b$12$tooshort']) {
      assert.equal(await verifyPassword('anything', bad), false);
      assert.equal(await verifyPassword('', bad), false);
      assert.equal(isUsableHash(bad), false);
    }
  });

  test('cost is high enough to be worth something', () => {
    assert.ok(BCRYPT_COST >= 12);
  });
});

describe('session tokens', () => {
  test('carry the user and the active organisation', async () => {
    const token = await signSession({
      userId: 'user_1', organizationId: 'org_1', secret: SECRET, ttlSeconds: 3600,
    });
    const claims = await verifySession(token, SECRET);
    assert.equal(claims?.userId, 'user_1');
    assert.equal(claims?.organizationId, 'org_1');
  });

  test('deliberately do NOT carry the role', async () => {
    // The role is re-read from the database on every request. Baking it into a
    // 30-day token would mean a demotion or removal did not take effect until
    // the token expired.
    const token = await signSession({
      userId: 'u', organizationId: 'o', secret: SECRET, ttlSeconds: 3600,
    });
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(decoded.role, undefined);
    assert.equal(decoded.org, 'o');
  });

  test('a token signed with another secret is rejected', async () => {
    const token = await signSession({
      userId: 'u', organizationId: 'o', secret: SECRET, ttlSeconds: 3600,
    });
    assert.equal(await verifySession(token, 'b'.repeat(64)), null);
  });

  test('a tampered token is rejected', async () => {
    const token = await signSession({
      userId: 'u', organizationId: 'o', secret: SECRET, ttlSeconds: 3600,
    });
    const [h, p, s] = token.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString());
    forged.sub = 'someone-else';
    const swapped = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`;
    assert.equal(await verifySession(swapped, SECRET), null);
  });

  test('an expired token is rejected', async () => {
    const token = await signSession({
      userId: 'u', organizationId: 'o', secret: SECRET, ttlSeconds: 1,
      now: new Date(Date.now() - 10_000),
    });
    assert.equal(await verifySession(token, SECRET), null);
  });

  test('a short secret is refused rather than silently weak', async () => {
    await assert.rejects(
      () => signSession({ userId: 'u', organizationId: 'o', secret: 'short', ttlSeconds: 60 }),
      /SESSION_SECRET/,
    );
  });

  test('day conversion', () => {
    assert.equal(daysToSeconds(1), 86_400);
    assert.equal(daysToSeconds(30), 2_592_000);
  });
});

describe('pending-auth tokens', () => {
  test('carry the user id, verifiable with the same secret', async () => {
    const token = await signPendingAuth('user_1', SECRET);
    const claims = await verifyPendingAuth(token, SECRET);
    assert.equal(claims?.userId, 'user_1');
  });

  test('a token signed with another secret is rejected', async () => {
    const token = await signPendingAuth('user_1', SECRET);
    assert.equal(await verifyPendingAuth(token, 'b'.repeat(64)), null);
  });

  test('a tampered token is rejected', async () => {
    const token = await signPendingAuth('user_1', SECRET);
    const [h, p, s] = token.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString());
    forged.sub = 'someone-else';
    const swapped = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`;
    assert.equal(await verifyPendingAuth(swapped, SECRET), null);
  });

  test('an expired token is rejected', async () => {
    const token = await signPendingAuth('user_1', SECRET, new Date(Date.now() - 10 * 60_000));
    assert.equal(await verifyPendingAuth(token, SECRET), null);
  });

  test('garbage input is rejected, not thrown', async () => {
    assert.equal(await verifyPendingAuth('not-a-token', SECRET), null);
  });
});
