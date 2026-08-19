'use client';

import { useActionState } from 'react';
import { requestResetAction, type ResetRequestResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError, AuthLink } from './AuthCard';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ResetRequestResult | null, FormData>(requestResetAction, null);

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <form action={action} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="username" />
        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </form>

      {state?.ok && (
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <p className="text-[12px]">{state.message}</p>
          {/* Without a mail transport the link is unreachable, which in a
              self-hosted install means nobody can ever get back in. */}
          {state.devUrl && (
            <>
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Email is not set up on this install, so the link is here instead:
              </p>
              <input
                readOnly value={state.devUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[10px]"
              />
            </>
          )}
        </div>
      )}
    </AuthCard>
  );
}
