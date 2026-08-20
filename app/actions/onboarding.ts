'use server';

import { requireSession } from '@/lib/http/auth-guard';
import { markRoleTourSeen } from '@/lib/services/account.service';

/**
 * Dismisses the "here's what your role can do" banner for good.
 *
 * Fire-and-forget from the client's point of view: the banner already hides
 * itself locally the instant this is called, and a person seeing it once
 * more on a rare failure is not worth a revert path for.
 */
export async function dismissRoleTourAction(): Promise<void> {
  const ctx = await requireSession();
  await markRoleTourSeen(ctx.userId);
}
