import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { ProfileForms } from '@/components/settings/ProfileForms';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const ctx = await requireSession();

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Profile" subtitle="Your account" />
      <SettingsNav active="/settings/profile" />
      <ProfileForms email={ctx.email} name={ctx.name} role={ctx.role} organizationName={ctx.organizationName} />
    </>
  );
}
