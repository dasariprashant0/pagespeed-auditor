import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { exchangeGoogleCode, verifyGoogleIdToken, verifyGoogleState } from '@/lib/auth/google';
import { loginWithGoogle, signupWithGoogle, acceptInvitationWithGoogle } from '@/lib/services/account.service';
import { startSession } from '@/lib/http/session';
import { setPendingAuth } from '@/lib/http/pendingAuth';

export const dynamic = 'force-dynamic';

/**
 * Where Google sends the browser back to. Verifies the state this app
 * itself signed (see ../route.ts), exchanges the code for a verified
 * identity, then hands off to whichever account.service function matches
 * the original intent -- the exact same functions the password forms use,
 * minus the password.
 *
 * Every failure redirects back to a real page with a query param it already
 * knows how to display (?error=...), rather than rendering a bare API
 * response -- a dead end with no way back to the form is worse than a
 * slightly generic message.
 */
export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const googleError = url.searchParams.get('error');

  const fail = (path: string, message: string) =>
    NextResponse.redirect(new URL(`${path}?error=${encodeURIComponent(message)}`, env.APP_URL));

  if (googleError) return fail('/login', 'Google sign-in was cancelled.');
  if (!code || !state || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return fail('/login', 'Google sign-in is not available right now.');
  }

  const intent = await verifyGoogleState(state, env.SESSION_SECRET);
  if (!intent) return fail('/login', 'That Google sign-in link expired. Try again.');

  const fallbackPath = intent.kind === 'accept' ? '/invite' : intent.kind === 'signup' ? '/signup' : '/login';

  let identity;
  try {
    const redirectUri = new URL('/api/auth/google/callback', env.APP_URL).toString();
    const idToken = await exchangeGoogleCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    });
    identity = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  } catch (e) {
    return fail(fallbackPath, e instanceof Error ? e.message : 'Google sign-in failed.');
  }

  if (intent.kind === 'login') {
    const result = await loginWithGoogle(identity.email);
    if (!result.ok) return fail('/login', result.error);
    if (result.kind === 'choose') {
      await setPendingAuth(result.userId);
      return NextResponse.redirect(
        new URL(`/login/organization?next=${encodeURIComponent(intent.next)}`, env.APP_URL),
      );
    }
    await startSession(result.context.userId, result.context.organizationId);
    return NextResponse.redirect(new URL(intent.next, env.APP_URL));
  }

  if (intent.kind === 'signup') {
    // There is no organisation name to ask for mid-redirect, so the
    // account's own name (or the address before the @) stands in --
    // renameable afterwards from Settings, same as the password path
    // lets someone fix a typo.
    const organizationName = identity.name?.trim() || identity.email.split('@')[0];
    const result = await signupWithGoogle({ email: identity.email, name: identity.name, organizationName });
    if (!result.ok) return fail('/signup', result.error);
    await startSession(result.userId, result.organizationId);
    return NextResponse.redirect(new URL('/', env.APP_URL));
  }

  // intent.kind === 'accept'
  const result = await acceptInvitationWithGoogle(intent.token, identity.email, identity.name);
  if (!result.ok) return fail(`/invite?token=${encodeURIComponent(intent.token)}`, result.error);
  await startSession(result.userId, result.organizationId);
  return NextResponse.redirect(new URL('/', env.APP_URL));
}
