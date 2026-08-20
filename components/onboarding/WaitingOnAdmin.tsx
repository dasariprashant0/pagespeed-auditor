import { ROLE_LABEL, type Role } from '@/lib/auth/roles';

/**
 * Replaces SetupChecklist for anyone who cannot act on it.
 *
 * The checklist used to render for every role, showing "An admin needs to
 * do this" on every remaining step -- accurate, but a wall of things a
 * Viewer or Editor will never be the one to fix is worse guidance than one
 * honest line.
 */
export function WaitingOnAdmin({ role }: { role: Role }) {
  return (
    <div className="panel mb-6 px-4 py-3 text-[12px] text-[var(--muted)]">
      You&apos;re signed in as {ROLE_LABEL[role]}. An admin still needs to finish setting this up —
      there&apos;s nothing for you to configure here yet.
    </div>
  );
}
