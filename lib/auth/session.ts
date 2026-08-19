import { SignJWT, jwtVerify } from 'jose';

/**
 * Stateless session token: a signed (not encrypted) JWT carrying only the
 * username.
 *
 * `jose` rather than `jsonwebtoken` for one deciding reason: jose runs on the
 * Edge runtime, so proxy.ts can verify the same token. jsonwebtoken cannot,
 * and neither can Prisma -- a DB-backed session would leave no way to protect
 * every route from one place. See docs/DECISIONS.md 2.9.
 *
 * !! proxy.ts DUPLICATES the four constants below and the verify call, because
 * importing this module there would drag Node built-ins into the Edge bundle.
 * If you change SESSION_COOKIE, JWT_ALG, JWT_ISSUER or JWT_AUDIENCE, change
 * them in proxy.ts too -- test/auth.test.ts fails if they drift.
 *
 * Known tradeoff: a stateless token cannot be revoked before it expires. A
 * `tokenVersion` claim checked against the User row fixes that for one extra
 * read, if it ever matters.
 */

export const SESSION_COOKIE = 'psa_session';
export const JWT_ALG = 'HS256';
export const JWT_ISSUER = 'pagespeed-auditor';
export const JWT_AUDIENCE = 'pagespeed-auditor';

/**
 * 32 bytes is the HMAC-SHA256 block-equivalent security level, and it's what
 * `openssl rand -hex 32` produces (64 characters). Refusing anything shorter
 * is the only protection against someone setting SESSION_SECRET=changeme --
 * lib/env.ts can't enforce it because the field defaults to ''.
 */
export const MIN_SECRET_LENGTH = 32;

export interface SessionClaims {
  /** The authenticated user's id. */
  userId: string;
  /**
   * Which organisation this session is acting in. A user can belong to several,
   * so the token has to say which one -- but the ROLE is deliberately not in
   * here: it is re-read from the database on every request, so revoking
   * someone's access takes effect immediately rather than at token expiry.
   */
  organizationId: string;
  /** Issued-at, seconds since epoch. */
  issuedAt: number;
  /** Expiry, seconds since epoch. */
  expiresAt: number;
}

export interface SignSessionParams {
  userId: string;
  organizationId: string;
  secret: string;
  /** Lifetime in seconds. SESSION_TTL_DAYS x 86400 in the app; tests pass small or negative-offset values. */
  ttlSeconds: number;
  /** Injectable clock, so tests can mint an already-expired token. */
  now?: Date;
}

export function daysToSeconds(days: number): number {
  return Math.round(days * 24 * 60 * 60);
}

export function sessionKey(secret: string): Uint8Array {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 32`,
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession({ userId, organizationId, secret, ttlSeconds, now = new Date() }: SignSessionParams): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);

  return new SignJWT({ org: organizationId })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(sessionKey(secret));
}

/**
 * Returns null for every failure mode -- expired, tampered, wrong issuer,
 * wrong algorithm, garbage. Callers only ever need "is there a session", and
 * distinguishing the reasons in a log would just describe an attacker's typos.
 *
 * Pinning `algorithms` is not optional: without it a token with `alg: none`
 * or an asymmetric alg would be accepted against the HMAC key.
 */
export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(secret), {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.org !== 'string' || payload.org.length === 0) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;

    return { userId: payload.sub, organizationId: payload.org, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}
