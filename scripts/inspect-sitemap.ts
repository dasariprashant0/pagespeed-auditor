/**
 * Dry-run sitemap ingestion: crawl, normalize, group, and report — without
 * writing anything to the database.
 *
 * Use it to sanity-check a sitemap before a real ingest, and to see how the
 * first-path-segment rule will actually carve up the site.
 *
 *   npm run inspect-sitemap
 *   npm run inspect-sitemap -- https://example.com/sitemap.xml https://example.com
 */
import 'dotenv/config';
import { crawlSitemap } from '../lib/sitemap/fetch.ts';
import { normalizeAndDedupe } from '../lib/sitemap/normalize.ts';
import { deriveGroup } from '../lib/sitemap/group.ts';

async function main() {
  const sitemapUrl = process.argv[2] ?? process.env.SITE_SITEMAP_URL;
  const baseUrl = process.argv[3] ?? process.env.SITE_BASE_URL;

  if (!sitemapUrl || !baseUrl) {
    console.error('Set SITE_SITEMAP_URL and SITE_BASE_URL in .env, or pass them as arguments.');
    process.exit(1);
  }

  console.log(`\n  sitemap  ${sitemapUrl}`);
  console.log(`  base     ${baseUrl}\n`);

  const t0 = Date.now();
  const crawl = await crawlSitemap(sitemapUrl);
  console.log(`  crawled ${crawl.documentsFetched} document(s) in ${Date.now() - t0} ms`);
  console.log(`  raw <loc> entries: ${crawl.entries.length}`);

  if (crawl.truncated) console.log('  !! TRUNCATED at the document cap — raise maxDocuments');
  for (const e of crawl.errors.slice(0, 5)) console.log(`  error: ${e.url} — ${e.message}`);
  if (crawl.errors.length > 5) console.log(`  ...and ${crawl.errors.length - 5} more errors`);

  const n = normalizeAndDedupe(crawl.entries, baseUrl);
  console.log(`\n  distinct pages: ${n.urls.length}  (collapsed ${n.duplicates} duplicate(s))`);

  const rejected = Object.entries(n.rejected).filter(([, v]) => v > 0);
  console.log(`  rejected: ${rejected.length ? rejected.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);

  const groups = new Map<string, number>();
  for (const u of n.urls) {
    const s = deriveGroup(u.path).slug;
    groups.set(s, (groups.get(s) ?? 0) + 1);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  console.log(`\n  groups: ${sorted.length}`);
  for (const [slug, count] of sorted.slice(0, 20)) {
    console.log(`    ${String(count).padStart(5)}  ${slug}`);
  }
  if (sorted.length > 20) console.log(`    ...and ${sorted.length - 20} more`);

  const singles = sorted.filter(([, c]) => c === 1).length;
  console.log(`\n  single-page groups: ${singles} of ${sorted.length}`);

  const calls = n.urls.length * 2;
  const rate = (Number(process.env.PSI_RATE_MAX ?? 3) / Number(process.env.PSI_RATE_WINDOW_MS ?? 4000)) * 1000;
  console.log(`\n  full sweep: ${calls} PSI calls -> ~${(calls / rate / 60).toFixed(0)} min at ${rate.toFixed(2)} req/s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
