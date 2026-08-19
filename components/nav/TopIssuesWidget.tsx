import type { TopIssueDTO } from '@/lib/services/types';

/**
 * The point of this widget: one shared root cause behind forty pages is worth
 * more than forty individual page scores. Ranked by pages affected, not by
 * savings, because "how widespread" is the question it answers.
 */
export function TopIssuesWidget({ issues }: { issues: TopIssueDTO[] }) {
  if (issues.length === 0) {
    return (
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-4 text-[12px] text-[var(--muted)]">
        Not enough audited pages yet to rank issues. This fills in after the first sweep.
      </div>
    );
  }

  const max = Math.max(...issues.map((i) => i.pagesAffected), 1);

  return (
    <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      {issues.map((i) => (
        <li key={i.auditId} className="flex items-center gap-3 px-3.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px]">{i.title}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(i.pagesAffected / max) * 100}%`,
                  background: i.kind === 'opportunity' ? 'var(--score-average)' : 'var(--score-none)',
                }}
              />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tnum text-[12px] font-medium">{i.pagesAffected}</div>
            <div className="text-[10px] text-[var(--muted)]">
              of {i.pagesTotal} page{i.pagesTotal === 1 ? '' : 's'}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
