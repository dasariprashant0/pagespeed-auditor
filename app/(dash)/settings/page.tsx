import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

/**
 * /settings has no content of its own -- it sends you to the first section you
 * can actually use. Automation used to live here, which made it the one tab
 * whose URL did not match its name.
 */
export default async function SettingsIndex() {
  const ctx = await requireSession();
  redirect(can(ctx.role, 'automation:manage') ? '/settings/automation' : '/settings/profile');
}
