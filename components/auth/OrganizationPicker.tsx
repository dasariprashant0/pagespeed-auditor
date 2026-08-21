'use client';

import { useActionState } from 'react';
import { selectOrganizationAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, FormError } from './AuthCard';
import { ROLE_LABEL, type Role } from '@/lib/auth/roles';

/**
 * One button per organisation, all inside one form -- whichever button is
 * clicked is the (name, value) pair that submits, the plain HTML mechanism
 * for "n choices, one form" with no client-side state of its own needed.
 */
export function OrganizationPicker({
  memberships,
  next,
  error,
}: {
  memberships: { organizationId: string; organizationName: string; role: Role }[];
  next?: string;
  error?: string;
}) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(selectOrganizationAction, null);

  return (
    <AuthCard
      title="Choose an organisation"
      subtitle="Your account belongs to more than one — pick which to sign in to."
    >
      <div className="space-y-3">
        <FormError message={error ?? (state && !state.ok ? state.error : null)} />
        <form action={action} className="space-y-2">
          <input type="hidden" name="next" value={next ?? '/'} />
          {memberships.map((m) => (
            <button
              key={m.organizationId}
              type="submit"
              name="organizationId"
              value={m.organizationId}
              disabled={pending}
              className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50"
            >
              <span>{m.organizationName}</span>
              <span className="text-[11px] font-normal text-[var(--muted)]">{ROLE_LABEL[m.role]}</span>
            </button>
          ))}
        </form>
      </div>
    </AuthCard>
  );
}
