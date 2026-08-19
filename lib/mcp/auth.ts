import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * MCP clients send headers, not cookies, so this endpoint authenticates
 * separately from the browser session.
 *
 * A dedicated bearer token rather than reusing the 30-day session JWT: an
 * expiring token would mean re-pasting a value into every agent's config every
 * month, and agent access should be revocable without logging everyone out.
 */
export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
}

/** Constant-time compare. `===` on a secret leaks its prefix through timing. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyMcpToken(_req: Request, bearerToken?: string): McpAuthInfo | undefined {
  const expected = process.env.MCP_BEARER_TOKEN;
  // Absent config must not mean "open". An unset token disables the endpoint.
  if (!expected) return undefined;
  if (!bearerToken) return undefined;
  if (!safeEqual(bearerToken, expected)) return undefined;

  return { token: bearerToken, clientId: 'team', scopes: ['audit:read', 'audit:write'] };
}
