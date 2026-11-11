import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';
import { demoAwareDefaultSite, demoAwareGetIssuePages } from '@/lib/onboarding/demoTenant';
import { PageHeader } from '@/components/ui/PageHeader';
import { StrategyTabs } from '@/components/ui/StrategyTabs';
import { EmptyState } from '@/components/nav/EmptyState';
import { RunAuditButton } from '@/components/runs/RunAuditButton';
import { formatBytes } from '@/lib/report/format';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/** Every page one Top Issues row covers, biggest saving first. */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ auditId: string }>;
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { auditId } = await params;
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'mobile' ? 'mobile' : 'desktop';

  const ctx = await requireSession();
  const site = await demoAwareDefaultSite(ctx.organizationId);
  if (!site) notFound();

  const issue = await demoAwareGetIssuePages(ctx.organizationId, decodeURIComponent(auditId), { strategy, siteId: site.id });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Top issues' }]}
        title={issue?.title ?? auditId}
        subtitle={
          issue
            ? `${issue.pages.length} of ${issue.pagesTotal} measured pages${
                issue.snapshotAt ? ` · as of ${new Date(issue.snapshotAt).toLocaleDateString()}` : ''
              }`
            : undefined
        }
        actions={
          <>
            {issue && can(ctx.role, 'audits:run') && (
              <RunAuditButton
                kind="pages"
                target={issue.pages.map((p) => p.pageId).join(',')}
                label={`Measure these ${issue.pages.length}`}
                strategies={[strategy]}
                hint={`Re-measure every affected page on ${strategy}, to confirm a fix landed.`}
                demoMode={site.id === 'demo-site'}
              />
            )}
            <StrategyTabs active={strategy} basePath={`/issues/${encodeURIComponent(auditId)}`} />
          </>
        }
      />

      {!issue ? (
        <EmptyState
          title={`No pages have this issue on ${strategy}`}
          body="Either nothing in the latest sweep flagged it, or the site has not been swept yet. Try the other tab."
        />
      ) : (
        <div className="panel-flush overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <th scope="col" className="border-b border-[var(--border)] px-4 py-2 font-medium">Page</th>
                <th scope="col" className="border-b border-[var(--border)] px-4 py-2 font-medium">Finding</th>
                <th scope="col" className="border-b border-[var(--border)] px-4 py-2 text-right font-medium">Est. saving</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {issue.pages.map((p) => (
                <tr key={p.pageId} className="hover:bg-[var(--surface-subtle)]">
                  <td className="max-w-[24rem] truncate px-4 py-2">
                    <Link href={`/p/${p.pageId}?strategy=${strategy}`} className="underline-offset-2 hover:underline" title={p.url}>
                      {p.path}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-[var(--muted)]">{p.displayValue ?? '—'}</td>
                  <td className="tnum px-4 py-2 text-right">
                    {[
                      p.savingsMs ? (p.savingsMs < 1000 ? `${p.savingsMs} ms` : `${(p.savingsMs / 1000).toFixed(1)} s`) : null,
                      p.savingsBytes ? formatBytes(p.savingsBytes) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
