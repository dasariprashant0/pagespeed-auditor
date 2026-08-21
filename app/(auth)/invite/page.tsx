import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { AcceptInviteForm } from '@/components/auth/AcceptInviteForm';
import { AuthCard, AuthLink } from '@/components/auth/AuthCard';
import { ButtonLink } from '@/components/ui/Button';
import { isRole } from '@/lib/auth/roles';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) {
    return (
      <AuthCard
        title="This invitation link is incomplete"
        subtitle="The link is missing its token — it was probably cut short by an email client. Ask whoever invited you to send it again."
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <ButtonLink href="/login" variant="primary" className="h-9 w-full text-[13px]">
          Go to sign in
        </ButtonLink>
      </AuthCard>
    );
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
      <AuthCard
        title="This invitation can't be used"
        subtitle={problem}
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <ButtonLink href="/login" variant="primary" className="h-9 w-full text-[13px]">
          Go to sign in
        </ButtonLink>
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
      googleEnabled={Boolean(getEnv().GOOGLE_CLIENT_ID)}
      googleError={error}
    />
  );
}
