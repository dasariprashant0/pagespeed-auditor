import Link from 'next/link';
import { requireSession } from '@/lib/http/auth-guard';
import { defaultSite } from '@/lib/services/tenant.service';
import { onboardingState } from '@/lib/services/onboarding.service';
import { SetupChecklist } from '@/components/onboarding/SetupChecklist';
import { can } from '@/lib/auth/roles';
import { listGroupsWithAggregates, splitSmallGroups } from '@/lib/services/results.service';
import { getTopIssues } from '@/lib/services/issues.service';
import { getSiteSummary } from '@/lib/services/site.service';
import { AppShell } from '@/components/shell/AppShell';
import { GroupCard } from '@/components/nav/GroupCard';
import { TopIssuesWidget } from '@/components/nav/TopIssuesWidget';
import { EmptyState } from '@/components/nav/EmptyState';
import { ScorePill } from '@/components/score/ScorePill';
import { ScoreSpectrum } from '@/components/score/ScoreSpectrum';
import { listPagesInGroup } from '@/lib/services/results.service';
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

  // Scoped to the caller's organisation. findFirst() with no filter would show
  // whichever site happens to be first in the table -- another tenant's.
  const ctx = await requireSession();
  const site = await defaultSite(ctx.organizationId);
  const setup = await onboardingState(ctx.organizationId);
  const canManage = can(ctx.role, 'site:manage');

  if (!site) {
    return (
      <AppShell siteName={ctx.organizationName} groups={[]} breadcrumb="Getting started">
        <header className="mb-6">
          <div className="eyebrow">Welcome</div>
          <h1 className="title-lg mt-1">Let&rsquo;s measure your site</h1>
          <p className="mt-1 max-w-lg text-[12px] text-[var(--muted)]">
            Point this at a sitemap and it will check every page on it — on phone and desktop —
            and keep the results so you can see what improves and what slips.
          </p>
        </header>
        <div className="max-w-2xl">
          <SetupChecklist state={setup} canManage={canManage} />
        </div>
      </AppShell>
    );
  }

  const [summary, groups, topIssues] = await Promise.all([
    getSiteSummary(site.id, strategy),
    listGroupsWithAggregates(site.id, { strategy }),
    getTopIssues({ siteId: site.id, strategy, limit: 8 }),
  ]);

  // Every page in one strip. This is the view the tool exists for -- PSI can
  // only ever show one page at a time.
  const spectrum = (
    await Promise.all(
      groups.filter((g) => g.auditedCount > 0).map((g) => listPagesInGroup(g.id, { strategy })),
    )
  )
    .flat()
    .map((p) => ({ id: p.id, path: p.path, score: p.scores.performance }));

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
      <header className="mb-6">
        <div className="eyebrow">Overview</div>
        <h1 className="title-lg mt-1">{site.name}</h1>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          {summary.activePageCount} pages across {summary.groupCount} sections ·{' '}
          {summary.auditedCount} measured
          {summary.lastSweepAt && ` · last check ${new Date(summary.lastSweepAt).toLocaleDateString()}`}
        </p>

        {summary.auditedCount > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-[repeat(4,minmax(0,auto))_1fr] sm:items-end">
            {SCORE_COLUMNS.map(({ key, short, full }) => {
              const v = summary.siteAverage[key];
              const band = v === null ? null : v < 50 ? 'fail' : v < 90 ? 'average' : 'pass';
              return (
                <div key={key} title={full}>
                  <div
                    className="metric text-[34px]"
                    style={{
                      color: band
                        ? `var(--score-${band}-text)`
                        : 'var(--faint)',
                    }}
                  >
                    {v ?? '—'}
                  </div>
                  <div className="eyebrow mt-1">{short}</div>
                </div>
              );
            })}
          </div>
        )}
      </header>

      <SetupChecklist state={setup} canManage={canManage} />

      {summary.auditedCount === 0 ? (
        <EmptyState
          title={`${summary.activePageCount} pages found, none measured yet`}
          body="Whole-site checks run on a schedule, because measuring every page takes about half an hour. To see real numbers now, open a section and measure that instead."
        />
      ) : (
        <>
          <section className="mb-7">
            <h2 className="eyebrow mb-2">Every page, worst to best</h2>
            <ScoreSpectrum pages={spectrum} />
          </section>

          <section className="mb-7">
            <h2 className="eyebrow mb-2">Affecting the most pages</h2>
            <TopIssuesWidget issues={topIssues} />
          </section>

          <section>
            <h2 className="eyebrow mb-2">Sections</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {primary.map((g) => (
                <GroupCard key={g.id} group={g} />
              ))}
            </div>

            {small.length > 0 && (
              <details className="panel mt-3">
                <summary className="cursor-pointer list-none px-4 py-3 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                  {small.length} smaller sections — fewer than 3 pages each
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
