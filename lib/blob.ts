import { put, get, del } from '@vercel/blob';

/**
 * Where the pruned Lighthouse JSON lives now, instead of AuditResult.rawJson
 * -- see docs/DECISIONS.md §13. Private access: this is performance data
 * about an internal site, read only through the app's own auth, never a
 * public URL.
 *
 * Pathname is keyed by the (run, page, strategy) triple the DB already
 * treats as unique (@@unique([auditRunId, pageId, strategy])), not the
 * row's own id -- the id doesn't exist yet at upload time, since the DB only
 * assigns it on insert, and uploading before the transaction (rather than
 * after, with a second UPDATE) avoids a two-phase write for what is, worst
 * case on a rolled-back replay, an orphaned object costing a fraction of a
 * cent.
 */
function pathnameFor(runId: string, pageId: string, strategy: string): string {
  return `audit-raw-json/${runId}/${pageId}-${strategy}.json`;
}

export async function storeRawJson(
  runId: string,
  pageId: string,
  strategy: string,
  json: unknown,
): Promise<string> {
  const { pathname } = await put(pathnameFor(runId, pageId, strategy), JSON.stringify(json), {
    access: 'private',
    contentType: 'application/json',
  });
  return pathname;
}

/** Returns null on anything short of a clean 200 -- a missing/unreadable blob is not worth throwing over. */
export async function fetchRawJson(pathname: string): Promise<unknown | null> {
  try {
    const result = await get(pathname, { access: 'private' });
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Best-effort: a leaked blob costs a fraction of a cent, not worth failing a prune or a delete over. */
export async function deleteRawJsonBlobs(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames);
  } catch {
    /* see above */
  }
}
