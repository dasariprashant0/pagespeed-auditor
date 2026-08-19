import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { listGroupsWithAggregates, listPagesInGroup } from '@/lib/services/results.service';
import { AppShell } from '@/components/shell/AppShell';
import { PageTable } from '@/components/nav/PageTable';
import { EmptyState } from '@/components/nav/EmptyState';
import { RunAuditButton } from '@/components/runs/RunAuditButton';
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
  const strategy: PsiStrategy = raw === 'desktop' ? 'desktop' : 'mobile';

  const site = await prisma.site.findFirstOrThrow({ select: { id: true, name: true } });
  const group = await prisma.group.findFirst({
    where: { siteId: site.id, slug },
    select: { id: true, name: true, slug: true },
  });
  if (!group) notFound();

  const [pages, allGroups] = await Promise.all([
    listPagesInGroup(group.id, { strategy }),
    listGroupsWithAggregates(site.id, { strategy }),
  ]);

  const rail = allGroups
    // Already in sitemap order from the service; re-sorting here would undo it.
    .filter((g) => g.pageCount > 0)
    .map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

  return (
    <AppShell
      siteName={site.name}
      groups={rail}
      activeSlug={slug}
      breadcrumb={
        <>
          <Link href="/" className="hover:text-[var(--foreground)]">Overview</Link>
          <span className="mx-1.5">/</span>
          <span className="text-[var(--foreground)]">{group.name}</span>
        </>
      }
      actions={
        <div className="flex items-center gap-2">
        <RunAuditButton kind="group" target={slug} label={`Audit all ${pages.length}`} />
        <a
          href={`/api/reports/bulk?group=${slug}&strategy=${strategy}`}
          download
          className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
          title="Every audited page in this group as one markdown file, for handing to a coding agent."
        >
          Download .md
        </a>
        <div role="tablist" aria-label="Report strategy" className="flex rounded-[5px] border border-[var(--border)] p-0.5">
          {(['mobile', 'desktop'] as const).map((s) => (
            <Link
              key={s}
              role="tab"
              aria-selected={s === strategy}
              href={`/g/${slug}?strategy=${s}`}
              className={`rounded-[3px] px-2.5 py-1 text-[12px] capitalize ${
                s === strategy ? 'bg-[var(--surface-sunken)] font-medium' : 'text-[var(--muted)]'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>
        </div>
      }
    >
      <div className="mb-4">
        <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
          {group.name}
        </h1>
        <p className="mt-0.5 text-[12px] text-[var(--muted)]">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'} · {strategy} · re-running audits
          both strategies at ~{Math.max(1, Math.ceil((pages.length * 2) / 0.75 / 60))} min
        </p>
      </div>

      {pages.length === 0 ? (
        <EmptyState title="No pages in this group" body="Every page here has been removed from the sitemap, or moved to another group." />
      ) : (
        <PageTable pages={pages} strategy={strategy} />
      )}
    </AppShell>
  );
}
