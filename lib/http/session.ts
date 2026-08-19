import { cookies } from 'next/headers';
import { getEnv } from '../env.ts';
import {
  SESSION_COOKIE,
  daysToSeconds,
  signSession,
  verifySession,
  type SessionClaims,
} from '../auth/session.ts';

/**
 * The Next-aware half of the session: reads and writes the cookie.
 *
 * Everything crypto lives in lib/auth/session.ts so the worker, the tests and
 * (by duplication) the Edge proxy can use it without pulling in next/headers.
 * This module is the only place that knows the cookie's flags.
 */

export type { SessionClaims };

function cookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    // Lax, not Strict: Strict would drop the cookie on the redirect back from
    // an external link into the dashboard, showing a spurious login screen.
    // Lax still blocks cross-site POSTs, which is the CSRF case that matters.
    sameSite: 'lax' as const,
    // Keyed off APP_URL rather than NODE_ENV so a production build served over
    // plain HTTP on an internal host still gets a working cookie.
    secure: env.APP_URL.startsWith('https://'),
    path: '/',
    maxAge: daysToSeconds(env.SESSION_TTL_DAYS),
  };
}

/** The signed-in user, or null. Safe to call from any Server Component. */
export async function getSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, getEnv().SESSION_SECRET);
}

/**
 * Issue a session cookie. Only callable from a Server Action or Route Handler
 * -- Next throws if a Server Component tries to write cookies.
 */
export async function startSession(username: string): Promise<void> {
  const env = getEnv();
  const token = await signSession({
    username,
    secret: env.SESSION_SECRET,
    ttlSeconds: daysToSeconds(env.SESSION_TTL_DAYS),
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(): Promise<void> {
  // Overwrite with an expired cookie carrying the same flags rather than only
  // calling delete(); a mismatch in path or secure leaves the old cookie in
  // place in some browsers and the user appears to stay logged in.
  (await cookies()).set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
}
