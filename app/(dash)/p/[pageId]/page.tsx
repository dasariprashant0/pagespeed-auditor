import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getPageReport } from '@/lib/services/report.service';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { AppShell } from '@/components/shell/AppShell';
import { ScoreGauge } from '@/components/score/ScoreGauge';
import { CWVGrid } from '@/components/report/CWVGrid';
import { FieldDataPanel } from '@/components/report/FieldDataPanel';
import { AuditSection } from '@/components/report/AuditSection';
import { EmptyState } from '@/components/nav/EmptyState';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

export default async function PageReport({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ strategy?: string }>;
}) {
  const { pageId } = await params;
  const { strategy: raw } = await searchParams;
  const strategy: PsiStrategy = raw === 'desktop' ? 'desktop' : 'mobile';

  const site = await prisma.site.findFirstOrThrow({ select: { id: true, name: true } });

  let report;
  try {
    report = await getPageReport(pageId, strategy);
  } catch {
    notFound();
  }

  const allGroups = await listGroupsWithAggregates(site.id, { strategy });
  const rail = allGroups
    .filter((g) => g.pageCount > 0)
    .sort((a, b) => b.pageCount - a.pageCount)
    .map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

  const r = report.result;

  return (
    <AppShell
      siteName={site.name}
      groups={rail}
      activeSlug={report.page.groupSlug ?? undefined}
      breadcrumb={
        <>
          <Link href="/" className="hover:text-[var(--foreground)]">Overview</Link>
          <span className="mx-1.5">/</span>
          {report.page.groupSlug && (
            <>
              <Link href={`/g/${report.page.groupSlug}`} className="hover:text-[var(--foreground)]">
                {report.page.groupName}
              </Link>
              <span className="mx-1.5">/</span>
            </>
          )}
          <span className="truncate text-[var(--foreground)]">{report.page.path}</span>
        </>
      }
      actions={
        <div role="tablist" aria-label="Report strategy" className="flex rounded-[5px] border border-[var(--border)] p-0.5">
          {(['mobile', 'desktop'] as const).map((s) => (
            <Link
              key={s}
              role="tab"
              aria-selected={s === strategy}
              href={`/p/${pageId}?strategy=${s}`}
              className={`rounded-[3px] px-2.5 py-1 text-[12px] capitalize ${
                s === strategy ? 'bg-[var(--surface-sunken)] font-medium' : 'text-[var(--muted)]'
              } ${!report.availability[s] ? 'opacity-50' : ''}`}
            >
              {s}
              {!report.availability[s] && <span className="ml-1 text-[10px]">—</span>}
            </Link>
          ))}
        </div>
      }
    >
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
          {report.page.path}
        </h1>
        <a
          href={report.page.url}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-[var(--muted)] hover:underline"
        >
          {report.page.url} ↗
        </a>
      </div>

      {!r ? (
        <EmptyState
          title={`Not audited on ${strategy} yet`}
          body="Nothing has measured this page on this strategy. Try the other tab, or wait for the next scheduled sweep."
        />
      ) : r.status === 'error' ? (
        <EmptyState
          tone="warn"
          title="Lighthouse could not measure this page"
          body={`The last attempt returned ${r.runtimeError ?? 'an error'}. This usually means the page did not render — it is a real finding about the page, not a failure of the audit.`}
        />
      ) : (
        <>
          <section aria-label="Scores" className="mb-6 flex flex-wrap gap-6 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <ScoreGauge score={r.scores.performance} label="Performance" size="lg"
              delta={delta(r.scores.performance, r.previousScores?.performance)} />
            <ScoreGauge score={r.scores.accessibility} label="Accessibility" size="lg"
              delta={delta(r.scores.accessibility, r.previousScores?.accessibility)} />
            <ScoreGauge score={r.scores.bestPractices} label="Best Practices" size="lg"
              delta={delta(r.scores.bestPractices, r.previousScores?.bestPractices)} />
            <ScoreGauge score={r.scores.seo} label="SEO" size="lg"
              delta={delta(r.scores.seo, r.previousScores?.seo)} />
            <div className="ml-auto self-end text-right text-[11px] text-[var(--muted)]">
              {new Date(r.fetchedAt).toLocaleString()}
              {r.lighthouseVersion && <div>Lighthouse {r.lighthouseVersion}</div>}
            </div>
          </section>

          {/* Field data first, matching PSI: real-user data is the one that matters. */}
          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Field data — real users, 28 days
            </h2>
            <FieldDataPanel field={r.field} />
          </section>

          <section className="mb-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
              Lab metrics
            </h2>
            <CWVGrid lab={r.lab} />
          </section>

          <div className="space-y-2">
            <AuditSection title="Opportunities" items={r.opportunities} defaultOpen
              emptyLabel="No opportunities found — nothing here would meaningfully improve load time." />
            <AuditSection title="Diagnostics" items={r.diagnostics} defaultOpen
              emptyLabel="No diagnostics flagged." />
            <AuditSection title="Accessibility, Best Practices & SEO" items={r.other}
              emptyLabel="No issues found in these categories." />
          </div>
        </>
      )}
    </AppShell>
  );
}

function delta(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  return current - previous;
}
