'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';

/**
 * Something broke inside the shell, and the shell survives it.
 *
 * Because this sits inside app/(dash), the rail and the top bar stay on screen
 * — you can go somewhere else instead of being dumped on a blank page. The
 * previous behaviour was worse than a crash: the report route caught every
 * error and rendered a bare framework 404 saying the page did not exist.
 */
export default function DashError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log has the stack; this ties a user's report to that entry.
    console.error('route error', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center animate-rise">
      <div className="eyebrow mb-2">Something went wrong</div>
      <h1 className="title-lg">This screen didn&rsquo;t load</h1>
      <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
        The measurements are safe — this is a problem rendering the page, not with your data.
        Trying again usually works; if it doesn&rsquo;t, the server log has the details.
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
