import { PrismaClient } from '../generated/tenant/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { centralPrisma } from './central.ts';
import { decryptSecret } from '../crypto/secretBox.ts';
import { NotProvisionedError } from '../errors.ts';

/**
 * Resolves an organisation's OWN Neon database instead of the one shared
 * `centralPrisma` singleton in lib/db/central.ts -- see docs/DECISIONS.md
 * §19. Reads `Organization.tenantDbUrlEnc`/`provisionStatus` from the
 * still-shared central database (that lookup is unavoidable: you have to
 * know which tenant database to open before you can open it), decrypts the
 * connection string, and returns a real client for it.
 *
 * `lib/db/central.ts` (renamed from `lib/db.ts` as part of the phase 5
 * cutover -- see docs/DECISIONS.md) stays as the central client, so this
 * file imports it directly rather than duplicating the lookup logic.
 */

export type { PrismaClient as TenantPrismaClient };

interface CachedTenantClient {
  client: PrismaClient;
  connectionString: string;
}

/** Bounded so a warm serverless instance can't accumulate unbounded pools
 *  as the number of provisioned organisations grows. LRU by insertion
 *  order -- Map already preserves that, so the oldest key is just the
 *  first one iterated. */
const MAX_CACHED_TENANT_CLIENTS = 20;

const globalForTenant = globalThis as unknown as {
  __psaTenantPool?: Map<string, CachedTenantClient>;
};
// Survives Next dev's HMR module reloads, the same reason lib/db.ts's
// singleton does.
globalForTenant.__psaTenantPool ??= new Map();

async function resolveConnectionString(organizationId: string): Promise<string> {
  const org = await centralPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantDbUrlEnc: true, provisionStatus: true },
  });
  if (!org || org.provisionStatus !== 'ready' || !org.tenantDbUrlEnc) {
    throw new NotProvisionedError(organizationId);
  }
  return decryptSecret(org.tenantDbUrlEnc, `${organizationId}:tenantDbUrl`);
}

function buildClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * The steady-state path: most callers (Server Actions, pages, MCP tools)
 * each handle one organisation and want a client that survives across
 * requests on a warm instance, not a fresh pool every time.
 *
 * Re-validated against the freshly decrypted connection string on every
 * call (one indexed central read + one decrypt, both cheap) -- a rotated
 * credential just transparently swaps the pool on next use, no separate
 * invalidation path needed.
 */
export async function getTenantPrisma(organizationId: string): Promise<PrismaClient> {
  const connectionString = await resolveConnectionString(organizationId);
  const cache = globalForTenant.__psaTenantPool!;

  const cached = cache.get(organizationId);
  if (cached?.connectionString === connectionString) return cached.client;

  if (cached) {
    await cached.client.$disconnect().catch(() => {});
    cache.delete(organizationId);
  }
  if (cache.size >= MAX_CACHED_TENANT_CLIENTS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      await cache.get(oldestKey)!.client.$disconnect().catch(() => {});
      cache.delete(oldestKey);
    }
  }

  const client = buildClient(connectionString);
  cache.set(organizationId, { client, connectionString });
  return client;
}

/**
 * The escape hatch for code that fans out across MANY organisations in
 * one invocation (the schedule-tick cron, iterating every org with a due
 * schedule) -- opens, uses, and closes a client without ever touching the
 * shared cache above, so one tick can't leave dozens of pools warm on an
 * instance that will mostly handle single-org requests afterward.
 */
export async function withTenantPrisma<T>(
  organizationId: string,
  fn: (prisma: PrismaClient) => Promise<T>,
): Promise<T> {
  const connectionString = await resolveConnectionString(organizationId);
  const client = buildClient(connectionString);
  try {
    return await fn(client);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}
