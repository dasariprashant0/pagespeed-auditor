'use client';

import { useActionState } from 'react';
import { signupAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError, AuthLink } from './AuthCard';

export function SignupForm() {
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
    </AuthCard>
  );
}
