import Link from 'next/link';
import type { GroupSummaryDTO } from '@/lib/services/types';
import { ScorePill } from '@/components/score/ScorePill';

/**
 * The mean is the headline, but the tail is shown right beside it.
 *
 * An average can hide one catastrophic page, which is the standard objection to
 * using it. The answer here is structural rather than swapping the metric:
 * worst-page links straight to the offender, and the distribution bar shows how
 * many pages sit in each band. Mean for triage, tail for panic.
 * See docs/DECISIONS.md 2.6.
 */
export function GroupCard({ group: g }: { group: GroupSummaryDTO }) {
  const total = Math.max(1, g.distribution.pass + g.distribution.average + g.distribution.fail + g.distribution.unaudited);
  const seg = (n: number) => `${(n / total) * 100}%`;

  return (
    <Link
      href={`/g/${g.slug}`}
      className="block rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-[family-name:var(--font-display)] text-[14px] font-medium">
            {g.name}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
            {g.pageCount} {g.pageCount === 1 ? 'page' : 'pages'}
            {g.auditedCount < g.pageCount && ` · ${g.auditedCount} audited`}
          </div>
        </div>
        <ScorePill score={g.aggregate.performance} title="Average performance" />
      </div>

      <div
        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="img"
        aria-label={`${g.distribution.pass} good, ${g.distribution.average} needs improvement, ${g.distribution.fail} poor, ${g.distribution.unaudited} not audited`}
      >
        <div style={{ width: seg(g.distribution.pass), background: 'var(--score-pass)' }} />
        <div style={{ width: seg(g.distribution.average), background: 'var(--score-average)' }} />
        <div style={{ width: seg(g.distribution.fail), background: 'var(--score-fail)' }} />
      </div>

      {g.worstPerformance !== null && (
        <div className="mt-2 text-[11px] text-[var(--muted)]">
          worst page <span className="tnum font-medium" style={{ color: 'var(--score-fail-text)' }}>{g.worstPerformance}</span>
        </div>
      )}
    </Link>
  );
}
