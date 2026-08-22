import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { provisionRefFor, databaseUsageFor } from '@/lib/services/org.service';
import { formatBytes } from '@/lib/view/bytes';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { DatabaseConnectionForm } from '@/components/settings/DatabaseConnectionForm';

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

/** `null` (not connected) renders nothing; an error still gets its own stat tile rather than being swallowed. */
function UsageStat({ label, usage, extra }: { label: string; usage: { bytes: number } | { error: string } | null; extra?: string }) {
  if (!usage) return null;
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      {'error' in usage ? (
        <dd className="mt-1 text-[12px]" style={{ color: 'var(--score-fail-text)' }}>
          Couldn&rsquo;t read usage: {usage.error}
        </dd>
      ) : (
        <dd className="metric mt-1 text-[18px]">
          {formatBytes(usage.bytes)}
          {extra && <span className="ml-1.5 text-[11px] font-normal text-[var(--muted)]">{extra}</span>}
        </dd>
      )}
    </div>
  );
}

/**
 * Every organisation brings and provisions its own Neon Postgres database
 * and its own Cloudflare D1 database instead of the app owner providing a
 * shared one for everyone -- see docs/DECISIONS.md §19. Visible to every
 * role, same as every other settings page; only org:provision decides
 * whether the form actually accepts input.
 */
export default async function DatabaseSettingsPage() {
  const ctx = await requireSession();
  const canEdit = can(ctx.role, 'org:provision');
  const provision = await provisionRefFor(ctx.organizationId);
  // Only worth asking Neon/Cloudflare for real numbers once there's
  // something connected to ask about -- an unprovisioned org has nothing
  // to read and no credentials to read it with.
  const usage = provision.hasNeonUrl || provision.hasD1Credentials ? await databaseUsageFor(ctx.organizationId) : null;

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Database" subtitle="Where this organisation's own data lives" />
      <SettingsNav active="/settings/database" />

      <div className="max-w-2xl space-y-3">
        <Panel
          title="Your own databases"
          hint={
            canEdit
              ? 'Connect your own Neon Postgres and Cloudflare D1 databases. Both are free to create, and your usage is never on our quota.'
              : 'Only an admin can connect or change these.'
          }
        >
          <DatabaseConnectionForm provision={provision} canEdit={canEdit} />
        </Panel>

        {usage && (usage.neon || usage.d1) && (
          <Panel
            title="Usage"
            hint="Read directly from your own Neon and Cloudflare accounts, live, every time this page loads -- not stored or polled in the background. Check your Neon/Cloudflare dashboard for the exact free-tier limit; this just saves the trip for a quick look."
          >
            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              <UsageStat label="Neon (Postgres) database size" usage={usage.neon} />
              <UsageStat label="Cloudflare D1 database size" usage={usage.d1} extra={usage.d1 && !('error' in usage.d1) ? `· ${usage.d1.numTables} table${usage.d1.numTables === 1 ? '' : 's'}` : undefined} />
            </dl>
          </Panel>
        )}
      </div>
    </>
  );
}
