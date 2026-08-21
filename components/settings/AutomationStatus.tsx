import { RunHistoryList, type HistoryRun } from '@/components/settings/RunHistoryList';

export interface AutomationHealth {
  schedulerAlive: boolean;
  schedulerLastTickSecondsAgo: number | null;
  scheduleEnabled: boolean;
  cronExpr: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string;
  recentRuns: HistoryRun[];
}

function ago(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

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
 * Answers "is the schedule actually going to run".
 *
 * The scheduler is a Vercel Cron hitting /api/cron/schedule-tick -- if that
 * stops firing, nothing runs with no error and no missed-run record anywhere.
 * That is the worst failure a scheduler can have, and it is exactly what
 * happened once with the old always-on worker process too. Liveness is
 * therefore stated plainly rather than assumed.
 */
export function AutomationStatus({
  health,
  maxAttempts,
  canRetry,
  siteId,
  canDelete,
}: {
  health: AutomationHealth;
  maxAttempts: number;
  canRetry: boolean;
  siteId: string;
  canDelete: boolean;
}) {
  const rows: Array<[string, React.ReactNode, boolean]> = [
    [
      'Scheduler',
      health.schedulerAlive
        ? `checking in · last tick ${ago(health.schedulerLastTickSecondsAgo)}`
        : 'has not checked in yet — nothing will run on a schedule',
      health.schedulerAlive,
    ],
    [
      'Schedule',
      health.scheduleEnabled ? 'on' : 'off — checks only happen when you start them',
      health.scheduleEnabled,
    ],
    [
      'Next check',
      health.scheduleEnabled ? `${when(health.nextRunAt, health.timezone)} (${health.timezone})` : '—',
      health.scheduleEnabled && Boolean(health.nextRunAt),
    ],
    ['Last check', health.lastRunAt ? when(health.lastRunAt, health.timezone) : 'has not run yet', true],
  ];

  return (
    <section className="panel overflow-hidden">
      <div className="px-4 py-3">
        <h2 className="title-md">Is it running?</h2>
      </div>

      <dl className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {rows.map(([label, value, ok]) => (
          <div key={label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: ok ? 'var(--score-pass)' : 'var(--score-average)' }}
            />
            <dt className="w-36 shrink-0 text-[12px] text-[var(--muted)]">{label}</dt>
            <dd className="min-w-0 flex-1 text-[12px]">{value}</dd>
          </div>
        ))}
      </dl>

      {!health.schedulerAlive && (
        <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11px]" style={{ color: 'var(--score-average-text)' }}>
          It should check in daily on its own via the deployment&rsquo;s cron job. If it never has,
          ask whoever manages hosting to verify the cron job is set up.
        </p>
      )}

      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="eyebrow mb-2">Recent checks</div>
        <RunHistoryList
          runs={health.recentRuns}
          timezone={health.timezone}
          siteId={siteId}
          canDelete={canDelete}
          maxAttempts={maxAttempts}
          canRetry={canRetry}
        />
      </div>
    </section>
  );
}
