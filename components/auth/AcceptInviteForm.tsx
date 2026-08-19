'use client';

import { useActionState } from 'react';
import { acceptInviteAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError } from './AuthCard';
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from '@/lib/auth/roles';

export function AcceptInviteForm({
  token,
  email,
  organizationName,
  role,
  hasAccount,
}: {
  token: string;
  email: string;
  organizationName: string;
  role: Role;
  hasAccount: boolean;
}) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(acceptInviteAction, null);

  return (
    <AuthCard
      title={`Join ${organizationName}`}
      subtitle={`You have been invited as a ${ROLE_LABEL[role]}. ${ROLE_DESCRIPTION[role]}`}
    >
      <form action={action} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        {/* Read-only: the invited address is what was authorised. Letting it be
            changed would turn an intercepted link into a way to join as
            somebody else. */}
        <Field label="Email" name="email" defaultValue={email} readOnly required={false} />

        {!hasAccount && (
          <>
            <Field label="Your name" name="name" required={false} autoComplete="name" />
            <Field label="Choose a password" name="password" type="password" autoComplete="new-password"
              hint="At least 12 characters." />
          </>
        )}

        <FormError message={state && !state.ok ? state.error : null} />
        <SubmitButton pending={pending}>{hasAccount ? 'Join' : 'Create account and join'}</SubmitButton>
      </form>
    </AuthCard>
  );
}
