'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  login as loginUser,
  signup as signupOrg,
  acceptInvitation,
  requestPasswordReset,
  completePasswordReset,
  contextFor,
} from '@/lib/services/account.service';
import { getEnv } from '@/lib/env';
import { sendEmail } from '@/lib/notify/email';
import { consumeLoginAttempt, resetLoginAttempts, retryAfterMinutes } from '@/lib/auth/rate-limit';
import { startSession, endSession } from '@/lib/http/session';
import { setPendingAuth, getPendingAuth, clearPendingAuth } from '@/lib/http/pendingAuth';
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

  // The password is already verified at this point regardless of which
  // organisation gets picked next -- see membershipSummaries()'s comment in
  // account.service.ts for why this can no longer silently pick one itself.
  if (result.kind === 'choose') {
    await setPendingAuth(result.userId);
    redirect(`/login/organization?next=${encodeURIComponent(next)}`);
  }

  await startSession(result.context.userId, result.context.organizationId);
  redirect(next);
}

/**
 * The step between "password/Google verified who you are" and "which
 * organisation" -- only reachable via the pending-auth cookie set above,
 * never by posting an organisationId directly: the membership is re-verified
 * against the DB here regardless of what the form claims.
 */
export async function selectOrganizationAction(_prev: AuthResult | null, form: FormData): Promise<AuthResult> {
  const organizationId = String(form.get('organizationId') ?? '');
  const next = safeNextPath(String(form.get('next') ?? '/'));

  const pending = await getPendingAuth();
  if (!pending) return { ok: false, error: 'That sign-in attempt expired. Sign in again.' };

  const context = await contextFor(pending.userId, organizationId);
  if (!context) return { ok: false, error: 'You are not a member of that organisation.' };

  await clearPendingAuth();
  await startSession(context.userId, context.organizationId);
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

export type ResetRequestResult = { ok: true; message: string; devUrl?: string } | { ok: false; error: string };

/**
 * Starts a reset.
 *
 * The response is identical whether or not the address has an account -- a
 * different message would let anyone test which emails are registered. Rate
 * limited on the same bucket as login, since it is the same door.
 */
export async function requestResetAction(_prev: unknown, form: FormData): Promise<ResetRequestResult> {
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { ok: false, error: 'Enter your email address.' };

  const attempt = await consumeLoginAttempt(await clientKey());
  if (!attempt.allowed) return { ok: false, error: 'Too many attempts. Try again shortly.' };

  const { url } = await requestPasswordReset(email, getEnv().APP_URL);

  if (url) {
    await sendEmail(
      [email],
      'Reset your PageSpeed Auditor password',
      `<p>Someone asked to reset the password for this account.</p>
       <p><a href="${url}">Choose a new password</a></p>
       <p style="color:#78716c">The link works for 30 minutes. If this was not you, ignore it — nothing has changed.</p>`,
      `Reset your password:\n\n${url}\n\nThe link works for 30 minutes. If this was not you, ignore it.`,
    );
  }

  return {
    ok: true,
    message: 'If that address has an account, a reset link is on its way. It works for 30 minutes.',
    // Without a mail transport the link would be unreachable, which in a
    // self-hosted install means nobody can ever get back in.
    ...(url && getEnv().EMAIL_TRANSPORT !== 'resend' && getEnv().EMAIL_TRANSPORT !== 'smtp' ? { devUrl: url } : {}),
  };
}

export async function completeResetAction(_prev: AuthResult | null, form: FormData): Promise<AuthResult> {
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');

  const result = await completePasswordReset(token, password);
  if (!result.ok) return { ok: false, error: result.error };

  // Signed straight in where possible: they have just proved control of the
  // mailbox and chosen a password, so asking them to type it again
  // immediately is friction only.
  if (result.kind === 'choose') {
    await setPendingAuth(result.userId);
    redirect('/login/organization');
  }
  if (result.kind === 'none') redirect('/login');

  await startSession(result.userId, result.organizationId);
  redirect('/');
}
