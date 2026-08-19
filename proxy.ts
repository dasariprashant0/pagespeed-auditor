import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` (verified: PROXY_FILENAME =
 * 'proxy' in next/dist/lib/constants.js). Do not add a middleware.ts alongside
 * this.
 *
 * THIS IS A UX LAYER, NOT THE AUTHORIZATION BOUNDARY. It exists so an
 * unauthenticated page request lands on the login form instead of a broken
 * dashboard, and so an unauthenticated API call gets a debuggable 401 instead
 * of HTML. The real boundary is `requireSession()` in lib/http/auth-guard.ts,
 * called by the dashboard layout and as the first statement of every Server
 * Action -- actions are public endpoints reachable by a crafted POST no matter
 * what the matcher below says.
 *
 * IMPORT DISCIPLINE: this file runs on the Edge runtime. It may import ONLY
 * `next/server` and `jose`. Importing lib/env.ts or lib/auth/session.ts drags
 * in Node built-ins and breaks the build -- which is why the four constants
 * and the verify call below are deliberately duplicated from
 * lib/auth/session.ts. test/auth.test.ts fails if the two drift.
 */

const SESSION_COOKIE = 'psa_session';
const JWT_ALG = 'HS256';
const JWT_ISSUER = 'pagespeed-auditor';
const JWT_AUDIENCE = 'pagespeed-auditor';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Mirrors the ApiErr envelope in lib/http/respond.ts, which we can't import here. */
function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

let cachedKey: Uint8Array | undefined;

function secretKey(): Uint8Array | undefined {
  if (cachedKey) return cachedKey;
  // Read straight from process.env: lib/env.ts is a Node module.
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return undefined;
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;

  const key = secretKey();
  if (!key) {
    // Fail closed. An unset or trivial SESSION_SECRET means we cannot
    // distinguish a real token from a forged one, so nobody gets in.
    console.error('[proxy] SESSION_SECRET is missing or too short; refusing all sessions.');
    return false;
  }

  try {
    await jwtVerify(token, key, {
      algorithms: [JWT_ALG],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Browsers always attach Origin to a cross-site POST, so a *mismatch* is the
 * CSRF signal. A missing Origin is a non-browser client and is left alone --
 * see the same reasoning in lib/http/auth-guard.ts isSameOrigin().
 */
function originMismatch(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const isApi = req.nextUrl.pathname.startsWith('/api/');

  if (isApi && !SAFE_METHODS.has(req.method) && originMismatch(req)) {
    return apiError(403, 'bad_origin', 'Cross-origin request rejected.');
  }

  if (await hasValidSession(req)) return NextResponse.next();

  // 401 JSON rather than a 302 to HTML: a redirect makes an API failure look
  // like a successful HTML fetch to every client, and a 302 is not a valid
  // JSON-RPC response for the stage-6 MCP endpoint.
  if (isApi) return apiError(401, 'unauthorized', 'Authentication required.');

  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  // Path + query only, never an absolute URL -- see safeNextPath() in
  // app/actions/auth.ts, which validates this again before redirecting to it.
  login.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Everything except: Next's own static output, the favicon, the login page
   * itself (redirect loop), the auth endpoints, and /api/mcp -- which carries
   * its own bearer token in stage 6 and must never receive an HTML redirect.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|signup|invite|api/auth|api/mcp).*)'],
};
