import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getSession } from './session.ts';
import { contextFor, type SessionContext } from '../services/account.service.ts';
import { can, type Capability } from '../auth/roles.ts';

/**
 * The authorization boundary.
 *
 * proxy.ts redirects unauthenticated browsers, but it is a UX layer: Server
 * Actions and route handlers are public HTTP endpoints reachable by a crafted
 * POST no matter what the matcher says. Everything that reads or changes tenant
 * data calls through here.
 *
 * The role is re-read from the database on every call rather than trusted from
 * the token, so removing someone or demoting them takes effect immediately
 * instead of whenever their 30-day session happens to expire.
 */

export type { SessionContext };

export class ForbiddenError extends Error {
  constructor(capability: Capability) {
    super(`Your role does not allow this (${capability}).`);
    this.name = 'ForbiddenError';
  }
}

/** Signed-in context, or a redirect to the login screen. */
export async function requireSession(): Promise<SessionContext> {
  const claims = await getSession();
  if (!claims) redirect('/login');

  const context = await contextFor(claims.userId, claims.organizationId);
  // Valid token, but the membership is gone -- removed from the organisation,
  // or the account was deleted. Treat it as signed out.
  if (!context) redirect('/login?reason=no-access');

  return context;
}

/** Session plus a capability check. Throws so an action can report it cleanly. */
export async function requireCapability(capability: Capability): Promise<SessionContext> {
  const context = await requireSession();
  if (!can(context.role, capability)) throw new ForbiddenError(capability);
  return context;
}

export interface ApiErr {
  error: string;
}

/** JSON 401 rather than an HTML redirect, so API errors stay debuggable. */
export async function requireApiSession(): Promise<SessionContext | NextResponse<ApiErr>> {
  const claims = await getSession();
  if (!claims) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const context = await contextFor(claims.userId, claims.organizationId);
  if (!context) return NextResponse.json({ error: 'no_access' }, { status: 403 });

  return context;
}

export async function requireApiCapability(
  capability: Capability,
): Promise<SessionContext | NextResponse<ApiErr>> {
  const context = await requireApiSession();
  if (context instanceof NextResponse) return context;
  if (!can(context.role, capability)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return context;
}

/**
 * Only paths inside this app, so `?next=` cannot be turned into an open
 * redirect to another origin.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
