'use client';

import { useActionState, useId } from 'react';
import { loginAction, type LoginResult } from '@/app/actions/auth';

/**
 * The only client island on this route. useActionState gives us the pending
 * flag and the returned error without a useEffect, and the form still submits
 * (and still authenticates) with JavaScript disabled, because the action is a
 * real POST endpoint.
 *
 * On success loginAction() redirects, so `state` is only ever the failure case.
 */

const field =
  'mt-1 w-full border border-foreground/15 bg-transparent px-3 py-2 text-[13px] tabular-nums ' +
  'outline-none focus-visible:border-foreground/40 focus-visible:outline-2 ' +
  'focus-visible:outline-offset-1 focus-visible:outline-foreground/60 ' +
  'aria-[invalid=true]:border-accent/60';

const label = 'block text-[12px] font-medium uppercase tracking-wide text-muted';

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState<LoginResult | null, FormData>(loginAction, null);
  const errorId = useId();

  const failed = state?.ok === false;

  return (
    <form action={formAction} className="space-y-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />

      <div>
        <label className={label} htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          aria-invalid={failed}
          aria-describedby={failed ? errorId : undefined}
          className={field}
        />
      </div>

      <div>
        <label className={label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed}
          aria-describedby={failed ? errorId : undefined}
          className={field}
        />
      </div>

      {failed && (
        // role="alert" so a screen reader announces the failure without the
        // user having to go hunting for what changed after the round trip.
        <p
          id={errorId}
          role="alert"
          className="border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] leading-relaxed text-accent"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full border border-foreground bg-foreground px-3 py-2 text-[13px] font-medium text-background
                   outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground
                   disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
