import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'node:zlib';

/**
 * Fetches a sitemap, recursing into sitemap indexes.
 *
 * Two things bite here:
 *  - fast-xml-parser collapses a single-element array into an object, so a
 *    sitemap with one <url> yields an object rather than a list. Everything
 *    goes through asArray().
 *  - .xml.gz sitemaps are common and `fetch` does NOT auto-decompress them
 *    (that only applies to content-encoding, a different header).
 */

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export interface CrawlResult {
  entries: SitemapEntry[];
  documentsFetched: number;
  errors: Array<{ url: string; message: string }>;
  truncated: boolean;
}

export interface CrawlOptions {
  maxDepth?: number;
  maxDocuments?: number;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true, // handles xhtml:/image:/video: namespaces cleanly
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** <loc> can parse as a string, a number (numeric-looking), or a text node. */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) return String((v as { '#text': unknown })['#text']);
  return undefined;
}

async function fetchDocument(
  url: string,
  timeoutMs: number,
  doFetch: typeof fetch,
): Promise<string> {
  const res = await doFetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/xml,text/xml,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());

  // Detect gzip by magic bytes rather than trusting the content-type header,
  // which is frequently wrong on static hosts.
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  return (isGzip ? gunzipSync(buf) : buf).toString('utf8');
}

export async function crawlSitemap(rootUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxDocuments = opts.maxDocuments ?? 100;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const concurrency = opts.concurrency ?? 5;
  const doFetch = opts.fetchImpl ?? fetch;

  const entries: SitemapEntry[] = [];
  const errors: CrawlResult['errors'] = [];
  // Self-referencing indexes are common; without this we'd loop forever.
  const visited = new Set<string>();
  let documentsFetched = 0;
  let truncated = false;

  async function crawl(url: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (visited.has(url)) return;
    if (documentsFetched >= maxDocuments) {
      truncated = true;
      return;
    }
    visited.add(url);

    let xml: string;
    try {
      xml = await fetchDocument(url, timeoutMs, doFetch);
      documentsFetched++;
    } catch (e) {
      errors.push({ url, message: e instanceof Error ? e.message : String(e) });
      return;
    }

    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(xml) as Record<string, unknown>;
    } catch (e) {
      errors.push({ url, message: `parse: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    // A sitemap index points at more sitemaps; a urlset holds pages.
    const index = doc.sitemapindex as { sitemap?: unknown } | undefined;
    if (index) {
      const children = asArray(index.sitemap)
        .map((s) => textOf((s as { loc?: unknown })?.loc))
        .filter((s): s is string => !!s);

      for (let i = 0; i < children.length; i += concurrency) {
        await Promise.all(children.slice(i, i + concurrency).map((c) => crawl(c, depth + 1)));
      }
      return;
    }

    const urlset = doc.urlset as { url?: unknown } | undefined;
    if (urlset) {
      for (const u of asArray(urlset.url)) {
        const rec = u as { loc?: unknown; lastmod?: unknown };
        const loc = textOf(rec?.loc);
        if (!loc) continue;
        entries.push({ loc, lastmod: textOf(rec?.lastmod) });
      }
      return;
    }

    errors.push({ url, message: 'neither <sitemapindex> nor <urlset>' });
  }

  await crawl(rootUrl, 0);
  return { entries, documentsFetched, errors, truncated };
}
