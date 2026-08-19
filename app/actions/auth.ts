'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { login as loginUser, signup as signupOrg, acceptInvitation } from '@/lib/services/account.service';
import { consumeLoginAttempt, resetLoginAttempts, retryAfterMinutes } from '@/lib/auth/rate-limit';
import { startSession, endSession } from '@/lib/http/session';
import { safeNextPath } from '@/lib/http/auth-guard';

/**
 * Sign in, sign up, sign out, and accepting an invitation.
 *
 * These are the only actions that do NOT begin with requireSession -- they are
 * how a session comes to exist. Everything else in app/actions must.
 */

export type AuthResult = { ok: true } | { ok: false; error: string };

/** Kept for the login form's useActionState generic. */
export type LoginResult = AuthResult;

const GENERIC_FAILURE = 'Email or password is incorrect.';

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export async function loginAction(_prev: AuthResult | null, form: FormData): Promise<AuthResult> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = safeNextPath(String(form.get('next') ?? '/'));

  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };

  const key = await clientKey();
  const attempt = await consumeLoginAttempt(key);
  if (!attempt.allowed) {
    return { ok: false, error: `Too many attempts. Try again in ${retryAfterMinutes(attempt.retryAfterMs)} minutes.` };
  }

  const result = await loginUser(email, password);
  if (!result.ok) {
    // The account service distinguishes "no membership" from bad credentials;
    // that one is safe to surface because it is an operator problem, not a
    // hint about which emails exist.
    return { ok: false, error: result.error.includes('organisation') ? result.error : GENERIC_FAILURE };
  }

  await resetLoginAttempts(key);
  await startSession(result.context.userId, result.context.organizationId);
  redirect(next);
}

export async function signupAction(_prev: AuthResult | null, form: FormData): Promise<AuthResult> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const name = String(form.get('name') ?? '').trim();
  const organizationName = String(form.get('organizationName') ?? '').trim();

  const result = await signupOrg({ email, password, name, organizationName });
  if (!result.ok) return { ok: false, error: result.error };

  // Straight in: making someone sign in again immediately after choosing a
  // password is friction with no security benefit.
  await startSession(result.userId, result.organizationId);
  redirect('/');
}

export async function acceptInviteAction(_prev: AuthResult | null, form: FormData): Promise<AuthResult> {
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const name = String(form.get('name') ?? '').trim();

  const result = await acceptInvitation(token, password || undefined, name || undefined);
  if (!result.ok) return { ok: false, error: result.error };

  await startSession(result.userId, result.organizationId);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
