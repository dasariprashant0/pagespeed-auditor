import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { AppShell } from '@/components/shell/AppShell';

export const dynamic = 'force-dynamic';

/** Masks a secret so the page can confirm it is set without disclosing it. */
function masked(v: string): string {
  if (!v) return 'not set';
  return `${v.slice(0, 4)}${'•'.repeat(8)}${v.slice(-4)}`;
}

export default async function SettingsPage() {
  const env = getEnv();
  const site = await prisma.site.findFirstOrThrow();
  const groups = await listGroupsWithAggregates(site.id, { strategy: 'mobile' });
  const rail = groups
    .filter((g) => g.pageCount > 0)
    .sort((a, b) => b.pageCount - a.pageCount)
    .map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

  const schedule = await prisma.schedule.findUnique({ where: { siteId: site.id } });

  const rows: Array<[string, string]> = [
    ['Site', site.name],
    ['Base URL', site.baseUrl],
    ['Sitemap', site.sitemapUrl],
    ['PSI API key', masked(env.PSI_API_KEY)],
    ['Login user', env.AUTH_USERNAME],
    ['Password', env.AUTH_PASSWORD_HASH ? 'configured' : 'NOT SET — run npm run set-password'],
    ['Worker concurrency', String(env.WORKER_CONCURRENCY)],
    ['PSI rate', `${env.PSI_RATE_MAX} per ${env.PSI_RATE_WINDOW_MS} ms`],
    ['Sync group limit', `${env.SYNC_GROUP_PAGE_LIMIT} pages`],
    ['Schedule', schedule?.enabled ? (schedule.cronExpr ?? 'enabled') : 'disabled'],
  ];

  return (
    <AppShell siteName={site.name} groups={rail} breadcrumb="Settings">
      <h1 className="mb-1 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
        Settings
      </h1>
      <p className="mb-5 max-w-xl text-[12px] text-[var(--muted)]">
        Read-only for now. Everything here is configured in <code>.env</code>; editable
        settings and the schedule builder are the next milestone.
      </p>

      <dl className="max-w-2xl divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-3.5 py-2">
            <dt className="w-44 shrink-0 text-[12px] text-[var(--muted)]">{k}</dt>
            <dd className="min-w-0 break-all text-[12px]">{v}</dd>
          </div>
        ))}
      </dl>
    </AppShell>
  );
}
