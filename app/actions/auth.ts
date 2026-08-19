'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/lib/env';
import { verifyCredentials } from '@/lib/auth/password';
import { consumeLoginAttempt, resetLoginAttempts, retryAfterMinutes } from '@/lib/auth/rate-limit';
import { startSession, endSession } from '@/lib/http/session';
import { safeNextPath } from '@/lib/http/auth-guard';

/**
 * Login and logout.
 *
 * These are the two actions that deliberately do NOT start with
 * requireSession() -- one issues the session and the other disposes of it.
 * Every OTHER Server Action in this app must call requireSession() as its
 * first statement; see lib/http/auth-guard.ts.
 */

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Deliberately identical for a wrong username and a wrong password. Naming
 * which half failed hands an attacker the username for free, and the constant-
 * time compare in verifyCredentials() would then be pointless.
 */
const GENERIC_FAILURE = 'Username or password is incorrect.';

async function clientIp(): Promise<string> {
  const h = await headers();
  // Leftmost XFF entry is the client as seen by the first proxy. Behind no
  // proxy at all (local dev) every login shares the 'unknown' bucket, which is
  // fine for a ten-person internal tool but worth knowing if the limit ever
  // fires unexpectedly.
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  const limit = await consumeLoginAttempt(await clientIp());
  if (!limit.allowed) {
    return {
      ok: false,
      error: `Too many sign-in attempts. Try again in ${retryAfterMinutes(limit.retryAfterMs)} minutes.`,
    };
  }

  if (!username || !password) {
    return { ok: false, error: 'Enter your username and password.' };
  }

  const env = getEnv();
  const check = await verifyCredentials(
    { username, password },
    { username: env.AUTH_USERNAME, passwordHash: env.AUTH_PASSWORD_HASH },
  );

  if (!check.ok) {
    // The one case worth naming: a fresh checkout has AUTH_PASSWORD_HASH empty,
    // and "incorrect password" would send the operator hunting for a typo in a
    // password that was never configured. This leaks nothing -- an attacker
    // learns only that the deployment is unusable.
    if (check.reason === 'not_configured') {
      return {
        ok: false,
        error:
          'No password is configured for this deployment. Run `npm run hash-password -- \'your-password\'` and put the result in AUTH_PASSWORD_HASH.',
      };
    }
    return { ok: false, error: GENERIC_FAILURE };
  }

  await startSession(username);
  // One mistyped password nine times shouldn't leave the office IP one attempt
  // from a lockout.
  await resetLoginAttempts(await clientIp());

  // redirect() throws NEXT_REDIRECT, so it must stay outside any try/catch.
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  // No requireSession() here on purpose: guarding logout only means an
  // already-logged-out user is redirected to /login by the guard instead of by
  // the line below. Same destination, one more failure mode.
  await endSession();
  redirect('/login');
}
