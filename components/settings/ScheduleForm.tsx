'use client';

import { useActionState, useState } from 'react';
import { saveScheduleAction } from '@/app/actions/settings';
import {
  choiceToCron, cronToChoice, describeChoice, describeCron, formatHour,
  DAYS, DEFAULT_CHOICE, type Frequency, type ScheduleChoice,
} from '@/lib/services/cronPhrase';

const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays only' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'monthly', label: 'Once a month' },
];

/**
 * A picker, not a cron field.
 *
 * The people who care when the site gets checked are not the people who read
 * cron syntax. The expression is still generated and still submitted -- it is
 * what the worker runs -- but it lives behind an Advanced disclosure, where
 * anyone who does want to hand-write one still can.
 */
export function ScheduleForm({
  initial,
}: {
  initial: { cronExpr: string | null; timezone: string; enabled: boolean; nextRunAt: string | null };
}) {
  const [state, action, pending] = useActionState(saveScheduleAction, null);

  const parsed = cronToChoice(initial.cronExpr);
  const [choice, setChoice] = useState<ScheduleChoice>(parsed ?? DEFAULT_CHOICE);
  // An expression the picker cannot represent must not be silently rewritten.
  const [custom, setCustom] = useState(initial.cronExpr !== null && parsed === null);
  const [customCron, setCustomCron] = useState(initial.cronExpr ?? '0 3 * * *');
  const [enabled, setEnabled] = useState(initial.enabled);

  const cron = custom ? customCron : choiceToCron(choice);
  const set = (patch: Partial<ScheduleChoice>) => setChoice({ ...choice, ...patch });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cronExpr" value={cron} />

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Check the whole site automatically</span>
      </label>

      <div className={enabled ? '' : 'pointer-events-none opacity-45'}>
        {!custom && (
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block text-[11px] text-[var(--muted)]">How often</span>
              <select
                value={choice.frequency}
                onChange={(e) => set({ frequency: e.target.value as Frequency })}
                className="rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
              >
                {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>

            {choice.frequency === 'weekly' && (
              <label>
                <span className="mb-1 block text-[11px] text-[var(--muted)]">On</span>
                <select
                  value={choice.weekday}
                  onChange={(e) => set({ weekday: Number(e.target.value) })}
                  className="rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
                >
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            )}

            {choice.frequency === 'monthly' && (
              <label>
                <span className="mb-1 block text-[11px] text-[var(--muted)]">Day of month</span>
                <select
                  value={choice.monthday}
                  onChange={(e) => set({ monthday: Number(e.target.value) })}
                  className="rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
                >
                  {/* Capped at 28 so the schedule exists in February too. */}
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}

            <label>
              <span className="mb-1 block text-[11px] text-[var(--muted)]">At</span>
              <select
                value={choice.hour}
                onChange={(e) => set({ hour: Number(e.target.value) })}
                className="rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
              >
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Timezone</span>
              <input
                name="timezone"
                defaultValue={initial.timezone || 'Asia/Kolkata'}
                className="w-40 rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
              />
            </label>
          </div>
        )}

        {custom && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[12rem]">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Cron expression</span>
              <input
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[12px]"
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] text-[var(--muted)]">Timezone</span>
              <input
                name="timezone"
                defaultValue={initial.timezone || 'Asia/Kolkata'}
                className="w-40 rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
              />
            </label>
          </div>
        )}

        <p className="mt-3 rounded-[5px] bg-[var(--surface-subtle)] px-3 py-2 text-[12px]">
          <strong>{custom ? describeCron(customCron) : describeChoice(choice)}</strong>
          {initial.nextRunAt && !state && (
            <span className="text-[var(--muted)]"> · next run {new Date(initial.nextRunAt).toLocaleString()}</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[5px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save schedule'}
        </button>
        <button
          type="button"
          onClick={() => { if (!custom) setCustomCron(choiceToCron(choice)); setCustom(!custom); }}
          className="text-[11px] text-[var(--muted)] hover:underline"
        >
          {custom ? 'Back to the simple picker' : 'Write a cron expression instead'}
        </button>
      </div>

      {state?.ok === false && (
        <p role="alert" className="text-[12px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>
      )}
      {state?.ok && (
        <div className="text-[12px]">
          <p style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>
          {state.next && state.next.length > 0 && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Next three: {state.next.slice(0, 3).map((d) => new Date(d).toLocaleString()).join(' · ')}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
