import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';
import { getTenantPrisma } from '@/lib/db/tenant';
import { getEnv } from '@/lib/env';
import { listSites, orgEmailRef } from '@/lib/services/tenant.service';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { historyOverview } from '@/lib/services/retention.service';
import { estimateRun } from '@/lib/services/estimate.service';
import { emailConfigProblem } from '@/lib/notify/email';
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
  const env = getEnv();
  // Visible to every role -- only site:manage decides whether these forms
  // actually accept input. See docs/DECISIONS.md.
  const ctx = await requireSession();
  const prisma = await getTenantPrisma(ctx.organizationId);
  const canEdit = can(ctx.role, 'site:manage');
  const sites = await listSites(ctx.organizationId);
  const site = sites[0] ?? null;

  const [groups, history, orgEmail] = await Promise.all([
    site ? listGroupsWithAggregates(ctx.organizationId, site.id, { strategy: 'mobile' }) : Promise.resolve([]),
    site ? historyOverview(prisma, site.id) : Promise.resolve(null),
    orgEmailRef(ctx.organizationId),
  ]);
  const pageCount = groups.reduce((n, g) => n + g.pageCount, 0);
  const sweepEstimate = site ? await estimateRun(ctx.organizationId, pageCount * 2, site.id) : null;

  // An organisation's own SMTP override (orgEmail.hasOverride) bypasses the
  // shared default entirely -- emailConfigProblem() only describes that
  // shared default, so it would wrongly report "not configured" for an
  // organisation that has already set its own mailbox.
  const emailProblem = orgEmail.hasOverride ? null : emailConfigProblem();

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Site" subtitle="What gets measured" />
      <SettingsNav active="/settings/site" />

      <div className="max-w-2xl space-y-3">
        {!site ? (
          <Panel
            title="Add your first site"
            hint={canEdit ? 'Point it at a sitemap and every page in it gets tracked.' : 'Only an admin can add a site.'}
          >
            <AddSiteForm canEdit={canEdit} />
          </Panel>
        ) : (
          <>
            <Panel title="Site">
              <EditSiteForm site={site} canEdit={canEdit} />
            </Panel>

            <Panel
              title="API key"
              hint={
                canEdit
                  ? 'Google measures the pages. The key is stored for this organisation only and is never shown again once saved.'
                  : 'Only an admin can view or change the API key.'
              }
            >
              <PsiKeyForm site={site} canEdit={canEdit} />
            </Panel>

            <Panel
              title="Pages"
              hint={`${pageCount} pages are being tracked.${
                canEdit
                  ? ' Re-read the sitemap after publishing or removing pages — existing pages keep their history, and anything no longer listed stops being checked without losing its past results.'
                  : ' Only an admin can re-read the sitemap.'
              }`}
            >
              <IngestButton siteId={site.id} pageCount={pageCount} canEdit={canEdit} />
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
                {history.blobBackedResults > 0 && (
                  <p className="mt-3 text-[11px] text-[var(--muted)]">
                    {history.blobBackedResults.toLocaleString()} of those results have their full report
                    stored separately rather than here, and are not included in &ldquo;Storage
                    used&rdquo; above.
                  </p>
                )}
              </Panel>
            )}

            <Panel
              title="Configuration"
              hint="A quick operational snapshot — some of this is set for the whole deployment (ask whoever manages hosting to change it), the rest is just measured."
            >
              <dl className="divide-y divide-[var(--border)] text-[12px]">
                {([
                  ['Pages tested at once', String(env.WORKER_CONCURRENCY)],
                  ['Google rate limit', `${env.PSI_RATE_MAX} requests per ${env.PSI_RATE_WINDOW_MS / 1000}s`],
                  [
                    'Typical time per page',
                    sweepEstimate?.measured ? `${Math.round(sweepEstimate.medianCallMs / 1000)} seconds (measured)` : 'not measured yet',
                  ],
                  [
                    'Email',
                    orgEmail.hasOverride
                      ? `sending via your own mailbox (${orgEmail.host})`
                      : emailProblem
                        ? 'not sending — see Settings → Notifications'
                        : process.env.EMAIL_TRANSPORT === 'resend'
                          ? `sending as ${process.env.EMAIL_FROM} via Resend`
                          : `sending via ${process.env.SMTP_HOST}`,
                  ],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-4 py-1.5">
                    <dt className="w-44 shrink-0 text-[var(--muted)]">{k}</dt>
                    <dd className="min-w-0 break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
