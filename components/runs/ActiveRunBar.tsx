'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { RunProgressDTO } from '@/lib/services/types';
import { RunControls } from './RunControls';
import { RunTerminal } from './RunTerminal';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped']);

/**
 * Live progress for whatever is running, on every screen.
 *
 * Polling rather than SSE: the run executes in a separate worker process
 * writing to Postgres, so an SSE handler would poll Postgres and re-emit --
 * identical query load plus a long-lived connection. See docs/PLAN.md.
 */
export function ActiveRunBar() {
  const [runs, setRuns] = useState<RunProgressDTO[]>([]);
  const router = useRouter();
  const wasRunning = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    async function tick() {
      try {
        const res = await fetch('/api/runs/active', { signal: controller.signal, cache: 'no-store' });
        if (res.ok) {
          const { runs: next } = (await res.json()) as { runs: RunProgressDTO[] };
          if (!cancelled) {
            setRuns(next);
            // Refresh the page data once, on the transition to idle, rather
            // than on every poll.
            if (wasRunning.current && next.length === 0) router.refresh();
            wasRunning.current = next.length > 0;
          }
        }
      } catch {
        // A failed poll is not worth surfacing; the next one will recover.
      }
      if (!cancelled) {
        // Faster while something is running, near-idle otherwise.
        const active = runs.some((r) => !TERMINAL.has(r.status));
        timer = setTimeout(tick, active ? 3000 : 12000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (runs.length === 0) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
      {runs.map((r) => (
        <RunRow key={r.runId} run={r} />
      ))}
    </div>
  );
}

function RunRow({ run: r }: { run: RunProgressDTO }) {
  const remaining = r.totalJobs - r.completedJobs;

  /*
   * When everything left is backing off after a PSI failure, the observed-rate
   * ETA is meaningless -- it keeps promising seconds while a job sits on a
   * multi-minute retry, which reads as a hang rather than as the retry policy
   * doing its job. Say what is actually happening instead.
   */
  const allRemainingRetrying = r.retryingJobs > 0 && r.retryingJobs >= remaining;

  let tail: string;
  if (allRemainingRetrying) {
    const s = r.nextRetryInSeconds;
    const when = s === null ? '' : s > 90 ? ` — next attempt in ~${Math.round(s / 60)} min` : ` — retrying in ${s}s`;
    tail = `, ${remaining} retrying after a failed request${when}`;
  } else if (r.etaSeconds !== null) {
    tail = r.etaSeconds > 90 ? `, ~${Math.round(r.etaSeconds / 60)} min left` : `, ~${r.etaSeconds}s left`;
  } else {
    tail = '';
  }

  const held = r.status === 'paused';
  const text = held
    ? `Held at ${r.completedJobs} of ${r.totalJobs}. Nothing is lost — continue when you are ready.`
    : `${r.completedJobs} of ${r.totalJobs} audits complete${
        r.failedJobs > 0 ? `, ${r.failedJobs} failed` : ''
      }${tail}`;

  return (
    <div className="px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Linked, because "something is running" without "where" is the moment
            you actually want to go and look at it. */}
        {r.scopeHref ? (
          <Link href={r.scopeHref} className="shrink-0 text-[11px] font-medium underline-offset-2 hover:underline">
            {r.scopeName ?? r.scopeLabel ?? r.type} ↗
          </Link>
        ) : (
          <span className="shrink-0 text-[11px] font-medium">{r.scopeLabel ?? r.type}</span>
        )}

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={r.totalJobs}
          aria-valuenow={r.completedJobs}
          aria-valuetext={text}
          aria-label={`Audit progress for ${r.scopeLabel ?? r.type}`}
          className="h-1.5 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${r.percentComplete}%`,
              // Amber while waiting on a retry, so a paused run does not look
              // like a healthy one that has simply gone quiet.
              background: held
                ? 'var(--faint)'
                : allRemainingRetrying
                  ? 'var(--score-average)'
                  : 'var(--info)',
            }}
          />
        </div>

        {/* The same string the bar announces, so nothing is read out that isn't visible. */}
        <span className="tnum text-[11px] text-[var(--muted)]">{text}</span>

        <RunControls runId={r.runId} status={r.status} compact />
      </div>

      <RunTerminal runId={r.runId} active={r.status === 'running' || r.status === 'queued'} />
    </div>
  );
}
