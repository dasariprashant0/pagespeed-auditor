import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';
import {
  demoAwareDefaultSite,
  demoAwareGetPageReport,
  demoAwareRegressionsForPage,
  demoAwareRequirePageAccess,
} from '@/lib/onboarding/demoTenant';
import { DownloadMarkdown } from '@/components/report/DownloadMarkdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { StrategyTabs } from '@/components/ui/StrategyTabs';
import { ScoreGauge } from '@/components/score/ScoreGauge';
import { CWVGrid } from '@/components/report/CWVGrid';
import { FieldDataPanel } from '@/components/report/FieldDataPanel';
import { AuditSection } from '@/components/report/AuditSection';
import { EmptyState } from '@/components/nav/EmptyState';
import { ScoreHistory } from '@/components/report/ScoreHistory';
import { RunAuditButton } from '@/components/runs/RunAuditButton';
import { RunConditions } from '@/components/report/RunConditions';
import { Screenshot } from '@/components/report/Screenshot';
import { RegressionBadge } from '@/components/report/RegressionBadge';
import { RecommendationPanel } from '@/components/report/RecommendationPanel';
import { explainRuntimeError, isPageContentFailure } from '@/lib/report/runtimeError';
import { aiEnabledForOrg } from '@/lib/services/org.service';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

const SCORE_KEYS = [
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'bestPractices', label: 'Best Practices' },
  { key: 'seo', label: 'SEO' },
] as const;

const OTHER_CATEGORIES = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
] as const;

