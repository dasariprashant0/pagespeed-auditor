'use client';

import { useActionState, useState } from 'react';
import { saveScheduleAction } from '@/app/actions/settings';

/**
 * Presets over a cron builder. Four options cover every real cadence for a
 * job that takes 35 minutes, and the raw field is there for anyone who wants
 * something else. Validation lives on the server so the UI cannot accept an
 * expression the worker would fail to parse at 3am.
 */
const PRESETS = [
  { label: 'Daily, 3am', cron: '0 3 * * *' },
  { label: 'Weekdays, 3am', cron: '0 3 * * 1-5' },
  { label: 'Weekly, Monday 3am', cron: '0 3 * * 1' },
  { label: 'Monthly, 1st at 3am', cron: '0 3 1 * *' },
];

export function ScheduleForm({
  initial,
}: {
  initial: { cronExpr: string | null; timezone: string; enabled: boolean; nextRunAt: string | null };
}) {
  const [state, action, pending] = useActionState(saveScheduleAction, null);
  const [cron, setCron] = useState(initial.cronExpr ?? '0 3 * * *');

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.cron}
            type="button"
            onClick={() => setCron(p.cron)}
            className={`rounded-[5px] border px-2 py-1 text-[11px] ${
              cron === p.cron
                ? 'border-[var(--border-strong)] bg-[var(--surface-sunken)] font-medium'
                : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-subtle)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[10rem]">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Cron expression</span>
          <input
            name="cronExpr"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[12px]"
          />
        </label>
        <label className="min-w-[9rem]">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Timezone</span>
          <input
            name="timezone"
            defaultValue={initial.timezone || 'Asia/Kolkata'}
            className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
          />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-[12px]">
          <input type="checkbox" name="enabled" defaultChecked={initial.enabled} />
          Enabled
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[5px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {initial.nextRunAt && !state && (
        <p className="text-[11px] text-[var(--muted)]">
          Next run: {new Date(initial.nextRunAt).toLocaleString()}
        </p>
      )}

      {state?.ok === false && (
        <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div className="text-[11px] text-[var(--muted)]">
          <p style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>
          {state.next && state.next.length > 0 && (
            <p className="mt-1">Next: {state.next.slice(0, 3).map((d) => new Date(d).toLocaleString()).join(' · ')}</p>
          )}
        </div>
      )}
    </form>
  );
}
