import { redirect } from 'next/navigation';
import { getSession } from '@/lib/http/session';
import { LoginForm } from '@/components/auth/LoginForm';
import { safeNextPath } from '@/lib/http/auth-guard';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  // Already signed in and not bounced here by a lost membership.
  if (reason !== 'no-access' && (await getSession())) redirect('/');
  return <LoginForm next={safeNextPath(next)} reason={reason} />;
}
