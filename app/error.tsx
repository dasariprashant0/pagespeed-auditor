'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';

/**
 * Root-level backstop.
 *
 * app/(dash)/error.tsx already covers everything under the dashboard shell,
 * but a segment's own error.tsx never catches an error thrown by that same
 * segment's layout (Next.js semantics) -- so a crash in app/(dash)/layout.tsx
 * itself falls through to here instead. Kept intentionally minimal: this has
 * no shell to preserve, just a way back and a way to retry.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('root route error', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center animate-rise">
      <div className="eyebrow mb-2">Something went wrong</div>
      <h1 className="title-lg">This page didn&rsquo;t load</h1>
      <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
        Your measurements are safe — this is a problem rendering the page. Trying
        again usually works; if it doesn&rsquo;t, the server log has the details.
      </p>

      {error.digest && (
        <p className="mt-3 text-[11px] text-[var(--faint)]">
          Reference <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5">{error.digest}</code>
        </p>
      )}

      <div className="mt-5 flex items-center justify-center gap-2">
        <Button variant="primary" onClick={reset}>Try again</Button>
        <ButtonLink href="/" variant="secondary">Back to overview</ButtonLink>
      </div>
    </div>
  );
}
