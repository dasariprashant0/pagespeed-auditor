import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';
import { demoAwareDefaultSite, demoAwareListPagesInGroup, demoAwareRequireGroupAccess } from '@/lib/onboarding/demoTenant';
import { PageHeader } from '@/components/ui/PageHeader';
import { StrategyTabs } from '@/components/ui/StrategyTabs';
import { DownloadMarkdown } from '@/components/report/DownloadMarkdown';
import { PageTable, type PageRow } from '@/components/nav/PageTable';
import { EmptyState } from '@/components/nav/EmptyState';
import { RunAuditButton } from '@/components/runs/RunAuditButton';
import { ScoreCharts, type ChartData } from '@/components/charts/ScoreCharts';
import { formatDuration } from '@/lib/services/estimate.service';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { slug } = await params;
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'mobile' ? 'mobile' : 'desktop';

  const ctx = await requireSession();
  const site = await demoAwareDefaultSite(ctx.organizationId);
  if (!site) notFound();
  const isDemo = site.id === 'demo-site';

  // Slugs appear in URLs, so ownership is checked rather than assumed.
  const group = await demoAwareRequireGroupAccess(ctx.organizationId, slug).catch(() => null);
  if (!group) notFound();

  const pages = await demoAwareListPagesInGroup(ctx.organizationId, group.id, { strategy });

  // A section with exactly one page has nothing a group view adds over the
  // page report itself -- skip straight there rather than making every
  // single-page section a click that only re-shows the one row you'd click
  // next anyway.
  if (pages.length === 1) {
    redirect(`/p/${pages[0].id}${raw ? `?strategy=${raw}` : ''}`);
  }

  // Tuples, not objects: on a 324-page section the repeated field names were
  // most of a 4.3 MB payload. The table expands them on the client.
  const rows: PageRow[] = pages.map((p) => [
    p.id,
    p.path,
    p.url,
    p.scores.performance,
    p.scores.accessibility,
    p.scores.bestPractices,
    p.scores.seo,
    p.lcp,
    p.cls,
    p.hasError ? 1 : 0,
  ]);

  const measured = pages
    .map((p) => p.scores.performance)
    .filter((s): s is number => s !== null);
  const average = measured.length
    ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length)
    : null;

  // Both strategies, at the sustained PSI rate.
  const rerunSeconds = Math.ceil((pages.length * 2) / 0.75);

  // One "section" (this group itself), so the shared chart panel's section
  // filter/breakdown stays out of the way -- built from `pages`, already
  // fetched above, not a second query.
  const chartData: ChartData = {
    sections: [[group.name, group.slug]],
    pages: pages.map(
      (p) =>
        [p.id, p.path, 0, p.scores.performance, p.scores.accessibility, p.scores.bestPractices, p.scores.seo, p.lcp] as ChartData['pages'][number],
    ),
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: group.name }]}
        title={group.name}
        subtitle={
          <>
            {pages.length} {pages.length === 1 ? 'page' : 'pages'}
            {measured.length < pages.length && ` · ${measured.length} measured`}
            {average !== null && ` · ${average} average`}
          </>
        }
        actions={
          <>
            {can(ctx.role, 'audits:run') && (
              <RunAuditButton
                kind="group"
                target={slug}
                label={`Measure all ${pages.length}`}
                hint={`Both mobile and desktop — about ${formatDuration(rerunSeconds)}.`}
                demoMode={isDemo}
              />
            )}
            <DownloadMarkdown
              href={`/api/reports/bulk?group=${slug}`}
              currentStrategy={strategy}
              hint="Every measured page in this section as one markdown file, for handing to a coding agent."
            />
            <StrategyTabs active={strategy} basePath={`/g/${slug}`} />
          </>
        }
      />

      {measured.length > 3 && (
        // The section's own distribution, interactive: hover a bar for the
        // page it is, click to open its report. On a 324-page section the
        // average above says almost nothing; the shape says where the work is.
        <section className="mb-7">
          <ScoreCharts
            data={chartData}
            strategy={strategy}
            charts={['spectrum', 'histogram', 'scatter']}
            storageKey="psa.group.chart"
          />
        </section>
      )}

      {pages.length === 0 ? (
        <EmptyState
          title="Nothing here to measure"
          body="Every page in this section has been dropped from the sitemap or moved elsewhere. Its history is kept — nothing was deleted."
        />
      ) : (
        <PageTable rows={rows} strategy={strategy} canSelect={can(ctx.role, 'audits:run')} demoMode={isDemo} />
      )}
    </>
  );
}
