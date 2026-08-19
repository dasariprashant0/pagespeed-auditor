import { withMcpAuth } from 'mcp-handler';
import { mcpHandler } from '@/lib/mcp/server';
import { verifyMcpToken } from '@/lib/mcp/auth';

/**
 * MCP over Streamable HTTP, in-process rather than a separate service.
 *
 * The v2 spec is stateless, so the session-affinity argument that used to
 * justify splitting an MCP server out no longer applies. In-process means the
 * tools call lib/services/* as ordinary function calls -- no network hop, no
 * duplicated DTOs, and no second deployment to keep in step.
 *
 * proxy.ts deliberately excludes /api/mcp: it authenticates by bearer token,
 * and a 302 to /login is not a valid JSON-RPC response.
 */
const handler = withMcpAuth(mcpHandler, verifyMcpToken, {
  required: true,
  requiredScopes: ['audit:read'],
});

export { handler as GET, handler as POST, handler as DELETE };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A tool that queues work can take a while; the default would cut it short.
export const maxDuration = 300;
