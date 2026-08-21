import { Client } from 'pg';
import { TENANT_MIGRATIONS } from './migrations.generated.ts';

/**
 * The framework-free half of provisioning an organisation's own database
 * -- see docs/DECISIONS.md §19. app/actions/provisioning.ts is a thin
 * Server Action wrapper around this, the same shape as app/actions/site.ts
 * wrapping lib/services/*, so the actual validation/migration logic is
 * testable without a Next.js request context.
 */

/**
 * A real connect, plus (unless this org is already 'ready' and just
 * re-saving) a check that the target is empty. That check is a heuristic
 * -- it only looks for a pre-existing `Site` table -- so the caller's own
 * copy should say "must be a fresh, empty database" explicitly rather than
 * implying this is exhaustive.
 */
export async function validateNeonUrl(connectionString: string, alreadyReady: boolean): Promise<string | null> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    if (!alreadyReady) {
      const { rows } = await client.query<{ t: string | null }>(`SELECT to_regclass('"Site"') AS t`);
      if (rows[0]?.t !== null) {
        return 'That database already has tables in it. This must be a fresh, empty database.';
      }
    }
    return null;
  } catch (e) {
    return `Could not connect: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    await client.end().catch(() => {});
  }
}

/** A real `SELECT 1` against D1's own HTTP query API -- the same endpoint lib/blob.ts calls. */
export async function validateD1Credentials(
  accountId: string,
  databaseId: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    const body = (await res.json()) as { success: boolean; errors?: unknown[] };
    if (!res.ok || !body.success) {
      return `Cloudflare rejected that (HTTP ${res.status}): ${JSON.stringify(body.errors ?? {})}`;
    }
    return null;
  } catch (e) {
    return `Could not reach Cloudflare: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Every tenant migration, in order, inside one transaction -- a partial
 * failure leaves zero tables, so a retry starts clean rather than needing
 * per-statement idempotency.
 */
export async function runTenantMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const m of TENANT_MIGRATIONS) await client.query(m.sql);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}