export default async function PageReport({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { pageId } = await params;
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'mobile' ? 'mobile' : 'desktop';

  const ctx = await requireSession();
  const site = await demoAwareDefaultSite(ctx.organizationId);
  if (!site) notFound();
  const isDemo = site.id === 'demo-site';

  // Page ids appear in URLs. Without this check, pasting another tenant's id
  // would render their report.
  // Only the ownership check maps to "not found". Wrapping the report build in
  // the same catch turned every transient DB error into a bare 404 claiming the
  // page does not exist -- including for pages linked from our own table. A
  // real failure belongs in error.tsx, where it can be retried.
  const owned = await demoAwareRequirePageAccess(ctx.organizationId, pageId).then(
    () => true,
    () => false,
  );
  if (!owned) notFound();

  const report = await demoAwareGetPageReport(ctx.organizationId, pageId, strategy);

  const [regressions, aiOn] = await Promise.all([
    demoAwareRegressionsForPage(ctx.organizationId, pageId, strategy),
    // Hidden entirely, not disabled, until an admin adds an Anthropic key.
    isDemo ? Promise.resolve(false) : aiEnabledForOrg(ctx.organizationId),
  ]);

  const r = report.result;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Overview', href: '/' },
          ...(report.page.groupSlug
            ? [{ label: report.page.groupName ?? report.page.groupSlug, href: `/g/${report.page.groupSlug}` }]
            : []),
          { label: report.page.path },
        ]}
        title={report.page.path}
        subtitle={
          <a
            href={report.page.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-[3px] transition-colors hover:text-[var(--foreground)]"
          >
            {report.page.url}
            <span aria-hidden="true" className="text-[10px]">↗</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
        actions={
          <>
            {can(ctx.role, 'audits:run') && <RunAuditButton kind="page" target={pageId} label="Measure again" demoMode={isDemo} />}
            <DownloadMarkdown
              href={`/api/reports/${pageId}`}
              currentStrategy={strategy}
              hint="Markdown written for a coding agent: the actual failing resources, selectors and measured savings. Hand it to Cursor, Claude or Codex."
            />
            <StrategyTabs active={strategy} basePath={`/p/${pageId}`} />
          </>
        }
      />

      {regressions.length > 0 && (
        <section className="mb-5" aria-label="Regressions">
          <h2 className="eyebrow mb-2">
            Regressions
          </h2>
          <RegressionBadge regressions={regressions} />
        </section>
      )}

      {!r ? (
        <EmptyState
          title={`Not audited on ${strategy} yet`}
          body="Nothing has measured this page on this strategy. Try the other tab, or wait for the next scheduled sweep."
        />
      ) : r.status === 'error' ? (
        <EmptyState
          tone="warn"
          title={isPageContentFailure(r.runtimeError) ? 'Lighthouse could not measure this page' : 'This check could not run'}
          body={
            isPageContentFailure(r.runtimeError)
              ? `${explainRuntimeError(r.runtimeError)} This is a real finding about the page, not a failure of the audit.`
              : `${explainRuntimeError(r.runtimeError)} This is a setup problem, not something wrong with the page itself.`
          }
        />
      ) : (
        <>
          {/* PSI prints these above the report: a redirect means the numbers
              describe a different URL, and a run warning means they may be off. */}
          {(r.environment.redirectedTo || r.environment.warnings.length > 0) && (
            <div
              role="note"
              className="mb-4 space-y-1 rounded-[8px] border px-3.5 py-2.5 text-[12px]"
              style={{ borderColor: 'var(--score-average)', background: 'var(--score-average-tint)' }}
            >
              {r.environment.redirectedTo && (
                <p>
                  Redirected — these results are for <span className="break-all font-medium">{r.environment.redirectedTo}</span>.
                </p>
              )}
              {r.environment.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}

          <section aria-label="Scores" className="mb-6">
            <div className="panel grid grid-cols-2 items-start gap-x-4 gap-y-5 px-4 py-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:px-5">
              {SCORE_KEYS.map(({ key, label }) => (
                <ScoreGauge
                  key={key}
                  score={r.scores[key]}
                  label={label}
                  size="lg"
                  delta={delta(r.scores[key], r.previousScores?.[key])}
                />
              ))}
              {r.screenshot && <Screenshot src={r.screenshot} url={report.page.url} />}
              <div className="col-span-2 text-[11px] text-[var(--muted)] sm:ml-auto sm:self-end sm:text-right">
                <div>{new Date(r.fetchedAt).toLocaleString()}</div>
                {r.lighthouseVersion && <div className="text-[var(--faint)]">Lighthouse {r.lighthouseVersion}</div>}
              </div>
            </div>
          </section>

          {/* Field data first, matching PSI: real-user data is the one that matters. */}
          <section className="mb-6">
            <h2 className="eyebrow mb-2">
              Field data — real users, 28 days
            </h2>
            <FieldDataPanel field={r.field} />
          </section>

          <section className="mb-6">
            <h2 className="eyebrow mb-2">
              Lab metrics
            </h2>
            <CWVGrid lab={r.lab} strategy={strategy} />
          </section>

          <section className="mb-6">
            <h2 className="eyebrow mb-2">
              History
            </h2>
            <div className="grid gap-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2">
              {SCORE_KEYS.map(({ key, label }) => (
                <div key={key}>
                  <div className="mb-1 text-[11px] text-[var(--muted)]">{label}</div>
                  <ScoreHistory history={report.history[key]} label={label} />
                </div>
              ))}
            </div>
          </section>

          {aiOn && (
            <section className="mb-6">
              <RecommendationPanel
                pageId={pageId}
                strategy={strategy}
                initial={report.recommendation}
                canGenerate={can(ctx.role, 'recommendations:generate')}
                demoMode={isDemo}
              />
            </section>
          )}

          <div className="space-y-2">
            <AuditSection title="Opportunities" items={r.opportunities} defaultOpen
              emptyLabel="No opportunities found — nothing here would meaningfully improve load time." />
            <AuditSection title="Diagnostics" items={r.diagnostics} defaultOpen
              emptyLabel="No diagnostics flagged." />
            <AuditSection title="Informational insights" items={r.informative}
              emptyLabel="No informational insights for this run." />
            {/* One section per category, as PSI lays them out. */}
            {OTHER_CATEGORIES.map(({ id, label }) => (
              <AuditSection key={id} title={`${label} issues`} items={r.other.filter((a) => a.category === id)}
                emptyLabel={`No ${label.toLowerCase()} issues found.`} />
            ))}
            <AuditSection title="Additional items to manually check" items={r.manual}
              emptyLabel="Nothing needs a manual check." />
            <AuditSection title="Passed audits" items={r.passed}
              emptyLabel="Nothing passed — worth checking the page actually rendered." />
            <AuditSection title="Not applicable" items={r.notApplicable}
              emptyLabel="Every audit applied to this page." />
          </div>

          <div className="mt-4">
            <RunConditions env={r.environment} strategy={strategy} />
          </div>
        </>
      )}
    </>
  );
}

function delta(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  return current - previous;
}
