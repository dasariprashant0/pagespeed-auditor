'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError } from './AuthCard';

export function LoginForm({ next, reason }: { next: string; reason?: string }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginAction, null);

  return (
    <AuthCard
      title="PageSpeed Auditor"
      subtitle="Sign in to your account"
      footer={
        <>
          No account? <Link href="/signup" className="underline">Create one</Link>
        </>
      }
    >
      {/* A revoked membership leaves a valid token but no access; saying so
          beats silently bouncing someone back to a login screen they just used. */}
      {reason === 'no-access' && (
        <p className="mb-3 rounded-[5px] px-2.5 py-2 text-[12px]" style={{ background: 'var(--score-average-tint)' }}>
          Your access to that organisation has been removed. Sign in again, or ask an admin to re-invite you.
        </p>
      )}

      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="username" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
