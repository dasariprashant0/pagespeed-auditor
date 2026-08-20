'use client';

import { useActionState, useEffect, useOptimistic, useState, useTransition } from 'react';
import { saveScheduleAction, previewCronAction } from '@/app/actions/settings';
import {
  choiceToCron, cronToChoice, describeChoice, describeCron, toTimeValue, fromTimeValue,
  DAYS, DEFAULT_CHOICE, type Frequency, type ScheduleChoice,
} from '@/lib/services/cronPhrase';

const FREQUENCIES: Array<{ value: Frequency; label: string }> = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays only' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'monthly', label: 'Once a month' },
];

const field =
  'rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px]';

/** An unknown timezone must not blank the preview; fall back to the browser's. */
function formatInZone(iso: string, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  };
  try {
    return new Date(iso).toLocaleString('en-GB', { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleString('en-GB', opts);
  }
}

/**
 * A picker, not a cron field.
 *
 * The people who care when their site gets checked are not the people who read
 * cron syntax. The expression is still what runs, and is still editable behind
 * a toggle, but the default surface is a frequency, a day and a clock.
 *
 * Time is a real <input type="time"> rather than a list of whole hours: "01:25"
 * is an ordinary thing to want, and offering only o'clock was a limitation the
 * scheduler never had.
 */
export function ScheduleForm({
  initial,
  canEdit,
}: {
  initial: { cronExpr: string | null; timezone: string; enabled: boolean; nextRunAt: string | null };
  /** automation:manage. Visible to everyone regardless; this only decides
   * whether the controls below actually accept input. */
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveScheduleAction, null);

  const parsed = cronToChoice(initial.cronExpr);
  const [choice, setChoice] = useState<ScheduleChoice>(parsed ?? DEFAULT_CHOICE);
  // An expression the picker cannot represent is preserved, never silently
  // rewritten into something simpler.
  const [custom, setCustom] = useState(initial.cronExpr !== null && parsed === null);
  const [customCron, setCustomCron] = useState(initial.cronExpr ?? '0 3 * * *');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);
  const [enabledError, setEnabledError] = useState<string | null>(null);
  const [, startEnabledTransition] = useTransition();
  const [timezone, setTimezone] = useState(initial.timezone || 'Asia/Kolkata');
  const [preview, setPreview] = useState<{ valid: boolean; error?: string; next: string[] } | null>(null);

  const cron = custom ? customCron : choiceToCron(choice);

  // Shows the real fire times as you change it, so "starting today" is a fact
  // on screen rather than something to be trusted.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await previewCronAction(cron, timezone);
        if (!cancelled) setPreview(r);
      } catch {
        /* preview is a convenience; the server validates on save regardless */
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [cron, timezone]);

  const set = (patch: Partial<ScheduleChoice>) => setChoice({ ...choice, ...patch });

  /**
   * The on/off switch alone saves itself, instantly and in the background --
   * the frequency/day/time picker below it still needs the explicit "Save
   * schedule" button, because those are deliberate configuration, not a
   * single low-stakes flip. useOptimistic shows the new value right away;
   * if the save fails, NOT updating `enabled` is what makes it snap back on
   * its own once the transition settles, rather than needing a manual revert.
   */
  function toggleEnabled(next: boolean) {
    startEnabledTransition(async () => {
      setOptimisticEnabled(next);
      setEnabledError(null);
      const fd = new FormData();
      fd.set('cronExpr', cron);
      fd.set('timezone', timezone);
      if (next) fd.set('enabled', 'on');
      const r = await saveScheduleAction(null, fd);
      if (r.ok) setEnabled(next);
      else setEnabledError(r.error);
    });
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cronExpr" value={cron} />
      <input type="hidden" name="timezone" value={timezone} />

      <fieldset disabled={!canEdit} className="space-y-4">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="enabled" checked={optimisticEnabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        <span>Check the whole site automatically</span>
      </label>
      {enabledError && (
        <p role="alert" className="-mt-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{enabledError}</p>
      )}

      <div className={optimisticEnabled ? '' : 'pointer-events-none opacity-45'}>
        {!custom ? (
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="eyebrow mb-1 block">How often</span>
              <select value={choice.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })} className={field}>
                {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>

            {choice.frequency === 'weekly' && (
              <label>
                <span className="eyebrow mb-1 block">On</span>
                <select value={choice.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} className={field}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            )}

            {choice.frequency === 'monthly' && (
              <label>
                <span className="eyebrow mb-1 block">Day of month</span>
                <select value={choice.monthday} onChange={(e) => set({ monthday: Number(e.target.value) })} className={field}>
                  {/* Capped at 28 so the schedule exists in February too. */}
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}

            <label>
              <span className="eyebrow mb-1 block">At</span>
              <input
                type="time"
                value={toTimeValue(choice.hour, choice.minute)}
                onChange={(e) => {
                  const t = fromTimeValue(e.target.value);
                  if (t) set(t);
                }}
                className={`${field} tnum`}
              />
            </label>

            <label>
              <span className="eyebrow mb-1 block">Timezone</span>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${field} w-40`} />
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[12rem] flex-1">
              <span className="eyebrow mb-1 block">Cron expression</span>
              <input value={customCron} onChange={(e) => setCustomCron(e.target.value)} className={`${field} w-full font-mono`} />
            </label>
            <label>
              <span className="eyebrow mb-1 block">Timezone</span>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${field} w-40`} />
            </label>
          </div>
        )}

        <div className="mt-3 rounded-[6px] bg-[var(--surface-subtle)] px-3 py-2.5">
          <p className="text-[12px] font-medium">
            {custom ? describeCron(customCron) : describeChoice(choice)}
          </p>

          {preview?.valid && preview.next.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {preview.next.slice(0, 3).map((d, i) => (
                <li key={d} className="text-[11px] text-[var(--muted)]">
                  {i === 0 ? 'Next: ' : ''}
                  <span className={i === 0 ? 'font-medium text-[var(--foreground)]' : ''}>
                    {/*
                      Rendered in the SCHEDULE's timezone, not the browser's.
                      Someone setting 01:25 Asia/Kolkata from a laptop in another
                      zone would otherwise be shown a different wall-clock time
                      than the one they just typed.
                    */}
                    {formatInZone(d, timezone)}
                  </span>
                  {i === 0 && <span className="ml-1 text-[var(--faint)]">({timezone})</span>}
                </li>
              ))}
            </ul>
          ) : preview && !preview.valid ? (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{preview.error}</p>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--faint)]">Working out the next run…</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || (preview !== null && !preview.valid)}
          className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
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
      </fieldset>

      {!canEdit && (
        <p className="text-[11px] text-[var(--muted)]">Only an admin can change the schedule.</p>
      )}

      {state?.ok === false && (
        <p role="alert" className="text-[12px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-[12px]" style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>
      )}
    </form>
  );
}
