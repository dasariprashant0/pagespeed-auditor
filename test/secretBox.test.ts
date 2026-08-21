import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Same reason as test/blob.test.ts: getEnv() validates the whole schema at
// once and caches on first call, so both this key and DATABASE_URL (the
// one field with no default) must be set before anything here calls it.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.SECRET_BOX_KEY = 'a'.repeat(64);

const { encryptSecret, decryptSecret, isEncryptedEnvelope } = await import('../lib/crypto/secretBox.ts');

describe('encryptSecret / decryptSecret', () => {
  test('round-trips a plaintext through the same context', () => {
    const envelope = encryptSecret('postgresql://user:pass@host/db', 'org1:tenantDbUrl');
    assert.equal(decryptSecret(envelope, 'org1:tenantDbUrl'), 'postgresql://user:pass@host/db');
  });

  test('the envelope never contains the plaintext', () => {
    const secret = 'a-very-recognizable-secret-value';
    const envelope = encryptSecret(secret, 'org1:d1ApiToken');
    assert.ok(!envelope.includes(secret));
  });

  test('two encryptions of the same plaintext produce different envelopes', () => {
    // Each call generates a fresh random IV -- a static ciphertext would leak
    // "these two rows hold the same secret" even without decrypting either.
    const a = encryptSecret('same value', 'org1:tenantDbUrl');
    const b = encryptSecret('same value', 'org1:tenantDbUrl');
    assert.notEqual(a, b);
  });

  test('decrypting with the wrong context fails, even with the right key', () => {
    // A ciphertext copied into the wrong row/column must not silently decrypt.
    const envelope = encryptSecret('secret', 'org1:tenantDbUrl');
    assert.throws(() => decryptSecret(envelope, 'org2:tenantDbUrl'));
  });

  test('a tampered envelope fails to decrypt rather than returning garbage', () => {
    const envelope = encryptSecret('secret', 'org1:tenantDbUrl');
    const parts = envelope.split('.');
    // Flip a character in the ciphertext segment.
    const tamperedCiphertext = parts[3].slice(0, -1) + (parts[3].at(-1) === 'A' ? 'B' : 'A');
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join('.');
    assert.throws(() => decryptSecret(tampered, 'org1:tenantDbUrl'));
  });

  test('garbage input is rejected as not a recognized envelope', () => {
    assert.throws(() => decryptSecret('not-an-envelope-at-all', 'org1:tenantDbUrl'));
  });
});

describe('isEncryptedEnvelope', () => {
  test('true for a real envelope', () => {
    assert.equal(isEncryptedEnvelope(encryptSecret('x', 'ctx')), true);
  });

  test('false for null, undefined, plain text, or a legacy unencrypted value', () => {
    assert.equal(isEncryptedEnvelope(null), false);
    assert.equal(isEncryptedEnvelope(undefined), false);
    assert.equal(isEncryptedEnvelope('postgresql://plain/connection'), false);
  });
});
