import { requireCapability } from '@/lib/http/auth-guard';
import { listSites } from '@/lib/services/tenant.service';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { historyOverview } from '@/lib/services/retention.service';
import { AppShell } from '@/components/shell/AppShell';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { AddSiteForm, EditSiteForm, PsiKeyForm } from '@/components/settings/SiteForms';
import { IngestButton } from '@/components/settings/IngestButton';

export const dynamic = 'force-dynamic';

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="title-md">{title}</h2>
      {hint && <p className="mb-3 mt-1 max-w-xl text-[11px] text-[var(--muted)]">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export default async function SiteSettingsPage() {
  const ctx = await requireCapability('site:manage');
  const sites = await listSites(ctx.organizationId);
  const site = sites[0] ?? null;

  const [groups, history] = await Promise.all([
    site ? listGroupsWithAggregates(site.id, { strategy: 'mobile' }) : Promise.resolve([]),
    site ? historyOverview(site.id) : Promise.resolve(null),
  ]);
  const rail = groups.filter((g) => g.pageCount > 0).map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));
  const pageCount = groups.reduce((n, g) => n + g.pageCount, 0);

  return (
    <AppShell orgName={ctx.organizationName} siteName={site?.name} groups={rail} breadcrumb="Settings / Site">
      <h1 className="title-lg mb-4">Settings</h1>
      <SettingsNav role={ctx.role} active="/settings/site" />

      <div className="max-w-2xl space-y-3">
        {!site ? (
          <Panel title="Add your first site" hint="Point it at a sitemap and every page in it gets tracked.">
            <AddSiteForm />
          </Panel>
        ) : (
          <>
            <Panel title="Site">
              <EditSiteForm site={site} />
            </Panel>

            <Panel
              title="API key"
              hint="Google measures the pages. The key is stored for this organisation only and is never shown again once saved."
            >
              <PsiKeyForm site={site} />
            </Panel>

            <Panel
              title="Pages"
              hint={`${pageCount} pages are being tracked. Re-read the sitemap after publishing or removing pages — existing pages keep their history, and anything no longer listed stops being checked without losing its past results.`}
            >
              <IngestButton siteId={site.id} pageCount={pageCount} />
            </Panel>

            {history && (
              <Panel
                title="History"
                hint={`The last ${history.keepRuns} checks of every page are kept, together with their reports and advice. Older ones are removed so storage does not grow without limit.`}
              >
                <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
                  {[
                    ['Results stored', history.totalResults.toLocaleString()],
                    ['Checks recorded', history.distinctRuns.toLocaleString()],
                    ['Oldest', history.oldest ? new Date(history.oldest).toLocaleDateString() : '—'],
                    ['Storage used', bytes(history.storageBytes)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="eyebrow">{k}</dt>
                      <dd className="metric mt-1 text-[18px]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
