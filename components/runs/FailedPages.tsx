'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { failedResultsAction, retryFailedAction } from '@/app/actions/audits';
import type { FailedResult } from '@/lib/services/run.service';
import { Button } from '@/components/ui/Button';

/**
 * Which pages a run could not measure, and a way to try them again.
 *
 * "8 failed" on its own is an accusation without evidence. These are real rows
 * — a job that runs out of attempts writes an AuditResult with status 'error'
 * and null scores, so the run can still finalize — and each one names the page
 * and what Lighthouse said.
 */
const EXPLAIN: Record<string, string> = {
  RETRIES_EXHAUSTED:
    'Google never returned a result, across every attempt. Usually a page heavy enough to exceed the 90-second limit.',
  ERRORED_DOCUMENT_REQUEST: 'The page itself did not load for Google — a redirect, a block, or a server error.',
  NO_FCP: 'The page never painted anything, so there was nothing to measure.',
  FAILED_DOCUMENT_REQUEST: 'Google could not fetch the URL at all.',
  NOT_HTML: 'The URL did not return an HTML page.',
};

export function FailedPages({
  runId,
  count,
  attempts,
  canRetry,
}: {
  runId: string;
  count: number;
  /** PSI_MAX_ATTEMPTS, so the panel states the real policy rather than a guess. */
  attempts: number;
  canRetry: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FailedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (count === 0) return null;

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (rows) return;
    start(async () => {
      const r = await failedResultsAction({ runId });
      if (r.ok) setRows(r.failures);
      else setError(r.error);
    });
  };

  const retry = () =>
    start(async () => {
      setError(null);
      setNote(null);
      const r = await retryFailedAction({ runId });
      if (!r.ok) setError(r.error);
      else {
        setNote(`Measuring ${r.jobs} again — about ${r.eta}.`);
        router.refresh();
      }
    });

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="rounded-[3px] text-[11px] underline-offset-2 hover:underline"
        style={{ color: 'var(--score-average-text)' }}
      >
        {open ? 'Hide' : 'Show'} the {count} that failed
      </button>

      {open && (
        <div className="mt-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3 animate-fade">
          <p className="mb-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
            Each of these was attempted {attempts} times with a growing delay between tries before
            it was recorded as a failure — the rest of the run carried on regardless.
          </p>

          {pending && !rows && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}

          {rows && (
            <ul className="mb-3 space-y-1.5">
              {rows.map((f, i) => (
                <li key={`${f.pageId}-${f.strategy}-${i}`} className="text-[11px]">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a
                      href={`/p/${f.pageId}?strategy=${f.strategy}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {f.path}
                    </a>
                    <span className="text-[var(--faint)]">{f.strategy}</span>
                  </div>
                  <div className="text-[var(--muted)]">
                    {EXPLAIN[f.error] ?? f.error}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canRetry && (
            <Button size="sm" onClick={retry} disabled={pending}>
              {pending ? 'Starting…' : `Measure these ${count} again`}
            </Button>
          )}

          {note && <p className="mt-2 text-[11px] text-[var(--muted)]">{note}</p>}
          {error && (
            <p role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
