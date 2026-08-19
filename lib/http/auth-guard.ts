import { redirect } from 'next/navigation';
import { getSession } from './session.ts';
import { unauthorized } from './respond.ts';
import type { SessionClaims } from '../auth/session.ts';
import type { NextResponse } from 'next/server';
import type { ApiErr } from './respond.ts';

/**
 * THE authorization boundary.
 *
 * proxy.ts is a UX layer: it turns an unauthenticated page request into a
 * redirect so nobody stares at a broken dashboard. It is NOT what keeps the
 * app private. Server Actions are public HTTP endpoints that a crafted POST
 * reaches whatever the proxy matcher says, and the matcher has exclusions.
 *
 * So: `requireSession()` is the FIRST statement of every Server Action, and of
 * the dashboard layout. If you add an action without it, that mutation is
 * unauthenticated. See docs/DECISIONS.md 2.9.
 */

/**
 * Returns the session, or redirects to /login and never returns.
 *
 * `redirect()` throws a NEXT_REDIRECT control-flow error, so this must not be
 * called inside a try/catch that swallows it.
 */
export async function requireSession(): Promise<SessionClaims> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Route-handler guard. Returns the session, or a 401 JSON response to return
 * as-is -- never an HTML redirect, because a 302 is useless to a fetch() caller
 * and is not a valid JSON-RPC response for the stage-6 MCP endpoint.
 *
 *   const gate = await requireApiSession();
 *   if (gate instanceof Response) return gate;
 */
export async function requireApiSession(): Promise<SessionClaims | NextResponse<ApiErr>> {
  const session = await getSession();
  return session ?? unauthorized();
}

/**
 * CSRF check for non-GET route handlers. (Server Actions get this from Next
 * for free; route handlers do not.)
 *
 * A *missing* Origin is allowed: browsers always attach one to a cross-site
 * POST, so only a mismatch indicates CSRF, while server-to-server callers
 * (cron, MCP, curl) legitimately send none. Rejecting those would break them
 * for no security gain.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Open-redirect guard for the `?next=` round trip.
 *
 * proxy.ts only ever writes a path here, but the query string is user-editable,
 * so `/login?next=https://evil.example` must not become a redirect target --
 * that turns our login form into a credible phishing hop. Anything that isn't
 * a plain in-app path collapses to '/'.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/';
  // '//host' is protocol-relative and '/\host' is treated as such by browsers.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  // Bouncing back to the login page after logging in is a loop, not a target.
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return '/';
  return raw;
}
