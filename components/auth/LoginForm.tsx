'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type AuthResult } from '@/app/actions/auth';
import { AuthCard, Field, SubmitButton, FormError, FormNotice, AuthLink } from './AuthCard';
import { GoogleButton } from './GoogleButton';

export function LoginForm({
  next,
  reason,
  googleEnabled,
  googleError,
}: {
  next: string;
  reason?: string;
  googleEnabled: boolean;
  googleError?: string;
}) {
  const [state, action, pending] = useActionState<AuthResult | null, FormData>(loginAction, null);
  const error = state && !state.ok ? state.error : null;

  return (
    <AuthCard
      title="Sign in"
      subtitle="Pick up where your last check left off."
      footer={
        <>
          No account yet? <AuthLink href="/signup">Create one</AuthLink>
        </>
      }
    >
      <div className="space-y-4">
        {/* A revoked membership leaves a valid token but no access; saying so
            beats silently bouncing someone back to a login screen they just used. */}
        {reason === 'no-access' && (
          <FormNotice tone="warn">
            Your access to that organisation has been removed. Sign in again, or ask an admin to
            re-invite you.
          </FormNotice>
        )}
        <FormError message={googleError ?? null} />

        {googleEnabled && (
          <>
            <GoogleButton href={`/api/auth/google?intent=login&next=${encodeURIComponent(next)}`} label="Continue with Google" />
            <div className="flex items-center gap-2 text-[11px] text-[var(--faint)]" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border)]" />
              or
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </>
        )}

        <form action={action} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" autoComplete="username" autoFocus invalid={Boolean(error)} />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(error)}
          />

          <FormError message={error} />

          <SubmitButton pending={pending} pendingLabel="Signing in…">
            Sign in
          </SubmitButton>

          <p className="text-center">
            <Link
              href="/forgot"
              className="rounded-[3px] text-[11.5px] text-[var(--muted)] underline-offset-2 transition-colors hover:text-[var(--foreground)] hover:underline"
            >
              Forgot your password?
            </Link>
          </p>
        </form>
      </div>
    </AuthCard>
  );
}
