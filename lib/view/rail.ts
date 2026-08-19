import type { GroupSummaryDTO } from '../services/types.ts';

/**
 * The sidebar's shape, derived once.
 *
 * Seven screens were each building this inline and had already drifted apart;
 * one of them sorted the list again and silently undid the saved order.
 */
export function toRailGroups(groups: GroupSummaryDTO[]) {
  return groups
    .filter((g) => g.pageCount > 0)
    // Order comes from the service (manual priority, then sitemap position).
    // Re-sorting here is what broke it before.
    .map((g) => ({
      slug: g.slug,
      name: g.name,
      pageCount: g.pageCount,
      score: g.aggregate.performance,
    }));
}
