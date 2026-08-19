import { inspectResetToken } from '@/lib/services/account.service';
import { ResetForm } from '@/components/auth/ResetForm';
import { AuthCard, AuthLink } from '@/components/auth/AuthCard';
import { ButtonLink } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const info = token ? await inspectResetToken(token) : { valid: false, reason: 'That link is missing its token.' };

  if (!info.valid || !token) {
    return (
      <AuthCard
        title="That link has expired"
        subtitle={info.reason}
        footer={<><AuthLink href="/login">Back to sign in</AuthLink></>}
      >
        <ButtonLink href="/forgot" variant="primary" className="h-9 w-full text-[13px]">
          Send me a new link
        </ButtonLink>
      </AuthCard>
    );
  }

  return <ResetForm token={token} email={info.email!} />;
}
