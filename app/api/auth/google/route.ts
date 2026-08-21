import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { googleAuthUrl, signGoogleState, type GoogleIntent } from '@/lib/auth/google';
import { safeNextPath } from '@/lib/http/auth-guard';

export const dynamic = 'force-dynamic';

/**
 * Starts a "Continue with Google" round trip. One entry point for all three
 * places it's offered (login, signup, accept-invite) -- the ?intent param
 * says which, and the callback route reads the same signed value back to
 * know what to do once Google redirects here.
 */
export async function GET(req: Request) {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    return new NextResponse('Google sign-in is not configured on this deployment.', { status: 404 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('intent');

  let intent: GoogleIntent;
  if (kind === 'signup') {
    intent = { kind: 'signup' };
  } else if (kind === 'accept') {
    const token = url.searchParams.get('token');
    if (!token) return new NextResponse('Missing invitation token.', { status: 400 });
    intent = { kind: 'accept', token };
  } else {
    intent = { kind: 'login', next: safeNextPath(url.searchParams.get('next') ?? '/') };
  }

  const state = await signGoogleState(intent, env.SESSION_SECRET);
  const redirectUri = new URL('/api/auth/google/callback', env.APP_URL).toString();

  return NextResponse.redirect(googleAuthUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri, state }));
}
