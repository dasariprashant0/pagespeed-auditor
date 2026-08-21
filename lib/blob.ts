import { getEnv } from './env.ts';
import { PermanentError, RetryableError } from './errors.ts';

/**
 * Where the pruned Lighthouse JSON lives now, instead of AuditResult.rawJson
 * -- see docs/DECISIONS.md §18. A Cloudflare D1 database (plain SQLite),
 * called over its HTTP query API -- no Cloudflare Workers runtime involved,
 * this is a fetch() from wherever this code runs, same as any other API.
 *
 * Replaces an earlier design that used Vercel Blob (docs/DECISIONS.md §13):
 * Blob's free "Advanced Operations" allowance (2,000/month, one per put())
 * turned out smaller than a single full sweep of this site (1,000-2,000
 * pages x strategies). Cloudflare R2 is the obvious like-for-like
 * replacement and was rejected for a specific, verified reason: enabling it
 * requires a card on file even to stay on its free tier, with no bypass.
 * D1's free tier (5 GB storage, 100k writes/day, 5M reads/day) has no such
 * gate, and its per-row limit (2 MB) comfortably fits a pruned response.
 *
 * Pathname is keyed by the (run, page, strategy) triple the DB already
 * treats as unique (@@unique([auditRunId, pageId, strategy])), not the
 * row's own id -- the id doesn't exist yet at upload time, since the DB only
 * assigns it on insert, and uploading before the transaction (rather than
 * after, with a second UPDATE) avoids a two-phase write for what is, worst
 * case on a rolled-back replay, an orphaned object costing a fraction of a
 * cent.
 */
export function pathnameFor(runId: string, pageId: string, strategy: string): string {
  return `audit-raw-json/${runId}/${pageId}-${strategy}.json`;
}

/**
 * One organisation's own D1 database -- see docs/DECISIONS.md §19. Optional
 * everywhere below, and falls back to the shared, env-configured D1 (§18)
 * when omitted, so every existing call site keeps working unchanged while
 * the per-tenant cutover happens gradually. That fallback is a transitional
 * bridge, not the intended end state -- decision §19.4 is every org brings
 * its own, no shared tier, and the CLOUDFLARE_* env vars this falls back to
 * are meant to come out entirely once the real cutover lands.
 */
export interface D1Credentials {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

function credentialsFromEnv(): D1Credentials {
  const env = getEnv();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_D1_DATABASE_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new PermanentError(
      'Cloudflare D1 is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN).',
    );
  }
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: env.CLOUDFLARE_D1_DATABASE_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
  };
}

interface D1QueryResult {
  results: Array<Record<string, unknown>>;
  success: boolean;
  meta: { changes?: number };
}

/**
 * One call to D1's HTTP query API. Parameterized (never string-built SQL) --
 * this is the same trust boundary as any other database call in this app.
 *
 * Missing credentials fail fast as PermanentError (a config problem, retrying
 * changes nothing); anything the API itself rejects is RetryableError, same
 * treatment PSI failures get in audit.service.ts, since a transient D1 blip
 * looks identical to a transient PSI one from the caller's side.
 */
async function d1Query(
  creds: D1Credentials,
  sql: string,
  params: unknown[],
  fetchImpl: typeof fetch = fetch,
): Promise<D1QueryResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${creds.databaseId}/query`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  const body = (await res.json()) as { success: boolean; result?: D1QueryResult[]; errors?: unknown[] };
  if (!res.ok || !body.success || !body.result?.[0]) {
    throw new RetryableError(`D1 query failed (HTTP ${res.status}): ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result[0];
}

/** D1's bound-parameter ceiling per statement is well above this, but keep
 *  a wide safety margin rather than ever finding the real one in production. */
const DELETE_CHUNK_SIZE = 100;

export async function storeRawJson(
  runId: string,
  pageId: string,
  strategy: string,
  json: unknown,
  creds?: D1Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const pathname = pathnameFor(runId, pageId, strategy);
  // ON CONFLICT ... DO UPDATE is the same "allowOverwrite" need Vercel Blob's
  // put() had: the path is deterministic per (run, page, strategy), so a
  // retry re-writes the same key rather than failing on "already exists" --
  // see the comment on that in lib/services/audit.service.ts's history.
  await d1Query(
    creds ?? credentialsFromEnv(),
    `INSERT INTO raw_json_blobs (pathname, body, created_at) VALUES (?, ?, ?)
     ON CONFLICT(pathname) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`,
    [pathname, JSON.stringify(json), Date.now()],
    fetchImpl,
  );
  return pathname;
}

/** Returns null on anything short of a real row -- a missing/unreadable blob is not worth throwing over. */
export async function fetchRawJson(
  pathname: string,
  creds?: D1Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | null> {
  try {
    const result = await d1Query(creds ?? credentialsFromEnv(), 'SELECT body FROM raw_json_blobs WHERE pathname = ?', [pathname], fetchImpl);
    const row = result.results[0] as { body?: string } | undefined;
    if (!row?.body) return null;
    return JSON.parse(row.body) as unknown;
  } catch {
    return null;
  }
}

/** Best-effort: a leaked row costs a fraction of a cent, not worth failing a prune or a delete over. */
export async function deleteRawJsonBlobs(
  pathnames: string[],
  creds?: D1Credentials,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    const resolved = creds ?? credentialsFromEnv();
    for (let i = 0; i < pathnames.length; i += DELETE_CHUNK_SIZE) {
      const chunk = pathnames.slice(i, i + DELETE_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(', ');
      await d1Query(resolved, `DELETE FROM raw_json_blobs WHERE pathname IN (${placeholders})`, chunk, fetchImpl);
    }
  } catch {
    /* see above */
  }
}
