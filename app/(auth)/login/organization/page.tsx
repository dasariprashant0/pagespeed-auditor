import { redirect } from 'next/navigation';
import { getPendingAuth } from '@/lib/http/pendingAuth';
import { membershipsForUser } from '@/lib/services/account.service';
import { OrganizationPicker } from '@/components/auth/OrganizationPicker';
import { safeNextPath } from '@/lib/http/auth-guard';

export const dynamic = 'force-dynamic';

/**
 * Only reachable via the pending-auth cookie loginAction/completeResetAction/
 * the Google callback set after verifying who someone is -- never a landing
 * page of its own. No cookie, or an expired one, just goes back to /login.
 */
export default async function ChooseOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const pending = await getPendingAuth();
  if (!pending) redirect('/login');

  const memberships = await membershipsForUser(pending.userId);
  // Shouldn't happen -- setPendingAuth is only ever called after confirming
  // more than one membership exists -- but a stale cookie outliving a
  // membership change is a real possibility, so fail safe rather than crash.
  if (memberships.length === 0) redirect('/login');

  return <OrganizationPicker memberships={memberships} next={safeNextPath(next)} error={error} />;
}
