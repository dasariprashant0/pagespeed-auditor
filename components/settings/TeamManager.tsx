'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  inviteMemberAction, changeRoleAction, removeMemberAction, revokeInviteAction,
} from '@/app/actions/members';
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_ORDER, type Role } from '@/lib/auth/roles';

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  isYou: boolean;
  joinedAt: string;
}
export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const select =
  'rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px]';

export function TeamManager({
  members,
  invites,
  adminCount,
  canEdit,
}: {
  members: MemberRow[];
  invites: InviteRow[];
  adminCount: number;
  /** members:manage. Visible to everyone regardless; only this decides
   * whether the invite form and the per-row controls actually accept input. */
  canEdit: boolean;
}) {
  const [invite, inviteAction, inviting] = useActionState<
    { ok: true; message: string; inviteUrl?: string } | { ok: false; error: string } | null,
    FormData
  >(inviteMemberAction, null);
  const [busy, startBusy] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const router = useRouter();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startBusy(async () => {
      setRowError(null);
      const r = await fn();
      if (!r.ok) setRowError(r.error ?? 'Could not do that.');
      else router.refresh();
    });

  return (
    <div className="space-y-3">
      <section className="panel p-4">
        <h2 className="title-md">Invite someone</h2>
        <p className="mb-3 mt-1 text-[11px] text-[var(--muted)]">
          {canEdit
            ? 'They get a link that works for seven days. If email is not set up yet, copy the link and send it yourself.'
            : 'Only an admin can invite teammates.'}
        </p>

        <form action={inviteAction} className="flex flex-wrap items-end gap-2">
          <fieldset disabled={!canEdit} className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1">
              <span className="eyebrow mb-1 block">Email</span>
              <input
                name="email" type="email" required placeholder="teammate@company.com"
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] disabled:opacity-50"
              />
            </label>
            <label>
              <span className="eyebrow mb-1 block">Role</span>
              <select name="role" defaultValue="viewer" className={`${select} py-[7px] disabled:opacity-50`}>
                {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <button
              type="submit" disabled={inviting}
              className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
            >
              {inviting ? 'Inviting…' : 'Send invite'}
            </button>
          </fieldset>
        </form>

        {invite && !invite.ok && (
          <p role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{invite.error}</p>
        )}
        {invite?.ok && (
          <div className="mt-3 rounded-[6px] bg-[var(--surface-subtle)] p-2.5">
            <p className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{invite.message}</p>
            {invite.inviteUrl && (
              <input
                readOnly value={invite.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-2 w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[10px]"
              />
            )}
          </div>
        )}

        <dl className="mt-4 grid gap-1.5 border-t border-[var(--border)] pt-3">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="flex gap-2 text-[11px]">
              <dt className="w-20 shrink-0 font-medium">{ROLE_LABEL[r]}</dt>
              <dd className="text-[var(--muted)]">{ROLE_DESCRIPTION[r]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="title-md">People</h2>
          <span className="eyebrow">{members.length}</span>
        </div>
        {rowError && (
          <p role="alert" className="px-4 pb-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{rowError}</p>
        )}
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {members.map((m) => {
            // The last admin cannot be demoted or removed: doing so locks
            // everyone out of settings with no way back through the UI.
            const lastAdmin = m.role === 'admin' && adminCount === 1;
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px]">
                    {m.name ?? m.email}
                    {m.isYou && <span className="ml-1.5 text-[10px] text-[var(--faint)]">you</span>}
                  </div>
                  {m.name && <div className="truncate text-[11px] text-[var(--muted)]">{m.email}</div>}
                </div>
                <select
                  aria-label={`Role for ${m.email}`}
                  value={m.role}
                  disabled={!canEdit || busy || lastAdmin}
                  onChange={(e) => act(() => changeRoleAction(m.userId, e.target.value))}
                  className={select}
                  title={
                    !canEdit
                      ? 'Only an admin can change someone’s role.'
                      : lastAdmin ? 'The only admin cannot be demoted. Promote someone else first.' : undefined
                  }
                >
                  {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!canEdit || busy || m.isYou || lastAdmin}
                  onClick={() => {
                    if (confirm(`Remove ${m.name ?? m.email} from this organisation? They lose access immediately.`)) {
                      act(() => removeMemberAction(m.userId));
                    }
                  }}
                  className="text-[11px] text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30"
                  title={
                    !canEdit
                      ? 'Only an admin can remove teammates.'
                      : m.isYou ? 'You cannot remove yourself.' : lastAdmin ? 'The only admin cannot be removed.' : undefined
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="title-md">Waiting to accept</h2>
            <span className="eyebrow">{invites.length}</span>
          </div>
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{i.email}</span>
                <span className="text-[11px] text-[var(--muted)]">{ROLE_LABEL[i.role]}</span>
                <span className="text-[11px] text-[var(--faint)]">
                  expires {new Date(i.expiresAt).toLocaleDateString()}
                </span>
                <button
                  type="button" disabled={!canEdit || busy}
                  onClick={() => act(() => revokeInviteAction(i.id))}
                  className="text-[11px] text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30"
                  title={!canEdit ? 'Only an admin can revoke invitations.' : undefined}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
