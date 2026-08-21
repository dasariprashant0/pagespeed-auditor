'use client';

import { useActionState } from 'react';
import { signupAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError, AuthLink } from './AuthCard';
import { GoogleButton } from './GoogleButton';

export function SignupForm({ googleEnabled, googleError }: { googleEnabled: boolean; googleError?: string }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(signupAction, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <AuthCard
      title="Create your account"
      subtitle="You'll be the admin of a new organisation, and can invite your team once you're in."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={googleError ?? null} />

        {googleEnabled && (
          <>
            <GoogleButton href="/api/auth/google?intent=signup" label="Continue with Google" />
            <p className="text-center text-[11px] text-[var(--faint)]">
              Creates a new organisation named after your account — rename it any time from Settings.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[var(--faint)]" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border)]" />
              or
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </>
        )}

        <form action={action} className="space-y-4">
          <Field
            label="Organisation"
            name="organizationName"
            autoComplete="organization"
            autoFocus
            hint="Your company or team. You can track several sites under it."
          />
          <Field label="Your name" name="name" required={false} autoComplete="name" />
          <Field label="Email" name="email" type="email" autoComplete="username" invalid={Boolean(error)} />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters."
            invalid={Boolean(error)}
          />

          <FormError message={error} />

          <SubmitButton pending={pending} pendingLabel="Creating your account…">
            Create account
          </SubmitButton>
        </form>
      </div>
    </AuthCard>
  );
}
