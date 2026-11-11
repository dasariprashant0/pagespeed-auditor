import { getTenantPrisma } from '../db/tenant.ts';
import type { IssueKind, PsiStrategy } from '../psi/types.ts';
import type { TopIssueDTO } from './types.ts';

/**
 * "Top issues across the site".
 *
 * This reads the AuditIssue side table, never rawJson. Grouping ~180 audit
 * objects out of a jsonb column on every dashboard load means detoasting
 * hundreds of MB and running jsonb_each per row, and no index helps -- GIN
 * accelerates containment, not grouped aggregation over dynamic keys. See
 * docs/DECISIONS.md 2.5. With the side table it is one range scan of
 * [auditRunId, strategy, auditId]. Target under 50 ms.
 */

export interface TopIssueOptions {
  strategy: PsiStrategy;
  limit?: number;
  /** Optional but worth passing: it puts the run lookup on the leading column
   *  of AuditRun's [siteId, type, status, finishedAt] index. */
  siteId?: string;
}

const DEFAULT_LIMIT = 10;

/**
 * AuditIssue.group carries Lighthouse's grouping, which changed vocabulary in
 * LH13 (`load-opportunities` became `insights`), and the extractor's own
 * IssueKind is stored in some writers. Accept every spelling rather than
 * betting on one -- an unknown group must degrade to 'other', not throw.
 */
export function issueKindFromGroup(group: string | null | undefined): IssueKind {
  switch (group) {
    case 'opportunity':
    case 'insights':
    case 'load-opportunities':
      return 'opportunity';
    case 'diagnostic':
    case 'diagnostics':
      return 'diagnostic';
    default:
      return 'other';
  }
}

export interface SnapshotRun {
  id: string;
  type: string;
  finishedAt: Date | null;
}

/**
 * The run the Top Issues list is computed over.
 *
 * A full sweep is the only run that saw every page, so it is the only run whose
 * "affected 312 of 747 pages" means anything. Scoping to one run also makes the
 * query a single index range scan and a consistent snapshot, instead of a
 * union of results from different days.
 *
 * Falls back to the newest completed run of any type so a site that has only
 * ever run group audits still shows something.
 */
export async function findSnapshotRun(organizationId: string, siteId?: string): Promise<SnapshotRun | null> {
  const prisma = await getTenantPrisma(organizationId);
  const scope = siteId ? { siteId } : {};
  // nulls: 'last' matters -- a completed run without finishedAt is a bug, and
  // Postgres sorts NULLs first on DESC, so it would win the ordering.
  const orderBy = { finishedAt: { sort: 'desc', nulls: 'last' } } as const;
  const select = { id: true, type: true, finishedAt: true } as const;

  const sweep = await prisma.auditRun.findFirst({
    where: { ...scope, type: 'full_sweep', status: 'completed' },
    orderBy,
    select,
  });
  if (sweep) return sweep;

  return prisma.auditRun.findFirst({
    where: { ...scope, status: 'completed' },
    orderBy,
    select,
  });
}

export async function getTopIssues(organizationId: string, opts: TopIssueOptions): Promise<TopIssueDTO[]> {
  const prisma = await getTenantPrisma(organizationId);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const run = await findSnapshotRun(organizationId, opts.siteId);
  if (!run) return [];

  const where = { auditRunId: run.id, strategy: opts.strategy };

  const [grouped, pagesTotal] = await Promise.all([
    prisma.auditIssue.groupBy({
      by: ['auditId'],
      where,
      // @@unique([auditResultId, auditId]) plus @@unique([auditRunId, pageId,
      // strategy]) together make "one row per page per audit" an invariant, so
      // a plain count IS the distinct page count. Prisma cannot express
      // COUNT(DISTINCT), and this is why it does not need to.
      _count: { auditId: true },
      _sum: { savingsMs: true },
      orderBy: [{ _count: { auditId: 'desc' } }, { _sum: { savingsMs: 'desc' } }],
      take: limit,
    }),
    // The denominator is pages that produced a measurement in this run, not
    // every page in the site: error rows never generate issues, so counting
    // them would understate every percentage.
    prisma.auditResult.count({ where: { ...where, status: 'ok' } }),
  ]);

  if (grouped.length === 0) return [];

  // Titles/categories are static per audit id, so one representative row each
  // is enough -- and grouping by them directly would split an audit into two
  // rows if Lighthouse ever varied the wording.
  const meta = await prisma.auditIssue.findMany({
    where: { ...where, auditId: { in: grouped.map((g) => g.auditId) } },
    distinct: ['auditId'],
    select: { auditId: true, title: true, category: true, group: true },
  });
  const metaById = new Map(meta.map((m) => [m.auditId, m]));

  return grouped.map((g) => {
    const m = metaById.get(g.auditId);
    return {
      auditId: g.auditId,
      title: m?.title ?? g.auditId,
      kind: issueKindFromGroup(m?.group),
      category: m?.category ?? 'performance',
      pagesAffected: g._count.auditId,
      pagesTotal,
      totalSavingsMs: g._sum.savingsMs === null ? null : Math.round(g._sum.savingsMs),
    } satisfies TopIssueDTO;
  });
}

export interface IssuePagesDTO {
  auditId: string;
  title: string;
  /** Pages measured in the snapshot run -- the denominator for "n of m". */
  pagesTotal: number;
  snapshotAt: string | null;
  pages: Array<{
    pageId: string;
    path: string;
    url: string;
    displayValue: string | null;
    savingsMs: number | null;
    savingsBytes: number | null;
  }>;
}

/**
 * The drill-down behind one Top Issues row: which pages have it, biggest
 * saving first. Same snapshot run as getTopIssues, so the count here always
 * matches the row that was clicked.
 */
export async function getIssuePages(
  organizationId: string,
  auditId: string,
  opts: { strategy: PsiStrategy; siteId?: string },
): Promise<IssuePagesDTO | null> {
  const prisma = await getTenantPrisma(organizationId);
  const run = await findSnapshotRun(organizationId, opts.siteId);
  if (!run) return null;

  const where = { auditRunId: run.id, strategy: opts.strategy };
  const [rows, pagesTotal] = await Promise.all([
    prisma.auditIssue.findMany({
      where: { ...where, auditId },
      orderBy: [{ savingsMs: { sort: 'desc', nulls: 'last' } }, { page: { path: 'asc' } }],
      select: {
        title: true,
        displayValue: true,
        savingsMs: true,
        savingsBytes: true,
        page: { select: { id: true, path: true, url: true } },
      },
    }),
    prisma.auditResult.count({ where: { ...where, status: 'ok' } }),
  ]);
  if (rows.length === 0) return null;

  return {
    auditId,
    title: rows[0].title,
    pagesTotal,
    snapshotAt: run.finishedAt?.toISOString() ?? null,
    pages: rows.map((r) => ({
      pageId: r.page.id,
      path: r.page.path,
      url: r.page.url,
      displayValue: r.displayValue,
      savingsMs: r.savingsMs === null ? null : Math.round(r.savingsMs),
      savingsBytes: r.savingsBytes,
    })),
  };
}
