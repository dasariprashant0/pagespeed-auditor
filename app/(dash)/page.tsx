import Link from 'next/link';
import { requireSession } from '@/lib/http/auth-guard';
import {
  demoAwareDefaultSite,
  demoAwareGetSiteSummary,
  demoAwareGetTopIssues,
  demoAwareListGroupsWithAggregates,
  demoAwareListPagesInGroup,
  demoAwareOnboardingState,
} from '@/lib/onboarding/demoTenant';
import { WaitingOnAdmin } from '@/components/onboarding/WaitingOnAdmin';
import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { StrategyTabs } from '@/components/ui/StrategyTabs';
import { ScoreTiles } from '@/components/score/ScoreTiles';
import { SectionGrid } from '@/components/nav/SectionGrid';
import { TopIssuesWidget } from '@/components/nav/TopIssuesWidget';
import { EmptyState } from '@/components/nav/EmptyState';
import { ScoreCharts, type ChartData } from '@/components/charts/ScoreCharts';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'mobile' ? 'mobile' : 'desktop';

  // Scoped to the caller's organisation. findFirst() with no filter would show
  // whichever site happens to be first in the table -- another tenant's.
  const ctx = await requireSession();
  const site = await demoAwareDefaultSite(ctx.organizationId);
  const setup = await demoAwareOnboardingState(ctx.organizationId);
  const canManage = can(ctx.role, 'site:manage');
  const canReorderGroups = can(ctx.role, 'groups:manage');

  if (!site) {
    return (
      <>
        <PageHeader
          title="Let's measure your site"
          subtitle="Point this at a sitemap and it will check every page on it — on mobile and desktop — and keep the results so you can see what improves and what slips."
        />
        <div className="max-w-2xl space-y-3">
          {canManage ? (
            // Setup steps live in the floating checklist (bottom-left, every
            // dash page) now -- it already shows this same list with ticks
            // for what's done, so this page doesn't need its own copy of it.
            <EmptyState
              title="Add your website to get started"
              body="Point it at a site and its sitemap under Settings — the checklist in the corner tracks the rest of setup from there."
              action={
                <Link href="/settings/site" className="rounded-[6px] bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-medium text-[var(--background)]">
                  Add your website
                </Link>
              }
            />
          ) : (
            <WaitingOnAdmin role={ctx.role} />
          )}
        </div>
      </>
    );
  }

  const [summary, groups, topIssues] = await Promise.all([
    demoAwareGetSiteSummary(ctx.organizationId, site.id, strategy),
    demoAwareListGroupsWithAggregates(ctx.organizationId, site.id, { strategy }),
    demoAwareGetTopIssues(ctx.organizationId, { siteId: site.id, strategy, limit: 8 }),
  ]);

  // Every measured page, with its section, so the charts can group, filter and
  // drill down without a second round trip. Sent columnar -- see ChartData.
  const charted = groups.filter((g) => g.auditedCount > 0);
  const chartData: ChartData = {
    sections: charted.map((g) => [g.name, g.slug] as [string, string]),
    pages: (
      await Promise.all(
        charted.map(async (g, gi) => {
          const pages = await demoAwareListPagesInGroup(ctx.organizationId, g.id, { strategy });
          return pages.map(
            (p) =>
              [p.id, p.path, gi, p.scores.performance, p.scores.accessibility, p.scores.bestPractices, p.scores.seo, p.lcp] as ChartData['pages'][number],
          );
        }),
      )
    ).flat(),
  };


  return (
    <>
      <PageHeader
        title={site.name}
        subtitle={
          <>
            {summary.activePageCount} pages across {summary.groupCount} sections ·{' '}
            {summary.auditedCount} measured
            {summary.lastSweepAt &&
              ` · last checked ${new Date(summary.lastSweepAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })}`}
          </>
        }
        actions={<StrategyTabs active={strategy} basePath="/" />}
      >
        {summary.auditedCount > 0 && (
          <div className="mt-5">
            <ScoreTiles
              scores={summary.siteAverage}
              size="md"
              caption={
                <>
                  Averaged across the {summary.auditedCount} pages measured so far, on{' '}
                  {strategy === 'mobile' ? 'mobile' : 'desktop'}. Open a section to see which
                  pages are pulling it down.
                </>
              }
            />
          </div>
        )}
      </PageHeader>

      {
        // An admin sees the same remaining-steps list in the floating
        // checklist already (bottom-left, every dash page), so this content
        // area doesn't repeat it. Setup steps an admin hasn't finished
        // aren't a non-admin's to act on, though -- showing them a checklist
        // full of "an admin needs to do this" is worse guidance than one
        // honest line, and only while there is nothing real to look at yet.
        // Once there is data, the dashboard below speaks for itself.
        !canManage && !setup.complete && summary.auditedCount === 0 && <WaitingOnAdmin role={ctx.role} />
      }

      {summary.auditedCount === 0 ? (
        <EmptyState
          title={`${summary.activePageCount} pages found, none measured yet`}
          body="Whole-site checks run on a schedule, because measuring every page takes about half an hour. To see real numbers now, open a section and measure that instead."
        />
      ) : (
        <>
          <section className="mb-7">
            <ScoreCharts data={chartData} strategy={strategy} />
          </section>

          <section className="mb-7">
            <h2 className="eyebrow mb-2">Affecting the most pages</h2>
            <TopIssuesWidget issues={topIssues} />
          </section>

          {/* One list, not a big grid plus a collapsed tail. Splitting them
              meant the visible order was not the order things ran in, which
              made dragging pointless.

              key={strategy}: useReorder seeds its own state from `groups`
              once on mount for optimistic dragging, so switching mobile/
              desktop otherwise left every tile showing the strategy that was
              active on first load -- forcing a remount is what makes it
              re-seed from the new aggregates. */}
          <SectionGrid key={strategy} groups={groups} canReorder={canReorderGroups} />
        </>
      )}
    </>
  );
}

