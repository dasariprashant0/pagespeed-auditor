import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

/**
 * "Continue with Google" -- the OAuth2 authorization-code flow, hand-rolled
 * rather than pulling in a library, because the whole thing is three plain
 * HTTP calls plus a signature check `jose` (already a dependency, used the
 * same way for session tokens in lib/auth/session.ts) already does.
 *
 * Verification, not blind trust: an id_token is a JWT signed by Google, and
 * `verifyGoogleIdToken` checks that signature against Google's own published
 * keys rather than just decoding the payload -- decoding without verifying
 * would let anyone hand-craft a token claiming to be any email address.
 */

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const STATE_ALG = 'HS256';
const STATE_ISSUER = 'pagespeed-auditor-oauth-state';
/** Long enough to cover Google's own consent screen, short enough that a
 * leaked/logged redirect URL stops being useful quickly. */
const STATE_TTL_SECONDS = 10 * 60;

export type GoogleIntent =
  | { kind: 'login'; next: string }
  | { kind: 'signup' }
  | { kind: 'accept'; token: string };

/**
 * The `state` param round-tripped through Google. Signed (not just base64)
 * so a tampered intent -- e.g. changing which invite token an "accept" flow
 * resolves to -- fails verification instead of being trusted blindly.
 */
export async function signGoogleState(intent: GoogleIntent, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ intent })
    .setProtectedHeader({ alg: STATE_ALG })
    .setIssuer(STATE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + STATE_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

/** Null on anything short of a valid, unexpired, correctly-issued state. */
export async function verifyGoogleState(state: string, secret: string): Promise<GoogleIntent | null> {
  try {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(secret), {
      algorithms: [STATE_ALG],
      issuer: STATE_ISSUER,
    });
    return (payload.intent as GoogleIntent | undefined) ?? null;
  } catch {
    return null;
  }
}

export function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
    // Always show the account chooser -- someone testing a second Google
    // account on a shared machine should not be silently signed in as
    // whoever used it last.
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchanges the authorization code Google's redirect carried for an id_token. */
export async function exchangeGoogleCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Google would not exchange that code (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('Google\'s token response had no id_token.');
  return data.id_token;
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
}

/**
 * Verifies the id_token's signature against Google's own rotating public
 * keys, and its issuer/audience -- not just base64-decoding the payload,
 * which would trust an attacker-supplied token as-is. Requires
 * `email_verified`: Google issues id_tokens for addresses it hasn't
 * confirmed too (e.g. some legacy flows), and this app's whole identity
 * model keys on email being trustworthy.
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
  });

  if (typeof payload.email !== 'string' || !payload.email) {
    throw new Error('Google did not return an email address.');
  }
  if (payload.email_verified !== true) {
    throw new Error('That Google account\'s email address is not verified.');
  }

  return {
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : null,
  };
}
