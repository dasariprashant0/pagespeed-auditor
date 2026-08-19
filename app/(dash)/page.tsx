import Link from 'next/link';
import { prisma } from '@/lib/db';
import { listGroupsWithAggregates, splitSmallGroups } from '@/lib/services/results.service';
import { getTopIssues } from '@/lib/services/issues.service';
import { getSiteSummary } from '@/lib/services/site.service';
import { AppShell } from '@/components/shell/AppShell';
import { GroupCard } from '@/components/nav/GroupCard';
import { TopIssuesWidget } from '@/components/nav/TopIssuesWidget';
import { EmptyState } from '@/components/nav/EmptyState';
import { ScorePill } from '@/components/score/ScorePill';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

const SCORE_COLUMNS = [
  { key: 'performance', short: 'Perf', full: 'Performance' },
  { key: 'accessibility', short: 'A11y', full: 'Accessibility' },
  { key: 'bestPractices', short: 'BP', full: 'Best Practices' },
  { key: 'seo', short: 'SEO', full: 'SEO' },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'desktop' ? 'desktop' : 'mobile';

  const site = await prisma.site.findFirst({ select: { id: true, name: true } });
  if (!site) {
    return (
      <AppShell siteName="PageSpeed Auditor" groups={[]}>
        <EmptyState
          title="No site configured yet"
          body="Set SITE_SITEMAP_URL and SITE_BASE_URL in .env, then run `npm run db:seed` followed by `npm run ingest`."
        />
      </AppShell>
    );
  }

  const [summary, groups, topIssues] = await Promise.all([
    getSiteSummary(site.id, strategy),
    listGroupsWithAggregates(site.id, { strategy }),
    getTopIssues({ siteId: site.id, strategy, limit: 8 }),
  ]);

  // 42 of this site's 68 groups hold a single page. Rendering 68 cards is not a
  // usable home screen, so the tail collapses. The data model is untouched --
  // see docs/DECISIONS.md 5.1.
  const { primary, small } = splitSmallGroups(groups);
  const rail = groups
    // Already in sitemap order from the service; re-sorting here would undo it.
    .filter((g) => g.pageCount > 0)
    .map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

  return (
    <AppShell
      siteName={site.name}
      groups={rail}
      breadcrumb="Overview"
      actions={<StrategyLinks active={strategy} basePath="/" />}
    >
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {site.name}
          </h1>
          <p className="mt-0.5 text-[12px] text-[var(--muted)]">
            {summary.activePageCount} pages · {summary.groupCount} groups ·{' '}
            {summary.auditedCount} audited
            {summary.lastSweepAt && ` · last sweep ${new Date(summary.lastSweepAt).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {SCORE_COLUMNS.map(({ key, short, full }) => (
            <div key={key} className="text-center">
              <ScorePill score={summary.siteAverage[key]} title={full} />
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">{short}</div>
            </div>
          ))}
        </div>
      </div>

      {summary.auditedCount === 0 ? (
        <EmptyState
          title={`${summary.activePageCount} pages ingested, none audited yet`}
          body="Full sweeps run on a schedule rather than on demand — 1,494 PSI calls take roughly half an hour. Audit a single group to see results now, or wait for the first scheduled sweep."
        />
      ) : (
        <>
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Top issues across the site
            </h2>
            <TopIssuesWidget issues={topIssues} />
          </section>

          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Groups
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {primary.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </div>

            {small.length > 0 && (
              <details className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
                <summary className="cursor-pointer list-none px-3.5 py-2.5 text-[12px] text-[var(--muted)]">
                  Small groups ({small.length}) — fewer than 3 pages each
                </summary>
                <div className="grid gap-1 border-t border-[var(--border)] p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {small.map((g) => (
                    <Link
                      key={g.id}
                      href={`/g/${g.slug}`}
                      className="flex items-center justify-between rounded-[5px] px-2 py-1.5 text-[12px] hover:bg-[var(--surface-subtle)]"
                    >
                      <span className="truncate">{g.name}</span>
                      <span className="ml-2 flex shrink-0 items-center gap-1.5">
                        <span className="tnum text-[11px] text-[var(--muted)]">{g.pageCount}</span>
                        <ScorePill score={g.aggregate.performance} />
                      </span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

/** Links, not buttons: the strategy stays shareable and server-rendered. */
function StrategyLinks({ active, basePath }: { active: PsiStrategy; basePath: string }) {
  return (
    <div role="tablist" aria-label="Report strategy" className="flex rounded-[5px] border border-[var(--border)] p-0.5">
      {(['mobile', 'desktop'] as const).map((s) => (
        <Link
          key={s}
          role="tab"
          aria-selected={s === active}
          href={`${basePath}?strategy=${s}`}
          className={`rounded-[3px] px-2.5 py-1 text-[12px] capitalize ${
            s === active ? 'bg-[var(--surface-sunken)] font-medium' : 'text-[var(--muted)]'
          }`}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}
