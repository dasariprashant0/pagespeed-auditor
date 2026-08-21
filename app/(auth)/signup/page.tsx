import { redirect } from 'next/navigation';
import { getSession } from '@/lib/http/session';
import { SignupForm } from '@/components/auth/SignupForm';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect('/');
  const { error } = await searchParams;
  return <SignupForm googleEnabled={Boolean(getEnv().GOOGLE_CLIENT_ID)} googleError={error} />;
}
