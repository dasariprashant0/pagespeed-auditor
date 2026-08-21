import { redirect } from 'next/navigation';
import { getSession } from '@/lib/http/session';
import { LoginForm } from '@/components/auth/LoginForm';
import { safeNextPath } from '@/lib/http/auth-guard';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string; error?: string }>;
}) {
  const { next, reason, error } = await searchParams;
  // Already signed in and not bounced here by a lost membership.
  if (reason !== 'no-access' && (await getSession())) redirect('/');
  return (
    <LoginForm
      next={safeNextPath(next)}
      reason={reason}
      googleError={error}
      googleEnabled={Boolean(getEnv().GOOGLE_CLIENT_ID)}
    />
  );
}
