import { cookies } from 'next/headers';
import { getEnv } from '../env.ts';
import { PENDING_AUTH_TTL_SECONDS, signPendingAuth, verifyPendingAuth } from '../auth/pendingAuth.ts';

/**
 * The Next-aware half of the pending-auth cookie -- same split as
 * lib/http/session.ts / lib/auth/session.ts, for the same reason.
 */

export const PENDING_AUTH_COOKIE = 'psa_pending_auth';

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: PENDING_AUTH_TTL_SECONDS,
  };
}

/** Set once password/Google has verified who someone is, before they've picked which organisation. */
export async function setPendingAuth(userId: string): Promise<void> {
  const token = await signPendingAuth(userId, getEnv().SESSION_SECRET);
  (await cookies()).set(PENDING_AUTH_COOKIE, token, cookieOptions());
}

/** Null if there is no pending sign-in, or it expired. */
export async function getPendingAuth(): Promise<{ userId: string } | null> {
  const token = (await cookies()).get(PENDING_AUTH_COOKIE)?.value;
  if (!token) return null;
  return verifyPendingAuth(token, getEnv().SESSION_SECRET);
}

export async function clearPendingAuth(): Promise<void> {
  (await cookies()).set(PENDING_AUTH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
}
