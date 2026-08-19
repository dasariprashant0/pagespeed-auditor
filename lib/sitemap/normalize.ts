/**
 * URL normalization. This is what makes `Page.url @unique` actually deduplicate.
 *
 * One convention, applied everywhere -- including manual URL entry. If ingestion
 * strips a trailing slash but the dashboard's lookup doesn't, the same page
 * becomes two rows with two separate histories.
 */

/** Tracking params that create phantom duplicates of the same page. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_eid$/i,
  /^mc_cid$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^igshid$/i,
  /^yclid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^_ga$/i,
  /^vero_id$/i,
  /^s_kwcid$/i,
];

/** Not pages. A sitemap listing a PDF should not produce an auditable Page. */
const ASSET_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.xml', '.json', '.txt', '.zip', '.gz', '.mp4', '.webm', '.mp3', '.wav',
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.dmg', '.exe',
]);

export type RejectReason =
  | 'unparseable'
  | 'non-http'
  | 'cross-domain'
  | 'asset-extension';

export type NormalizeResult =
  | { ok: true; url: string; path: string }
  | { ok: false; reason: RejectReason };

function extensionOf(pathname: string): string {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot).toLowerCase();
}

export function normalizeUrl(raw: string, siteBaseUrl: string): NormalizeResult {
  let u: URL;
  let base: URL;
  try {
    u = new URL(raw.trim());
    base = new URL(siteBaseUrl);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'non-http' };
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // Drop default ports so :443 and the bare host aren't two pages.
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }

  // Sitemaps do sometimes list other domains (CDNs, partner sites).
  if (u.hostname !== base.hostname.toLowerCase()) {
    return { ok: false, reason: 'cross-domain' };
  }

  if (ASSET_EXTENSIONS.has(extensionOf(u.pathname))) {
    return { ok: false, reason: 'asset-extension' };
  }

  // Fragments are never a distinct page: /pricing#top is /pricing.
  u.hash = '';

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  // Stable ordering so ?a=1&b=2 and ?b=2&a=1 are one page.
  u.searchParams.sort();

  // Strip the trailing slash everywhere EXCEPT root, which must stay "/".
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  }

  return { ok: true, url: u.href, path: u.pathname };
}

export interface DedupeResult {
  urls: Array<{ url: string; path: string; lastmod?: string }>;
  rejected: Record<RejectReason, number>;
  duplicates: number;
}

export function normalizeAndDedupe(
  entries: Array<{ loc: string; lastmod?: string }>,
  siteBaseUrl: string,
): DedupeResult {
  const seen = new Map<string, { url: string; path: string; lastmod?: string }>();
  const rejected: Record<RejectReason, number> = {
    unparseable: 0,
    'non-http': 0,
    'cross-domain': 0,
    'asset-extension': 0,
  };
  let duplicates = 0;

  for (const e of entries) {
    const r = normalizeUrl(e.loc, siteBaseUrl);
    if (!r.ok) {
      rejected[r.reason]++;
      continue;
    }
    if (seen.has(r.url)) {
      duplicates++;
      // Keep the newest lastmod we've seen for this URL.
      const prev = seen.get(r.url)!;
      if (e.lastmod && (!prev.lastmod || e.lastmod > prev.lastmod)) prev.lastmod = e.lastmod;
      continue;
    }
    seen.set(r.url, { url: r.url, path: r.path, lastmod: e.lastmod });
  }

  return { urls: [...seen.values()], rejected, duplicates };
}
