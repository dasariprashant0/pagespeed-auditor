import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crawlSitemap } from '../lib/sitemap/fetch.ts';
import { normalizeUrl, normalizeAndDedupe } from '../lib/sitemap/normalize.ts';
import { deriveGroup, slugify, titleCase } from '../lib/sitemap/group.ts';

const BASE = 'https://www.example.com';

/** Serves the fixture files as if they were live sitemap URLs. */
function fixtureFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  const map: Record<string, string> = {
    'https://www.example.com/sitemap.xml': 'test/fixtures/sitemap/index.xml',
    'https://www.example.com/sitemap-pages.xml': 'test/fixtures/sitemap/pages.xml',
    'https://www.example.com/sitemap-blog.xml.gz': 'test/fixtures/sitemap/blog.xml.gz',
    'https://www.example.com/sitemap-single.xml': 'test/fixtures/sitemap/single.xml',
  };
  return (async (input: string | URL) => {
    const url = String(input);
    if (overrides[url]) return overrides[url]();
    const path = map[url];
    if (!path) return new Response('not found', { status: 404 });
    return new Response(readFileSync(path), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('normalizeUrl', () => {
  test('strips the trailing slash except at root', () => {
    assert.equal((normalizeUrl(`${BASE}/pricing/`, BASE) as { url: string }).url, `${BASE}/pricing`);
    assert.equal((normalizeUrl(`${BASE}/`, BASE) as { url: string }).url, `${BASE}/`);
  });

  test('drops fragments and tracking params but keeps real query params', () => {
    const a = normalizeUrl(`${BASE}/pricing#top`, BASE) as { url: string };
    assert.equal(a.url, `${BASE}/pricing`);

    const b = normalizeUrl(`${BASE}/pricing?utm_source=x&fbclid=y&gclid=z`, BASE) as { url: string };
    assert.equal(b.url, `${BASE}/pricing`);

    const c = normalizeUrl(`${BASE}/search?q=demo`, BASE) as { url: string };
    assert.ok(c.url.includes('q=demo'), 'a meaningful query param must survive');
  });

  test('sorts query params so ordering is not a difference', () => {
    const a = normalizeUrl(`${BASE}/s?b=2&a=1`, BASE) as { url: string };
    const b = normalizeUrl(`${BASE}/s?a=1&b=2`, BASE) as { url: string };
    assert.equal(a.url, b.url);
  });

  test('lowercases host and drops default ports', () => {
    const a = normalizeUrl('https://WWW.EXAMPLE.COM:443/Pricing', BASE) as { url: string };
    assert.equal(a.url, `${BASE}/Pricing`, 'host lowercased, port dropped, path case preserved');
  });

  test('rejects cross-domain, assets, non-http and junk', () => {
    assert.deepEqual(normalizeUrl('https://cdn.other.net/x', BASE), { ok: false, reason: 'cross-domain' });
    assert.deepEqual(normalizeUrl(`${BASE}/a/b.pdf`, BASE), { ok: false, reason: 'asset-extension' });
    assert.deepEqual(normalizeUrl('mailto:a@b.c', BASE), { ok: false, reason: 'non-http' });
    assert.deepEqual(normalizeUrl('not a url', BASE), { ok: false, reason: 'unparseable' });
  });
});

describe('dedupe', () => {
  test('collapses slash, fragment and utm variants into one page', () => {
    const r = normalizeAndDedupe(
      [
        { loc: `${BASE}/pricing` },
        { loc: `${BASE}/pricing/` },
        { loc: `${BASE}/pricing#faq` },
        { loc: `${BASE}/pricing?utm_source=x` },
      ],
      BASE,
    );
    assert.equal(r.urls.length, 1);
    assert.equal(r.duplicates, 3);
  });

  test('reports why things were rejected', () => {
    const r = normalizeAndDedupe(
      [{ loc: `${BASE}/a` }, { loc: 'https://other.net/b' }, { loc: `${BASE}/c.pdf` }],
      BASE,
    );
    assert.equal(r.urls.length, 1);
    assert.equal(r.rejected['cross-domain'], 1);
    assert.equal(r.rejected['asset-extension'], 1);
  });

  test('keeps the newest lastmod across duplicates', () => {
    const r = normalizeAndDedupe(
      [
        { loc: `${BASE}/x`, lastmod: '2026-01-01' },
        { loc: `${BASE}/x/`, lastmod: '2026-06-01' },
      ],
      BASE,
    );
    assert.equal(r.urls[0].lastmod, '2026-06-01');
  });
});

describe('grouping', () => {
  test('uses the first path segment', () => {
    assert.deepEqual(deriveGroup('/features/webinars'), { slug: 'features', name: 'Features' });
    assert.deepEqual(deriveGroup('/blog/2026/post'), { slug: 'blog', name: 'Blog' });
  });

  test('the root path goes to Home', () => {
    assert.deepEqual(deriveGroup('/'), { slug: 'home', name: 'Home' });
    assert.deepEqual(deriveGroup(''), { slug: 'home', name: 'Home' });
  });

  test('title-cases multi-word segments', () => {
    assert.deepEqual(deriveGroup('/case-studies/acme'), { slug: 'case-studies', name: 'Case Studies' });
    assert.equal(titleCase('case-studies'), 'Case Studies');
    assert.equal(slugify('Case Studies!'), 'case-studies');
  });

  test('a segment that slugifies to nothing falls back to Home', () => {
    assert.deepEqual(deriveGroup('/%20/x'), { slug: 'home', name: 'Home' });
  });
});

describe('crawl', () => {
  test('recurses a sitemap index and merges children', async () => {
    const r = await crawlSitemap(`${BASE}/sitemap.xml`, { fetchImpl: fixtureFetch() });
    assert.ok(r.entries.length >= 10, `expected merged entries, got ${r.entries.length}`);
    assert.ok(r.entries.some((e) => e.loc.includes('/pricing')));
    assert.ok(r.entries.some((e) => e.loc.includes('/blog/only-post')), 'gzipped child must be included');
  });

  test('decompresses .xml.gz children (fetch does not do this)', async () => {
    const r = await crawlSitemap(`${BASE}/sitemap-blog.xml.gz`, { fetchImpl: fixtureFetch() });
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].loc, `${BASE}/blog/only-post`);
  });

  test('a single-<url> sitemap is not collapsed into an object', async () => {
    // fast-xml-parser turns a one-element list into an object. Without the
    // asArray() guard this silently yields zero pages.
    const r = await crawlSitemap(`${BASE}/sitemap-single.xml`, { fetchImpl: fixtureFetch() });
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0].lastmod, '2026-07-15');
  });

  test('a self-referencing index terminates', async () => {
    // index.xml lists itself; without the visited set this never returns.
    const r = await crawlSitemap(`${BASE}/sitemap.xml`, { fetchImpl: fixtureFetch() });
    assert.ok(r.documentsFetched <= 4, `visited ${r.documentsFetched} docs — cycle guard failed?`);
  });

  test('one broken child does not abort the whole crawl', async () => {
    const f = fixtureFetch({
      'https://www.example.com/sitemap-blog.xml.gz': () => new Response('boom', { status: 500 }),
    });
    const r = await crawlSitemap(`${BASE}/sitemap.xml`, { fetchImpl: f });
    assert.ok(r.entries.length > 0, 'the healthy child should still be ingested');
    assert.equal(r.errors.length, 1);
  });

  test('respects the document cap and reports truncation', async () => {
    const r = await crawlSitemap(`${BASE}/sitemap.xml`, { fetchImpl: fixtureFetch(), maxDocuments: 1 });
    assert.equal(r.documentsFetched, 1);
    assert.ok(r.truncated, 'truncation must be reported, not silent');
  });
});

describe('crawl + normalize end to end', () => {
  test('the fixture site yields the expected distinct pages and groups', async () => {
    const r = await crawlSitemap(`${BASE}/sitemap.xml`, { fetchImpl: fixtureFetch() });
    const n = normalizeAndDedupe(r.entries, BASE);

    const paths = n.urls.map((u) => u.path).sort();
    assert.deepEqual(paths, [
      '/',
      '/about',
      '/blog/only-post',
      '/case-studies/acme',
      '/features/webinars',
      '/pricing',
    ]);

    assert.equal(n.rejected['cross-domain'], 1);
    assert.equal(n.rejected['asset-extension'], 1);

    const groups = [...new Set(n.urls.map((u) => deriveGroup(u.path).slug))].sort();
    // /about is a top-level page WITH a segment, so it groups as 'about'.
    // Only the bare root '/' falls through to General. This is the spec's rule,
    // and it does mean a flat marketing site produces many one-page groups --
    // which is what manual merge in the dashboard exists to fix.
    assert.deepEqual(groups, ['about', 'blog', 'case-studies', 'features', 'home', 'pricing']);
  });
});
