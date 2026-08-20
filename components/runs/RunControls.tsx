'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { controlRunAction } from '@/app/actions/runControl';

/**
 * Hold, continue, or stop a run in flight.
 *
 * Stopping asks first and says what it costs, because a whole-site sweep is
 * ~35 minutes of quota and the button sits next to two harmless ones.
 */
export function RunControls({
  runId,
  status,
  compact = false,
}: {
  runId: string;
  status: string;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  // Flips the button and hides a stopped run's controls the instant an
  // action is clicked, without waiting on router.refresh()'s round trip. If
  // the server call fails, NOT updating `status` (the real prop) is what
  // snaps this back to the true state on its own once the transition ends.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  if (!['queued', 'running', 'paused'].includes(optimisticStatus)) return null;

  const act = (action: 'pause' | 'resume' | 'stop') =>
    start(async () => {
      setError(null);
      setNote(null);
      setOptimisticStatus(action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled');
      const r = await controlRunAction({ runId, action });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfirming(false);
      if (action === 'pause') {
        setNote(
          r.inFlight > 0
            ? `Held. ${r.pending} pages are waiting; the ${r.inFlight} already started will still finish.`
            : `Held. ${r.pending} pages are waiting.`,
        );
      }
      router.refresh();
    });

  const btn =
    'rounded-[5px] border px-2 py-[3px] text-[11px] font-medium transition-colors disabled:opacity-50';

  return (
    <span className={compact ? 'flex items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
      {optimisticStatus === 'paused' ? (
        <button
          type="button" onClick={() => act('resume')} disabled={pending}
          className={`${btn} border-[var(--border-strong)] hover:bg-[var(--surface-subtle)]`}
        >
          <span aria-hidden="true">▶</span> Continue
        </button>
      ) : (
        <button
          type="button" onClick={() => act('pause')} disabled={pending}
          className={`${btn} border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]`}
        >
          <span aria-hidden="true">❙❙</span> Hold
        </button>
      )}

      {confirming ? (
        <span className="flex items-center gap-1.5">
          <button
            type="button" onClick={() => act('stop')} disabled={pending}
            className={`${btn} border-[var(--danger)]`}
            style={{ color: 'var(--danger)' }}
          >
            Stop for good
          </button>
          <button
            type="button" onClick={() => setConfirming(false)} disabled={pending}
            className="text-[11px] text-[var(--muted)] hover:underline"
          >
            Keep going
          </button>
        </span>
      ) : (
        <button
          type="button" onClick={() => setConfirming(true)} disabled={pending}
          className={`${btn} border-transparent text-[var(--muted)] hover:text-[var(--danger)]`}
        >
          Stop
        </button>
      )}

      {confirming && !compact && (
        <span className="text-[11px] text-[var(--muted)]">
          Results already measured are kept; the rest is dropped and the quota is not refunded.
        </span>
      )}
      {note && <span className="text-[11px] text-[var(--muted)]">{note}</span>}
      {error && (
        <span role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{error}</span>
      )}
    </span>
  );
}
