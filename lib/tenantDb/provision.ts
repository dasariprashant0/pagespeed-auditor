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
 * A real connect, plus a check that the target is empty. That check is a
 * heuristic -- it only looks for a pre-existing `Site` table -- so the
 * caller's own copy should say "must be a fresh, empty database" explicitly
 * rather than implying this is exhaustive.
 *
 * Always runs, even when the caller is already 'ready' from an earlier
 * provisioning. A prior version skipped it in that case, on the theory that
 * an already-ready org typing a new value must be rotating to a fresh
 * database -- but that assumption doesn't hold if the new value is the same
 * (or another already-migrated) database: the skip let `runTenantMigrations`
 * run straight into `relation "Site" already exists`, a raw driver error
 * instead of this function's own clear message. The one case that
 * legitimately needs no re-check -- resubmitting the exact same,
 * already-working value -- is handled earlier, in the caller, by the
 * dot-placeholder "unchanged" shortcut, which skips calling this function
 * at all.
 */
export async function validateNeonUrl(connectionString: string): Promise<string | null> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const { rows } = await client.query<{ t: string | null }>(`SELECT to_regclass('"Site"') AS t`);
    if (rows[0]?.t !== null) {
      return 'That database already has tables in it. This must be a fresh, empty database.';
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
 * Creates the `raw_json_blobs` table this org's D1 database needs -- see
 * docs/PER_TENANT_ARCHITECTURE.md's "real gap" note. `validateD1Credentials`
 * only proves the credentials can reach D1; a bare `SELECT 1` succeeds
 * against a genuinely empty, brand-new database with no tables at all, so
 * without this, lib/blob.ts's INSERT/SELECT/DELETE against that table would
 * fail the moment Phase 5 starts routing raw JSON through an org's own D1
 * instead of the shared one. `IF NOT EXISTS` makes this safe to re-run on
 * every credential save, including a token rotation against an
 * already-provisioned database.
 */
export async function ensureD1Schema(
  accountId: string,
  databaseId: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: 'CREATE TABLE IF NOT EXISTS raw_json_blobs (pathname TEXT PRIMARY KEY, body TEXT, created_at INTEGER)',
      }),
    });
    const body = (await res.json()) as { success: boolean; errors?: unknown[] };
    if (!res.ok || !body.success) {
      return `Connected, but could not create the raw_json_blobs table (HTTP ${res.status}): ${JSON.stringify(body.errors ?? {})}`;
    }
    return null;
  } catch (e) {
    return `Could not reach Cloudflare: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Read-only usage for the Settings → Database page -- a plain GET against
 * the same D1 database resource `validateD1Credentials`/`ensureD1Schema`
 * already talk to, not a new API surface or a new credential. Cloudflare's
 * `file_size` is the on-disk size of the whole SQLite file, which is what
 * counts against the account's D1 storage.
 */
export async function getD1Usage(
  accountId: string,
  databaseId: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: number; numTables: number } | { error: string }> {
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const body = (await res.json()) as {
      success: boolean;
      result?: { file_size?: number; num_tables?: number };
      errors?: unknown[];
    };
    if (!res.ok || !body.success) {
      return { error: `Cloudflare rejected that (HTTP ${res.status}): ${JSON.stringify(body.errors ?? {})}` };
    }
    return { bytes: body.result?.file_size ?? 0, numTables: body.result?.num_tables ?? 0 };
  } catch (e) {
    return { error: `Could not reach Cloudflare: ${e instanceof Error ? e.message : String(e)}` };
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
