import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../env.ts';

/**
 * Envelope encryption for secrets too sensitive for a plain column -- a
 * tenant's Neon connection string or Cloudflare D1 token, which is full
 * read/write access to an external database, not "send email as this
 * mailbox" (the existing PSI-key/SMTP-password convention, which stores
 * those as plain text, is deliberately NOT reused here).
 *
 * AES-256-GCM via Node's own `crypto` -- no new dependency, and GCM is
 * authenticated, so a tampered or truncated envelope fails to decrypt
 * instead of silently returning garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const ENVELOPE_VERSION = 'v1';

/**
 * 64 hex characters = 32 bytes = AES-256's key size, same generation
 * convention already documented for SESSION_SECRET (lib/auth/session.ts).
 */
export const SECRET_BOX_KEY_LENGTH = 64;

function keyBuffer(): Buffer {
  const raw = getEnv().SECRET_BOX_KEY.trim();
  if (raw.length !== SECRET_BOX_KEY_LENGTH || !/^[0-9a-f]+$/i.test(raw)) {
    throw new Error(
      `SECRET_BOX_KEY must be exactly ${SECRET_BOX_KEY_LENGTH} hex characters. Generate one with: openssl rand -hex 32`,
    );
  }
  return Buffer.from(raw, 'hex');
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * `context` is bound as GCM associated data (AAD) -- not encrypted, but
 * authenticated. Binding it to e.g. `${organizationId}:tenantDbUrl` means
 * a ciphertext copied into the wrong row or the wrong column fails to
 * decrypt instead of silently "working" with someone else's secret.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuffer(), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, b64url(iv), b64url(authTag), b64url(ciphertext)].join('.');
}

/** Throws on tampering, a wrong key, or a mismatched context -- never returns a partial/garbage result. */
export function decryptSecret(envelope: string, context: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error(`Not a recognized secretBox envelope (expected ${ENVELOPE_VERSION}.<iv>.<tag>.<ciphertext>).`);
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');

  const decipher = createDecipheriv(ALGORITHM, keyBuffer(), iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Sniffs the version prefix -- lets callers tell an envelope apart from a legacy plain value, if one is ever mixed in. */
export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${ENVELOPE_VERSION}.`);
}
