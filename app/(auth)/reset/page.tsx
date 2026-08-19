import Link from 'next/link';
import { inspectResetToken } from '@/lib/services/account.service';
import { ResetForm } from '@/components/auth/ResetForm';
import { AuthCard } from '@/components/auth/AuthCard';

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
      <AuthCard title="Link unavailable">
        <p className="text-[12px] text-[var(--muted)]">{info.reason}</p>
        <p className="mt-3 text-[12px]">
          <Link href="/forgot" className="underline">Request a new one</Link>
        </p>
      </AuthCard>
    );
  }

  return <ResetForm token={token} email={info.email!} />;
}
