'use client';

import { useActionState } from 'react';
import { acceptInviteAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError } from './AuthCard';
import { GoogleButton } from './GoogleButton';
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from '@/lib/auth/roles';

export function AcceptInviteForm({
  token,
  email,
  organizationName,
  role,
  hasAccount,
  googleEnabled,
  googleError,
}: {
  token: string;
  email: string;
  organizationName: string;
  role: Role;
  hasAccount: boolean;
  googleEnabled: boolean;
  googleError?: string;
}) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(acceptInviteAction, null);

  return (
    <AuthCard
      title={`Join ${organizationName}`}
      subtitle={`You have been invited as a ${ROLE_LABEL[role]}. ${ROLE_DESCRIPTION[role]}`}
    >
      <div className="space-y-4">
        <FormError message={googleError ?? null} />

        {/* An existing account just joins on "Join" below with no extra
            credential -- the invite token itself, sent to this exact
            address, is what's authorising this. Google only matters for
            the "choose a password" case it's replacing, i.e. brand new. */}
        {!hasAccount && googleEnabled && (
          <>
            <GoogleButton
              href={`/api/auth/google?intent=accept&token=${encodeURIComponent(token)}`}
              label="Continue with Google"
            />
            <p className="text-center text-[11px] text-[var(--faint)]">
              Must be signed in to Google as {email} — that&rsquo;s the address this invite was sent to.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-[var(--faint)]" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border)]" />
              or
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </>
        )}

        <form action={action} className="space-y-4">
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
      </div>
    </AuthCard>
  );
}
