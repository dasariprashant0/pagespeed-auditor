'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RunControls } from '@/components/runs/RunControls';
import { FailedPages } from '@/components/runs/FailedPages';
import { deleteRunsAction } from '@/app/actions/site';

export interface HistoryRun {
  id: string;
  type: string;
  triggeredBy: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  completedJobs: number;
  totalJobs: number;
  failedJobs: number;
}

const ACTIVE = new Set(['queued', 'running', 'paused']);

function when(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/**
 * "Recent checks", plus the ability to pick specific ones and delete them.
 *
 * A run still in flight has no checkbox at all -- deleting its row out from
 * under a workflow step that is still writing to it would break the FK the
 * step depends on mid-run, not just lose history (see retention.service.ts).
 */
export function RunHistoryList({
  runs,
  timezone,
  siteId,
  canDelete,
  maxAttempts,
  canRetry,
}: {
  runs: HistoryRun[];
  timezone: string;
  siteId: string;
  canDelete: boolean;
  maxAttempts: number;
  canRetry: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const deletableIds = useMemo(() => runs.filter((r) => !ACTIVE.has(r.status)).map((r) => r.id), [runs]);
  const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(deletableIds));
  }

  function runDelete() {
    start(async () => {
      setError(null);
      setMessage(null);
      const r = await deleteRunsAction(siteId, [...selected]);
      setConfirming(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSelected(new Set());
      setMessage(r.message);
      router.refresh();
    });
  }

  if (runs.length === 0) {
    return <p className="text-[11px] text-[var(--muted)]">Nothing has run yet. The first scheduled check will appear here.</p>;
  }

  return (
    <>
      {canDelete && deletableIds.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2 text-[11px]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={pending} />
            Select all
          </label>
          <span className="text-[var(--muted)]">{selected.size} selected</span>

          {selected.size > 0 &&
            (confirming ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={runDelete}
                  disabled={pending}
                  className="rounded-[5px] border px-2 py-[3px] font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  {pending ? 'Deleting…' : `Delete ${selected.size} for good`}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-[var(--muted)] hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-[5px] border border-transparent px-2 py-[3px] font-medium text-[var(--muted)] hover:text-[var(--danger)]"
              >
                Delete selected
              </button>
            ))}
        </div>
      )}

      {message && (
        <p className="mb-2 text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{message}</p>
      )}
      {error && (
        <p role="alert" className="mb-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{error}</p>
      )}

      <ul className="space-y-1">
        {runs.map((r) => {
          const active = ACTIVE.has(r.status);
          return (
            <li key={r.id} className="text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {canDelete && (
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    disabled={active || pending}
                    title={active ? 'Still in progress — cannot be deleted yet' : undefined}
                    className="shrink-0"
                  />
                )}
                <span className="tnum w-32 shrink-0 text-[var(--muted)]">{when(r.startedAt, timezone)}</span>
                <span className="w-24 shrink-0">
                  {r.type === 'full_sweep' ? 'whole site' : r.type === 'group' ? 'a section' : 'one page'}
                </span>
                <span className="w-20 shrink-0 text-[var(--muted)]">
                  {r.triggeredBy === 'schedule' ? 'scheduled' : 'manual'}
                </span>
                <span
                  className="tnum"
                  style={{
                    color:
                      r.status === 'failed'
                        ? 'var(--score-fail-text)'
                        : r.status === 'completed'
                          ? 'var(--score-pass-text)'
                          : 'var(--muted)',
                  }}
                >
                  {r.status} {r.completedJobs}/{r.totalJobs}
                  {r.failedJobs > 0 && ` · ${r.failedJobs} failed`}
                </span>
                {/* Only renders for a run still in flight; it returns null otherwise. */}
                <RunControls runId={r.id} status={r.status} compact />
              </div>
              <FailedPages runId={r.id} count={r.failedJobs} attempts={maxAttempts} canRetry={canRetry} />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-[var(--faint)]">
        A running check also shows as a progress bar at the top of every screen, with a link to
        whatever it is measuring. <Link href="/" className="underline">Overview</Link>
      </p>
    </>
  );
}
