import type { PageRunHistoryEntry } from '@/lib/services/results.service';
import { ScorePill } from '@/components/score/ScorePill';

/**
 * Every retained run for this page.
 *
 * The reason this exists rather than only a sparkline: after a month of weekly
 * checks you want to see the individual runs, when each happened, and which one
 * a change landed in.
 */
export function RunHistoryTable({ entries, keepRuns }: { entries: PageRunHistoryEntry[]; keepRuns: number }) {
  if (entries.length === 0) {
    return <p className="text-[12px] text-[var(--muted)]">No runs recorded yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
        <table className="w-full border-collapse bg-[var(--surface)] text-[12px]">
          <caption className="sr-only">Audit history for this page</caption>
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <th scope="col" className="px-3 py-2 font-medium">When</th>
              <th scope="col" className="px-2 py-2 font-medium">Trigger</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Perf</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Change</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">A11y</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">LCP</th>
              <th scope="col" className="px-2 py-2 font-medium">Advice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {entries.map((e) => (
              <tr key={e.resultId} className="hover:bg-[var(--surface-subtle)]">
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal">
                  {new Date(e.at).toLocaleString(undefined, {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </th>
                <td className="px-2 py-1.5 text-[var(--muted)]">
                  {e.triggeredBy === 'schedule' ? 'scheduled' : 'manual'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {e.status === 'error' ? (
                    <span className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>
                      {e.runtimeError ?? 'failed'}
                    </span>
                  ) : (
                    <ScorePill score={e.scores.performance} title="Performance" />
                  )}
                </td>
                <td className="tnum px-2 py-1.5 text-right">
                  {e.performanceDelta === null || e.performanceDelta === 0 ? (
                    <span className="text-[var(--muted)]">—</span>
                  ) : (
                    <span style={{ color: e.performanceDelta > 0 ? 'var(--score-pass-text)' : 'var(--score-fail-text)' }}>
                      {e.performanceDelta > 0 ? '▲' : '▼'} {Math.abs(e.performanceDelta)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right"><ScorePill score={e.scores.accessibility} title="Accessibility" /></td>
                <td className="tnum px-2 py-1.5 text-right text-[var(--muted)]">
                  {e.lcp === null ? '—' : e.lcp < 1000 ? `${Math.round(e.lcp)}ms` : `${(e.lcp / 1000).toFixed(1)}s`}
                </td>
                <td className="px-2 py-1.5 text-[11px] text-[var(--muted)]">
                  {e.hasRecommendation ? 'saved' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--muted)]">
        The last {keepRuns} runs per page are kept, with their reports and advice. Older ones are removed.
      </p>
    </div>
  );
}
