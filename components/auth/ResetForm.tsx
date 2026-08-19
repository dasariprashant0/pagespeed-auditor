'use client';

import { useActionState } from 'react';
import { completeResetAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError } from './AuthCard';

export function ResetForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(completeResetAction, null);

  return (
    <AuthCard title="Choose a new password" subtitle={`For ${email}`}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" name="password" type="password" autoComplete="new-password"
          hint="At least 12 characters." />
        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton pending={pending}>Set password and sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
