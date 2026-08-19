/**
 * Integration check for the two ingestion invariants that are easy to get
 * wrong and impossible to notice when they break:
 *
 *   1. A merged-away group must NOT reappear on re-ingest and drag its pages
 *      back out of the merged group. (This is what GroupAlias exists for.)
 *   2. A page manually moved to another group must STAY there.
 *
 * Operates on a throwaway Site row served from local fixtures, then deletes it.
 * The real site's data is never touched.
 *
 *   npm run verify:ingest
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ingestSitemap } from '../lib/services/ingest.service.ts';
import { mergeGroups, renameGroup } from '../lib/services/group.service.ts';

const BASE = 'https://www.example.com';
const fixtureFetch = (async (input: string | URL) => {
  const map: Record<string, string> = {
    [`${BASE}/sitemap.xml`]: 'test/fixtures/sitemap/index.xml',
    [`${BASE}/sitemap-pages.xml`]: 'test/fixtures/sitemap/pages.xml',
    [`${BASE}/sitemap-blog.xml.gz`]: 'test/fixtures/sitemap/blog.xml.gz',
  };
  const p = map[String(input)];
  return p ? new Response(readFileSync(p)) : new Response('nf', { status: 404 });
}) as unknown as typeof fetch;

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const site = await prisma.site.create({
    data: { name: '__invariant_test__', sitemapUrl: `${BASE}/sitemap.xml`, baseUrl: BASE },
  });

  try {
    const opts = { crawl: { fetchImpl: fixtureFetch } };

    console.log('\n  initial ingest');
    const first = await ingestSitemap(prisma, site.id, opts);
    check('creates pages', first.created === 6, `created ${first.created}`);
    check('creates groups', first.groupsCreated === 6, `groups ${first.groupsCreated}`);

    console.log('\n  re-ingest is a no-op');
    const second = await ingestSitemap(prisma, site.id, opts);
    check('no new pages', second.created === 0);
    check('no new groups', second.groupsCreated === 0);
    check('nothing regrouped', second.regrouped === 0);
    check('nothing deactivated', second.deactivated === 0);

    // --- invariant 1: merge survives re-ingest ---------------------------
    console.log('\n  merge blog + case-studies -> blog, then re-ingest');
    const blog = await prisma.group.findFirstOrThrow({ where: { siteId: site.id, slug: 'blog' } });
    const cs = await prisma.group.findFirstOrThrow({ where: { siteId: site.id, slug: 'case-studies' } });
    const merge = await mergeGroups(prisma, [cs.id], blog.id);
    check('pages moved to target', merge.pagesMoved === 1, `moved ${merge.pagesMoved}`);
    check('alias created for the dead slug', merge.aliasesCreated === 1);

    const third = await ingestSitemap(prisma, site.id, opts);
    const csAfter = await prisma.group.findFirst({ where: { siteId: site.id, slug: 'case-studies' } });
    check('merged-away group does NOT reappear', csAfter === null);
    check('re-ingest created no groups', third.groupsCreated === 0);

    const blogPages = await prisma.page.count({ where: { groupId: blog.id } });
    check('merged pages stayed in the target group', blogPages === 2, `blog has ${blogPages}`);

    // --- invariant 2: manual page move survives re-ingest ----------------
    console.log('\n  manually move a page, then re-ingest');
    const features = await prisma.group.findFirstOrThrow({ where: { siteId: site.id, slug: 'features' } });
    const moved = await prisma.page.findFirstOrThrow({ where: { siteId: site.id, path: '/about' } });
    await prisma.page.update({
      where: { id: moved.id },
      data: { groupId: features.id, isManuallyGrouped: true },
    });

    await ingestSitemap(prisma, site.id, opts);
    const after = await prisma.page.findUniqueOrThrow({ where: { id: moved.id } });
    check('manually grouped page was not moved back', after.groupId === features.id);

    // --- rename also leaves an alias -------------------------------------
    console.log('\n  rename a group, then re-ingest');
    await renameGroup(prisma, features.id, 'Product Features', 'product-features');
    await ingestSitemap(prisma, site.id, opts);
    const oldSlug = await prisma.group.findFirst({ where: { siteId: site.id, slug: 'features' } });
    check('renamed-away slug does NOT reappear', oldSlug === null);
    const renamed = await prisma.group.findUniqueOrThrow({ where: { id: features.id } });
    check('rename persisted and is marked manual', renamed.name === 'Product Features' && renamed.isManual);

    // --- deactivation, not deletion --------------------------------------
    console.log('\n  page disappears from the sitemap');
    const emptyFetch = (async () =>
      new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.example.com/</loc></url></urlset>')) as unknown as typeof fetch;
    const shrunk = await ingestSitemap(prisma, site.id, { crawl: { fetchImpl: emptyFetch } });
    check('missing pages deactivated', shrunk.deactivated === 5, `deactivated ${shrunk.deactivated}`);
    const stillThere = await prisma.page.count({ where: { siteId: site.id } });
    check('but NOT deleted — history preserved', stillThere === 6, `${stillThere} rows remain`);
  } finally {
    await prisma.page.deleteMany({ where: { siteId: site.id } });
    await prisma.groupAlias.deleteMany({ where: { group: { siteId: site.id } } });
    await prisma.group.deleteMany({ where: { siteId: site.id } });
    await prisma.site.delete({ where: { id: site.id } });
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\n  ALL INVARIANTS HOLD\n' : `\n  ${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
