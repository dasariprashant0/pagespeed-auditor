import { redirect } from 'next/navigation';
import { getSession } from '@/lib/http/session';
import { SignupForm } from '@/components/auth/SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  if (await getSession()) redirect('/');
  return <SignupForm />;
}
