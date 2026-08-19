'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { signupAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError } from './AuthCard';

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(signupAction, null);

  return (
    <AuthCard
      title="Create an account"
      subtitle="You will be the admin of a new organisation, and can invite your team afterwards."
      footer={
        <>
          Already have one? <Link href="/login" className="underline">Sign in</Link>
        </>
      }
    >
      <form action={action} className="space-y-3">
        <Field label="Organisation" name="organizationName" autoComplete="organization"
          hint="Your company or team. You can add several sites to it." />
        <Field label="Your name" name="name" required={false} autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="username" />
        <Field label="Password" name="password" type="password" autoComplete="new-password"
          hint="At least 12 characters." />
        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
