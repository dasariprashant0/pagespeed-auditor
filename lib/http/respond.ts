import { NextResponse } from 'next/server';

/**
 * One JSON envelope for every route handler, so an agent (and later the MCP
 * server) can branch on `ok` without knowing which endpoint it called.
 *
 * proxy.ts emits the same 401 shape by hand -- it runs on the Edge runtime and
 * can't import this module. Keep the two in step.
 */

export interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

/**
 * Scores go stale the moment a sweep finishes, and a cached progress poll is
 * worse than no progress bar. Nothing this API returns is cacheable.
 */
const NO_STORE = { 'cache-control': 'no-store' } as const;

export function jsonError(status: number, code: string, message: string): NextResponse<ApiErr> {
  return NextResponse.json({ ok: false as const, error: { code, message } }, { status, headers: NO_STORE });
}

export function unauthorized(message = 'Authentication required.'): NextResponse<ApiErr> {
  return jsonError(401, 'unauthorized', message);
}
