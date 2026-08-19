import { requireCapability } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { defaultSite } from '@/lib/services/tenant.service';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { AppShell } from '@/components/shell/AppShell';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { TeamManager, type MemberRow, type InviteRow } from '@/components/settings/TeamManager';
import { isRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const ctx = await requireCapability('members:manage');

  const [memberships, invitations, site] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true, createdAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.invitation.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
    defaultSite(ctx.organizationId),
  ]);

  const groups = site ? await listGroupsWithAggregates(site.id, { strategy: 'mobile' }) : [];
  const rail = groups.filter((g) => g.pageCount > 0).map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));

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
    <AppShell orgName={ctx.organizationName} siteName={site?.name} groups={rail} breadcrumb="Settings / Teammates">
      <h1 className="title-lg mb-4">Settings</h1>
      <SettingsNav role={ctx.role} active="/settings/team" />
      <div className="max-w-2xl">
        <TeamManager
          members={members}
          invites={invites}
          adminCount={members.filter((m) => m.role === 'admin').length}
        />
      </div>
    </AppShell>
  );
}
