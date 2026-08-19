import { prisma } from '../db.ts';
import { scoreBand } from '../psi/buckets.ts';
import type { PsiStrategy } from '../psi/types.ts';
import {
  SMALL_GROUP_THRESHOLD,
  type FourScores,
  type GroupSummaryDTO,
  type PageListItemDTO,
  type ScoreDistribution,
  type SparkPoint,
} from './types.ts';

/**
 * Read side: group cards, page lists, score history.
 *
 * Two performance rules shape every query in this file.
 *
 *  1. "Latest result per page" comes from Page.latestResultMobileId /
 *     latestResultDesktopId. Those denormalized pointers exist precisely so a
 *     747-page list is two plain queries instead of 747 correlated subqueries.
 *
 *  2. rawJson is never selected here. It is a large pruned blob and every list
 *     path would detoast it. Only the single-row report path (report.service)
 *     reads it, deliberately.
 *
 * And one correctness rule: AuditResult holds error rows (status 'error',
 * null scores) so a failed job still lets its run finalize. Every aggregate
 * below drops them -- the pure helpers do that themselves rather than trusting
 * each caller to remember.
 */

// ---------------------------------------------------------------------------
// Pure helpers. Exported because they carry the arithmetic that the dashboard's
// correctness rests on, and DB fixtures are a terrible way to test arithmetic.
// ---------------------------------------------------------------------------

/** The minimum shape the aggregates need. Matches the list selects below. */
export interface ScoreRow {
  status: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
}

export function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Arithmetic mean per category over the pages that actually measured.
 *
 * Mean, not worst-page: see docs/DECISIONS.md 2.6. Worst-page pegs nearly every
 * group to red and never moves when work lands, so it cannot show progress. The
 * hiding objection is answered by worstPerformance() and computeDistribution()
 * travelling alongside it on the same card, not by changing the aggregate.
 *
 * Filters status 'ok' itself: an error row's null scores would not change a
 * mean, but its presence in a count would, and callers forget.
 */
export function computeAggregate(rows: ScoreRow[]): FourScores {
  const ok = rows.filter((r) => r.status === 'ok');
  return {
    performance: mean(ok.map((r) => r.performanceScore)),
    accessibility: mean(ok.map((r) => r.accessibilityScore)),
    bestPractices: mean(ok.map((r) => r.bestPracticesScore)),
    seo: mean(ok.map((r) => r.seoScore)),
  };
}

/**
 * Pass / average / fail counts by PSI's own score bands, with everything else
 * landing in `unaudited`.
 *
 * "Everything else" is deliberately broad: pages never audited, pages whose
 * latest result is an error row, and OK results where the performance category
 * itself failed to run. Lumping them keeps `pass + average + fail + unaudited
 * === pageCount` a real invariant, which is what makes the distribution bar
 * safe to render as fixed-width segments.
 */
export function computeDistribution(rows: ScoreRow[], pageCount: number): ScoreDistribution {
  const d: ScoreDistribution = { pass: 0, average: 0, fail: 0, unaudited: 0 };

  for (const r of rows) {
    if (r.status !== 'ok') continue;
    const band = scoreBand(r.performanceScore);
    if (band) d[band]++;
  }

  d.unaudited = Math.max(0, pageCount - (d.pass + d.average + d.fail));
  return d;
}

/** The single worst measured page, which is what stops the mean from hiding one. */
export function worstPerformance(
  rows: Array<ScoreRow & { pageId: string }>,
): { score: number | null; pageId: string | null } {
  let score: number | null = null;
  let pageId: string | null = null;

  for (const r of rows) {
    if (r.status !== 'ok' || r.performanceScore === null) continue;
    if (score === null || r.performanceScore < score) {
      score = r.performanceScore;
      pageId = r.pageId;
    }
  }
  return { score, pageId };
}

/**
 * Splits group cards into the ones worth their own card and the tail that gets
 * collapsed behind one "Small groups (n)" card.
 *
 * Presentation only -- see docs/DECISIONS.md 5.1. The real site produces 68
 * groups from 747 pages, 42 of them holding exactly one page, and 68 cards is
 * not a home screen. The data model is untouched so this stays reversible.
 */
export function splitSmallGroups<T extends { pageCount: number }>(
  groups: T[],
  threshold: number = SMALL_GROUP_THRESHOLD,
): { primary: T[]; small: T[] } {
  const primary: T[] = [];
  const small: T[] = [];
  for (const g of groups) (g.pageCount >= threshold ? primary : small).push(g);
  return { primary, small };
}

