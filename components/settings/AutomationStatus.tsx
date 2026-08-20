import Link from 'next/link';
import { RunControls } from '@/components/runs/RunControls';
import { FailedPages } from '@/components/runs/FailedPages';

export interface AutomationHealth {
  schedulerAlive: boolean;
  schedulerLastTickSecondsAgo: number | null;
  scheduleEnabled: boolean;
  cronExpr: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string;
  recentRuns: Array<{
    id: string;
    type: string;
    triggeredBy: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    completedJobs: number;
    totalJobs: number;
    failedJobs: number;
  }>;
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
}: {
  health: AutomationHealth;
  maxAttempts: number;
  canRetry: boolean;
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
          It should check in daily on its own via the deployed cron job. If it never has, the cron
          job likely needs setting up — see Settings → Automation in the docs.
        </p>
      )}

      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="eyebrow mb-2">Recent checks</div>
        {health.recentRuns.length === 0 ? (
          <p className="text-[11px] text-[var(--muted)]">
            Nothing has run yet. The first scheduled check will appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {health.recentRuns.map((r) => (
              <li key={r.id} className="text-[11px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="tnum w-32 shrink-0 text-[var(--muted)]">{when(r.startedAt, health.timezone)}</span>
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
                {/* Only renders for a run still in flight; it returns null
                    otherwise, so finished rows stay quiet. */}
                <RunControls runId={r.id} status={r.status} compact />
                </div>
                <FailedPages runId={r.id} count={r.failedJobs} attempts={maxAttempts} canRetry={canRetry} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-[var(--faint)]">
          A running check also shows as a progress bar at the top of every screen, with a link to
          whatever it is measuring. <Link href="/" className="underline">Overview</Link>
        </p>
      </div>
    </section>
  );
}
