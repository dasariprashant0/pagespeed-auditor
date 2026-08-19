import { requireSession } from '@/lib/http/auth-guard';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { defaultSite } from '@/lib/services/tenant.service';
import { AppShell } from '@/components/shell/AppShell';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { ProfileForms } from '@/components/settings/ProfileForms';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const ctx = await requireSession();
  const site = await defaultSite(ctx.organizationId);
  const groups = site ? await listGroupsWithAggregates(site.id, { strategy: 'mobile' }) : [];
  const rail = groups.filter((g) => g.pageCount > 0).map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

  return (
    <AppShell orgName={ctx.organizationName} siteName={site?.name} groups={rail} breadcrumb="Settings / Profile">
      <h1 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">Settings</h1>
      <SettingsNav role={ctx.role} active="/settings/profile" />
      <ProfileForms email={ctx.email} name={ctx.name} role={ctx.role} organizationName={ctx.organizationName} />
    </AppShell>
  );
}
