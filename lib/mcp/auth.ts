import { createHash, randomBytes } from 'node:crypto';
import { centralPrisma } from '../db/central.ts';

/**
 * Agent authentication, scoped to one organisation.
 *
 * A single shared token in an environment variable was fine for one team and
 * is a tenancy hole the moment there are two: whoever held it would reach
 * whichever organisation a query happened to resolve to. Tokens now belong to
 * an organisation, are stored hashed so a leaked row cannot be redeemed, and
 * can be revoked one at a time.
 */

export interface McpAuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  organizationId: string;
}

const PREFIX = 'psa_';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return PREFIX + randomBytes(24).toString('base64url');
}

export async function createMcpToken(organizationId: string, label: string, createdById: string) {
  const token = generateToken();
  await centralPrisma.mcpToken.create({
    data: { organizationId, label: label.trim() || 'Agent', tokenHash: hash(token), createdById },
  });
  // Returned once and never recoverable -- only the hash is stored.
  return token;
}

/**
 * Looked up by hash, so the comparison is a single indexed equality rather than
 * a scan, and there is no secret to compare in constant time.
 */
export async function verifyMcpToken(_req: Request, bearerToken?: string): Promise<McpAuthInfo | undefined> {
  if (!bearerToken || !bearerToken.startsWith(PREFIX)) return undefined;

  const row = await centralPrisma.mcpToken.findUnique({
    where: { tokenHash: hash(bearerToken) },
    select: { id: true, organizationId: true, revokedAt: true },
  });
  if (!row || row.revokedAt) return undefined;

  // Fire-and-forget: a failed timestamp write must not fail the request.
  void centralPrisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return {
    token: bearerToken,
    clientId: row.id,
    // Agent access maps to the developer role's reach: read and act, but never
    // manage people or site configuration.
    scopes: ['audit:read', 'audit:write'],
    organizationId: row.organizationId,
  };
}
