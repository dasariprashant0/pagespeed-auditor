import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { provisionRefFor } from '@/lib/services/org.service';
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
      </div>
    </>
  );
}
