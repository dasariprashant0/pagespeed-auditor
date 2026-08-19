import bcrypt from 'bcryptjs';

/**
 * Credential checking for the single shared login.
 *
 * Framework-free on purpose: this is imported by the Server Action (Node) and
 * by `node --test`, so it must not touch next/*, react, or process-level env
 * reading. The caller passes the configured credential in.
 */

/**
 * Cost 12 matches scripts/hash-password.ts. argon2id is stronger but needs
 * node-gyp/platform binaries -- real Docker and CI friction for a credential
 * this team checks a handful of times a day. See docs/DECISIONS.md before
 * "upgrading" it: changing the cost here without regenerating the hash in .env
 * does nothing, since the cost is encoded in the hash itself.
 */
export const BCRYPT_COST = 12;

/**
 * A real cost-12 hash of a string nobody can type. We compare against this
 * whenever there is no usable real hash to compare against (unknown username,
 * unconfigured deployment) so that a wrong username and a wrong password take
 * the same wall-clock time. Without it, "instant rejection" tells an attacker
 * the username is wrong, which is the only piece of the credential they'd
 * otherwise have to guess.
 */
const DUMMY_HASH = '$2b$12$JX6DMbPnRG7NP5Aab8xHXuxtr/LYgEeInHzYhr4ekBsaPBo2glny6';

/** bcrypt's modular crypt prefixes. Anything else in .env is a paste accident. */
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export type CredentialCheck =
  | { ok: true }
  /** The deployment has no usable AUTH_PASSWORD_HASH -- an operator problem, not a user one. */
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'invalid' };

export interface ConfiguredCredential {
  username: string;
  /** The bcrypt hash from AUTH_PASSWORD_HASH. May legitimately be '' on a fresh checkout. */
  passwordHash: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a bcrypt hash.
 *
 * An empty or malformed hash returns false rather than throwing, and still
 * burns a compare, so a half-configured deployment can never be logged into
 * with a blank password.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!isUsableHash(hash)) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}

export function isUsableHash(hash: string): boolean {
  return BCRYPT_HASH_RE.test(hash.trim());
}

/**
 * The whole login decision. Always performs exactly one bcrypt compare,
 * whatever the outcome, for the timing reason described on DUMMY_HASH.
 */
export async function verifyCredentials(
  submitted: { username: string; password: string },
  configured: ConfiguredCredential,
): Promise<CredentialCheck> {
  const hash = configured.passwordHash.trim();

  if (!isUsableHash(hash)) {
    await bcrypt.compare(submitted.password, DUMMY_HASH);
    return { ok: false, reason: 'not_configured' };
  }

  // Compare against the dummy rather than short-circuiting, so an unknown
  // username costs the same ~250 ms as a known one.
  if (submitted.username !== configured.username) {
    await bcrypt.compare(submitted.password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }

  return (await bcrypt.compare(submitted.password, hash))
    ? { ok: true }
    : { ok: false, reason: 'invalid' };
}
