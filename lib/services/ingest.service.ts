import type { TenantPrismaClient } from '../db/tenant.ts';
import { crawlSitemap, type CrawlOptions } from '../sitemap/fetch.ts';
import { normalizeAndDedupe, type RejectReason } from '../sitemap/normalize.ts';
import { deriveGroup } from '../sitemap/group.ts';

/**
 * Sitemap -> Page/Group rows.
 *
 * Two invariants this function exists to protect:
 *
 *  1. Manual overrides win permanently. A Group with isManual, and a Page with
 *     isManuallyGrouped, are never touched by re-ingestion. These are two
 *     SEPARATE flags on purpose: renaming a group should not pin every page
 *     inside it, and moving one page should pin only that page.
 *
 *  2. Pages are never deleted. A URL that leaves the sitemap is marked
 *     isActive=false so it drops out of sweeps while keeping its history --
 *     the audit history is the product.
 */

export interface IngestSummary {
  discovered: number;
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  regrouped: number;
  groupsCreated: number;
  duplicates: number;
  rejected: Record<RejectReason, number>;
  documentsFetched: number;
  truncated: boolean;
  errors: Array<{ url: string; message: string }>;
}

export interface IngestOptions {
  crawl?: CrawlOptions;
  /** Rows per transaction. One giant transaction holds locks far too long. */
  batchSize?: number;
  dryRun?: boolean;
}

export async function ingestSitemap(
  prisma: TenantPrismaClient,
  siteId: string,
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const batchSize = opts.batchSize ?? 200;

  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const crawl = await crawlSitemap(site.sitemapUrl, opts.crawl);
  const { urls, rejected, duplicates } = normalizeAndDedupe(crawl.entries, site.baseUrl);

  const summary: IngestSummary = {
    discovered: urls.length,
    created: 0,
    updated: 0,
    reactivated: 0,
    deactivated: 0,
    regrouped: 0,
    groupsCreated: 0,
    duplicates,
    rejected,
    documentsFetched: crawl.documentsFetched,
    truncated: crawl.truncated,
    errors: crawl.errors,
  };

  if (opts.dryRun) return summary;

  // --- resolve groups up front -------------------------------------------
  // An alias exists when a group was renamed or merged away. Honouring it is
  // what stops a merged-away slug from being recreated on the next ingest and
  // silently pulling its pages back out of the merged group.
  const neededSlugs = new Set(urls.map((u) => deriveGroup(u.path).slug));

  const aliases = await prisma.groupAlias.findMany({
    where: { slug: { in: [...neededSlugs] } },
    select: { slug: true, groupId: true },
  });
  const aliasBySlug = new Map(aliases.map((a) => [a.slug, a.groupId]));

  const existingGroups = await prisma.group.findMany({
    where: { siteId, slug: { in: [...neededSlugs] } },
    select: { id: true, slug: true },
  });
  const groupIdBySlug = new Map(existingGroups.map((g) => [g.slug, g.id]));

  for (const slug of neededSlugs) {
    if (aliasBySlug.has(slug) || groupIdBySlug.has(slug)) continue;
    const { name } = deriveGroup(`/${slug}`);
    const created = await prisma.group.create({
      data: { siteId, slug, name, isManual: false },
      select: { id: true, slug: true },
    });
    groupIdBySlug.set(created.slug, created.id);
    summary.groupsCreated++;
  }

  const resolveGroupId = (path: string): string => {
    const { slug } = deriveGroup(path);
    return aliasBySlug.get(slug) ?? groupIdBySlug.get(slug)!;
  };

  // --- upsert pages -------------------------------------------------------
  const seenUrls = new Set(urls.map((u) => u.url));

  // The sitemap's own order is the site owner's stated priority; capture it so
  // the UI can list by it rather than by page count.
  const orderByUrl = new Map(urls.map((u, i) => [u.url, i]));

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);

    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.page.findMany({
          where: { url: { in: batch.map((b) => b.url) } },
          select: { id: true, url: true, groupId: true, isActive: true, isManuallyGrouped: true },
        });
        const byUrl = new Map(existing.map((p) => [p.url, p]));

        for (const entry of batch) {
          const lastmod = entry.lastmod ? new Date(entry.lastmod) : null;
          const validLastmod = lastmod && !Number.isNaN(lastmod.getTime()) ? lastmod : null;
          const prev = byUrl.get(entry.url);

          if (!prev) {
            await tx.page.create({
              data: {
                siteId,
                url: entry.url,
                path: entry.path,
                groupId: resolveGroupId(entry.path),
                lastmod: validLastmod,
                sitemapIndex: orderByUrl.get(entry.url) ?? null,
                isActive: true,
              },
            });
            summary.created++;
            continue;
          }

          const data: Record<string, unknown> = {
            path: entry.path,
            lastmod: validLastmod,
            // Re-ingest refreshes the position: the sitemap may have reordered.
            sitemapIndex: orderByUrl.get(entry.url) ?? null,
            isActive: true,
          };

          // The page's assignment is user-owned -- leave groupId alone.
          if (!prev.isManuallyGrouped) {
            const target = resolveGroupId(entry.path);
            if (target !== prev.groupId) {
              data.groupId = target;
              summary.regrouped++;
            }
          }

          await tx.page.update({ where: { id: prev.id }, data });
          if (!prev.isActive) summary.reactivated++;
          else summary.updated++;
        }
      },
      { timeout: 30_000 },
    );
  }

  // --- deactivate anything the sitemap no longer lists ---------------------
  const active = await prisma.page.findMany({
    where: { siteId, isActive: true },
    select: { id: true, url: true },
  });
  const goneIds = active.filter((p) => !seenUrls.has(p.url)).map((p) => p.id);

  if (goneIds.length > 0) {
    // NOT a delete. History is preserved; the page simply stops being swept.
    await prisma.page.updateMany({ where: { id: { in: goneIds } }, data: { isActive: false } });
    summary.deactivated = goneIds.length;
  }

  return summary;
}
