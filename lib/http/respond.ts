import { NextResponse } from 'next/server';
import { AppError } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * One JSON envelope for every route handler, so an agent (and later the MCP
 * server) can branch on `ok` without knowing which endpoint it called.
 *
 * proxy.ts emits the same 401 shape by hand -- it runs on the Edge runtime and
 * can't import this module. Keep the two in step.
 */

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

/**
 * Scores go stale the moment a sweep finishes, and a cached progress poll is
 * worse than no progress bar. Nothing this API returns is cacheable.
 */
const NO_STORE = { 'cache-control': 'no-store' } as const;

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true as const, data }, { status, headers: NO_STORE });
}

export function jsonError(status: number, code: string, message: string): NextResponse<ApiErr> {
  return NextResponse.json({ ok: false as const, error: { code, message } }, { status, headers: NO_STORE });
}

export function unauthorized(message = 'Authentication required.'): NextResponse<ApiErr> {
  return jsonError(401, 'unauthorized', message);
}

export function badOrigin(): NextResponse<ApiErr> {
  return jsonError(403, 'bad_origin', 'Cross-origin request rejected.');
}

const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  validation: 400,
  // A permanent upstream failure (bad PSI key, 404 URL) is not the caller's
  // fault and not worth retrying -- 502 says both.
  permanent: 502,
  retryable: 503,
};

/**
 * Map a thrown error to a response. Only AppError messages are echoed: they
 * are written deliberately for humans. Anything else is a bug, and its message
 * may carry a connection string or a row of data, so it goes to the log and
 * the caller gets a generic 500.
 */
export function errorResponse(e: unknown): NextResponse<ApiErr> {
  if (e instanceof AppError) {
    return jsonError(STATUS_BY_CODE[e.code] ?? 500, e.code, e.message);
  }
  logger.error({ err: e }, 'unhandled error in route handler');
  return jsonError(500, 'internal', 'Something went wrong.');
}
