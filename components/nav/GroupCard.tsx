import Link from 'next/link';
import type { GroupSummaryDTO } from '@/lib/services/types';

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
      className="panel group block p-4 transition-all hover:border-[var(--border-strong)] hover:shadow-[var(--lift)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="title-md truncate">{g.name}</div>
          <div className="mt-1 text-[11px] text-[var(--muted)]">
            {g.pageCount} {g.pageCount === 1 ? 'page' : 'pages'}
            {g.auditedCount < g.pageCount && ` · ${g.auditedCount} measured`}
          </div>
        </div>
        {/* The score is the largest thing on the card: it is what the card is for. */}
        <div className="shrink-0 text-right">
          <div
            className="metric text-[28px]"
            style={{ color: g.aggregate.performance === null ? 'var(--faint)' : undefined }}
          >
            {g.aggregate.performance ?? '—'}
          </div>
          <div className="eyebrow mt-0.5">avg</div>
        </div>
      </div>

      <div
        className="mt-3.5 flex h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="img"
        aria-label={`${g.distribution.pass} good, ${g.distribution.average} needs improvement, ${g.distribution.fail} poor, ${g.distribution.unaudited} not audited`}
      >
        <div style={{ width: seg(g.distribution.pass), background: 'var(--score-pass)' }} />
        <div style={{ width: seg(g.distribution.average), background: 'var(--score-average)' }} />
        <div style={{ width: seg(g.distribution.fail), background: 'var(--score-fail)' }} />
      </div>

      {g.worstPerformance !== null && (
        <div className="mt-2.5 flex items-baseline gap-1.5 text-[11px] text-[var(--muted)]">
          <span>worst</span>
          <span className="tnum font-medium" style={{ color: 'var(--score-fail-text)' }}>
            {g.worstPerformance}
          </span>
        </div>
      )}
    </Link>
  );
}