/** Which denormalized pointer this strategy reads. */
export function latestResultIdFor(
  page: { latestResultMobileId: string | null; latestResultDesktopId: string | null },
  strategy: PsiStrategy,
): string | null {
  return strategy === 'mobile' ? page.latestResultMobileId : page.latestResultDesktopId;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface StrategyOptions {
  strategy: PsiStrategy;
}

/** Scores only. Narrower than AUDIT_RESULT_SUMMARY_SELECT: group cards need no metrics. */
const GROUP_SCORE_SELECT = {
  pageId: true,
  status: true,
  performanceScore: true,
  accessibilityScore: true,
  bestPracticesScore: true,
  seoScore: true,
  createdAt: true,
} as const;

/** Scores plus the three CWV columns a page table shows. Still no rawJson. */
const PAGE_ROW_SELECT = {
  pageId: true,
  status: true,
  performanceScore: true,
  accessibilityScore: true,
  bestPracticesScore: true,
  seoScore: true,
  lcp: true,
  inp: true,
  cls: true,
  fieldInp: true,
  createdAt: true,
} as const;

/**
 * Every group of a site with its aggregate, its worst page, and its
 * distribution, for one strategy.
 *
 * Three queries regardless of page count: groups, active pages (pointer columns
 * only), then the pointed-at results in one `IN`. Ordered by page count
 * descending because that is the order the home screen collapses from.
 */
export async function listGroupsWithAggregates(
  siteId: string,
  opts: StrategyOptions,
): Promise<GroupSummaryDTO[]> {
  const [groups, pages] = await Promise.all([
    prisma.group.findMany({
      where: { siteId },
      select: { id: true, slug: true, name: true, isManual: true, priority: true },
    }),
    // Inactive pages are excluded everywhere in this file: they have left the
    // sitemap, will never be swept again, and counting them would inflate
    // `unaudited` permanently. Their history stays reachable by page id.
    prisma.page.findMany({
      where: { siteId, isActive: true, groupId: { not: null } },
      select: {
        id: true,
        groupId: true,
        sitemapIndex: true,
        latestResultMobileId: true,
        latestResultDesktopId: true,
      },
    }),
  ]);

  const resultIds = pages
    .map((p) => latestResultIdFor(p, opts.strategy))
    .filter((id): id is string => id !== null);

  const results = resultIds.length
    ? await prisma.auditResult.findMany({
        where: { id: { in: resultIds } },
        select: GROUP_SCORE_SELECT,
      })
    : [];

  const resultByPage = new Map(results.map((r) => [r.pageId, r]));

  // Bucketed rather than filtered per group: 68 groups x 747 pages is a
  // pointless quadratic on the hottest screen in the app.
  const pagesByGroup = new Map<string, typeof pages>();
  for (const p of pages) {
    const bucket = pagesByGroup.get(p.groupId!);
    if (bucket) bucket.push(p);
    else pagesByGroup.set(p.groupId!, [p]);
  }

  const summaries = groups.map((g) => {
    const groupPages = pagesByGroup.get(g.id) ?? [];
    const rows = groupPages
      .map((p) => resultByPage.get(p.id))
      .filter((r): r is (typeof results)[number] => r !== undefined);

    const worst = worstPerformance(rows);
    // Any row, including an error one: a failed attempt is still an attempt,
    // and "last audited" answering "when did we last try" is the useful reading.
    const lastAt = rows.reduce<Date | null>(
      (acc, r) => (acc === null || r.createdAt > acc ? r.createdAt : acc),
      null,
    );

    // A group's position is that of its earliest page in the sitemap.
    const sitemapIndex = groupPages.reduce<number | null>(
      (acc, p) => (p.sitemapIndex === null ? acc : acc === null ? p.sitemapIndex : Math.min(acc, p.sitemapIndex)),
      null,
    );

    return {
      id: g.id,
      sitemapIndex,
      priority: g.priority,
      slug: g.slug,
      name: g.name,
      isManual: g.isManual,
      pageCount: groupPages.length,
      auditedCount: rows.filter((r) => r.status === 'ok').length,
      aggregate: computeAggregate(rows),
      worstPerformance: worst.score,
      worstPageId: worst.pageId,
      distribution: computeDistribution(rows, groupPages.length),
      lastAuditedAt: lastAt ? lastAt.toISOString() : null,
    } satisfies GroupSummaryDTO;
  });

  // Sitemap order, not page count. The sitemap is the site owner's stated
  // priority; page count is an artefact of how URLs happen to be structured,
  // so ranking by it buries a small but important group under a large
  // incidental one. Groups with no position (nothing ingested yet) sort last.
  summaries.sort((a, b) => {
    // An explicit priority always outranks sitemap position.
    if (a.priority !== null || b.priority !== null) {
      if (a.priority === null) return 1;
      if (b.priority === null) return -1;
      if (a.priority !== b.priority) return a.priority - b.priority;
    }
    if (a.sitemapIndex === null && b.sitemapIndex === null) return a.name.localeCompare(b.name);
    if (a.sitemapIndex === null) return 1;
    if (b.sitemapIndex === null) return -1;
    return a.sitemapIndex - b.sitemapIndex;
  });
  return summaries;
}

/**
 * The pages of one group with their latest scores for a strategy.
 *
 * Two queries at any group size -- `blog` alone holds 324 pages.
 */
export async function listPagesInGroup(
  groupId: string,
  opts: StrategyOptions,
): Promise<PageListItemDTO[]> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { slug: true, name: true },
  });

  const pages = await prisma.page.findMany({
    where: { groupId, isActive: true },
    select: {
      id: true,
      url: true,
      path: true,
      title: true,
      isActive: true,
      latestResultMobileId: true,
      latestResultDesktopId: true,
    },
    // The sitemap's order is the site owner's stated priority. `path` is only a
    // tie-break for rows ingested before sitemapIndex existed.
    orderBy: [{ sitemapIndex: 'asc' }, { path: 'asc' }],
  });

  const resultIds = pages
    .map((p) => latestResultIdFor(p, opts.strategy))
    .filter((id): id is string => id !== null);

  const results = resultIds.length
    ? await prisma.auditResult.findMany({
        where: { id: { in: resultIds } },
        select: PAGE_ROW_SELECT,
      })
    : [];

  const resultByPage = new Map(results.map((r) => [r.pageId, r]));

  return pages.map((p) => {
    const r = resultByPage.get(p.id);
    const ok = r?.status === 'ok';

    return {
      id: p.id,
      url: p.url,
      path: p.path,
      title: p.title,
      groupSlug: group?.slug ?? null,
      groupName: group?.name ?? null,
      isActive: p.isActive,
      scores: {
        performance: ok ? r.performanceScore : null,
        accessibility: ok ? r.accessibilityScore : null,
        bestPractices: ok ? r.bestPracticesScore : null,
        seo: ok ? r.seoScore : null,
      },
      lcp: ok ? r.lcp : null,
      cls: ok ? r.cls : null,
      // INP has no lab equivalent -- Lighthouse never emits it, so the lab
      // column is null on every real row. The field value is the only INP that
      // exists, so the list falls back to it; label the column as field data in
      // the UI. TBT is NOT substituted here: it would be read against INP
      // thresholds and poison every comparison.
      inp: ok ? (r.inp ?? r.fieldInp) : null,
      hasError: r?.status === 'error',
      // Strategy-specific, unlike Page.lastAuditedAt which covers both.
      lastAuditedAt: r ? r.createdAt.toISOString() : null,
    } satisfies PageListItemDTO;
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const DEFAULT_HISTORY_LIMIT = 30;

export type HistoryScope = { pageId: string; groupId?: undefined } | { groupId: string; pageId?: undefined };

export interface HistoryOptions {
  strategy: PsiStrategy;
  limit?: number;
}

export type HistorySeries = Record<'performance' | 'accessibility' | 'bestPractices' | 'seo', SparkPoint[]>;

/**
 * All four score series for one page, oldest first, from a single query.
 *
 * The report view needs four sparklines; pulling them separately would be four
 * scans of the same index range ([pageId, strategy, createdAt]).
 */
export async function getPageScoreHistory(
  pageId: string,
  strategy: PsiStrategy,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<HistorySeries> {
  const rows = await prisma.auditResult.findMany({
    // Error rows carry null scores. Plotting them would draw a gap that reads
    // as "the site got worse" rather than "the audit failed".
    where: { pageId, strategy, status: 'ok' },
    select: {
      createdAt: true,
      performanceScore: true,
      accessibilityScore: true,
      bestPracticesScore: true,
      seoScore: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  rows.reverse();
  const at = (v: number | null, t: Date): SparkPoint => ({ t: t.toISOString(), v });

  return {
    performance: rows.map((r) => at(r.performanceScore, r.createdAt)),
    accessibility: rows.map((r) => at(r.accessibilityScore, r.createdAt)),
    bestPractices: rows.map((r) => at(r.bestPracticesScore, r.createdAt)),
    seo: rows.map((r) => at(r.seoScore, r.createdAt)),
  };
}

/**
 * Performance sparkline for a page or a whole group, oldest first.
 *
 * The group series is one point per audit run -- the mean of that run's OK
 * results across the group's pages -- so it lines up with the mean shown on the
 * group card rather than being a different statistic on the same screen.
 */
export async function getScoreHistory(
  scope: HistoryScope,
  opts: HistoryOptions,
): Promise<SparkPoint[]> {
  const limit = opts.limit ?? DEFAULT_HISTORY_LIMIT;

  if (scope.pageId) {
    const series = await getPageScoreHistory(scope.pageId, opts.strategy, limit);
    return series.performance;
  }

  const pages = await prisma.page.findMany({
    where: { groupId: scope.groupId, isActive: true },
    select: { id: true },
  });
  if (pages.length === 0) return [];

  const grouped = await prisma.auditResult.groupBy({
    by: ['auditRunId'],
    where: { strategy: opts.strategy, status: 'ok', pageId: { in: pages.map((p) => p.id) } },
    _avg: { performanceScore: true },
    _max: { createdAt: true },
  });

  // Sorted and sliced in JS rather than with orderBy/take on the groupBy: the
  // number of runs is bounded by retention (tens), and this keeps the query one
  // aggregate with no ordering over a computed column.
  return grouped
    .filter((g) => g._max.createdAt !== null)
    .sort((a, b) => b._max.createdAt!.getTime() - a._max.createdAt!.getTime())
    .slice(0, limit)
    .reverse()
    .map((g) => ({
      t: g._max.createdAt!.toISOString(),
      v: g._avg.performanceScore === null ? null : Math.round(g._avg.performanceScore),
    }));
}

// ---------------------------------------------------------------------------
// Run-by-run history
// ---------------------------------------------------------------------------

export interface PageRunHistoryEntry {
  resultId: string;
  runId: string;
  runType: string;
  triggeredBy: string;
  strategy: string;
  at: string;
  status: 'ok' | 'error';
  runtimeError: string | null;
  scores: FourScores;
  /** Change against the run before it, so a regression is visible in the list. */
  performanceDelta: number | null;
  lcp: number | null;
  cls: number | null;
  hasRecommendation: boolean;
}

/**
 * Every retained run for one page, newest first.
 *
 * This is the "we checked weekly, what changed over the month" view. Deltas are
 * computed against the previous SUCCESSFUL run rather than the previous row --
 * comparing against an error row's nulls would show a phantom collapse and then
 * a phantom recovery.
 */
export async function getPageRunHistory(
  pageId: string,
  strategy: PsiStrategy,
  limit = 20,
): Promise<PageRunHistoryEntry[]> {
  const rows = await prisma.auditResult.findMany({
    where: { pageId, strategy },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      status: true,
      runtimeError: true,
      performanceScore: true,
      accessibilityScore: true,
      bestPracticesScore: true,
      seoScore: true,
      lcp: true,
      cls: true,
      auditRun: { select: { id: true, type: true, triggeredBy: true } },
      recommendation: { select: { id: true, status: true } },
    },
  });

  // Walk oldest-first so each entry can see the last good score before it.
  const ascending = [...rows].reverse();
  const deltas = new Map<string, number | null>();
  let lastGood: number | null = null;
  for (const r of ascending) {
    const score = r.status === 'ok' ? r.performanceScore : null;
    deltas.set(r.id, score !== null && lastGood !== null ? score - lastGood : null);
    if (score !== null) lastGood = score;
  }

  return rows.map((r) => ({
    resultId: r.id,
    runId: r.auditRun.id,
    runType: r.auditRun.type,
    triggeredBy: r.auditRun.triggeredBy,
    strategy,
    at: r.createdAt.toISOString(),
    status: r.status === 'error' ? 'error' : 'ok',
    runtimeError: r.runtimeError,
    scores: {
      performance: r.performanceScore,
      accessibility: r.accessibilityScore,
      bestPractices: r.bestPracticesScore,
      seo: r.seoScore,
    },
    performanceDelta: deltas.get(r.id) ?? null,
    lcp: r.lcp,
    cls: r.cls,
    hasRecommendation: r.recommendation?.status === 'complete',
  }));
}
