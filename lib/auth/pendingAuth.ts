import { SignJWT, jwtVerify } from 'jose';

/**
 * The short-lived cookie between "password/Google verified who you are" and
 * "which organisation are you signing into" -- same signed-JWT pattern as
 * lib/auth/google.ts's OAuth state, and the same reason: a value this
 * short-lived doesn't need its own secret, so it reuses SESSION_SECRET
 * rather than adding one more thing to generate and rotate.
 */

const PENDING_ALG = 'HS256';
const PENDING_ISSUER = 'pagespeed-auditor-pending-auth';
/** Long enough to read a short list of organisations and click one. */
export const PENDING_AUTH_TTL_SECONDS = 5 * 60;

/** `now` is injectable, the same as signSession(), so a test can mint an already-expired token. */
export async function signPendingAuth(userId: string, secret: string, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: PENDING_ALG })
    .setSubject(userId)
    .setIssuer(PENDING_ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + PENDING_AUTH_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

/** Null on anything short of a valid, unexpired, correctly-issued token. */
export async function verifyPendingAuth(token: string, secret: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: [PENDING_ALG],
      issuer: PENDING_ISSUER,
    });
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}
