import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { centralPrisma } from '@/lib/db/central';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { TeamManager, type MemberRow, type InviteRow } from '@/components/settings/TeamManager';
import { can, isRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  // Visible to every role -- only members:manage decides whether TeamManager's
  // forms actually accept input. See docs/DECISIONS.md.
  const ctx = await requireSession();

  const [memberships, invitations] = await Promise.all([
    centralPrisma.membership.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true, createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    centralPrisma.invitation.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);

  const members: MemberRow[] = memberships.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: isRole(m.role) ? m.role : 'viewer',
    isYou: m.user.id === ctx.userId,
    joinedAt: m.createdAt.toISOString(),
  }));
  const invites: InviteRow[] = invitations.map((i) => ({
    id: i.id, email: i.email, role: isRole(i.role) ? i.role : 'viewer',
    expiresAt: i.expiresAt.toISOString(),
  }));

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Teammates" subtitle="Who can see and change things" />
      <SettingsNav active="/settings/team" />
      <div className="max-w-2xl">
        <TeamManager
          members={members}
          invites={invites}
          adminCount={members.filter((m) => m.role === 'admin').length}
          canEdit={can(ctx.role, 'members:manage')}
        />
      </div>
    </>
  );
}
