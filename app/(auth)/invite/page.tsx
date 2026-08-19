import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { AcceptInviteForm } from '@/components/auth/AcceptInviteForm';
import { AuthCard } from '@/components/auth/AuthCard';
import { isRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return <AuthCard title="Invalid invitation"><p className="text-[12px] text-[var(--muted)]">That link is missing its token.</p></AuthCard>;
  }

  // Only the hash is stored, so the link itself is the credential.
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    select: {
      email: true, role: true, expiresAt: true, acceptedAt: true,
      organization: { select: { name: true } },
    },
  });

  const problem = !invite
    ? 'That invitation link is not valid.'
    : invite.acceptedAt
      ? 'That invitation has already been used. Try signing in instead.'
      : invite.expiresAt < new Date()
        ? 'That invitation has expired. Ask an admin to send a new one.'
        : null;

  if (problem || !invite) {
    return (
      <AuthCard title="Invitation unavailable">
        <p className="text-[12px] text-[var(--muted)]">{problem}</p>
      </AuthCard>
    );
  }

  const hasAccount = Boolean(
    await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
  );

  return (
    <AcceptInviteForm
      token={token}
      email={invite.email}
      organizationName={invite.organization.name}
      role={isRole(invite.role) ? invite.role : 'viewer'}
      hasAccount={hasAccount}
    />
  );
}
