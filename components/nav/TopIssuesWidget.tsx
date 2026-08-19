import type { TopIssueDTO } from '@/lib/services/types';

/**
 * One shared root cause behind forty pages is worth more than forty individual
 * page scores. This is the widget that finds those.
 *
 * The bar encodes AVERAGE TIME SAVED PER PAGE, not pages affected -- which is
 * the fix for what it used to show. On a site where nearly every issue affects
 * nearly every page, `pagesAffected / max` is 100% on every row, so the bars
 * were identical and carried no information at all. Reach is still stated, as a
 * number, because it is what decides whether a fix is a template change or a
 * one-page change; but the ranking that helps you choose is impact.
 */
function ms(v: number): string {
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)} s`;
}

export function TopIssuesWidget({ issues }: { issues: TopIssueDTO[] }) {
  if (issues.length === 0) {
    return (
      <div className="panel px-4 py-5 text-[12px] text-[var(--muted)]">
        Not enough measured pages yet to rank issues. This fills in after the first full check.
      </div>
    );
  }

  // Per page, so a fix that saves 400 ms on 12 pages is not buried under one
  // that saves 20 ms on 700.
  const withImpact = issues.map((i) => ({
    ...i,
    perPage: i.totalSavingsMs && i.pagesAffected ? i.totalSavingsMs / i.pagesAffected : 0,
  }));
  const maxPerPage = Math.max(...withImpact.map((i) => i.perPage), 1);
  const ranked = [...withImpact].sort((a, b) => b.perPage - a.perPage || b.pagesAffected - a.pagesAffected);
  const anySavings = ranked.some((i) => i.perPage > 0);

  return (
    <ul className="panel-flush divide-y divide-[var(--border)]">
      {ranked.map((i) => {
        const share = i.pagesTotal ? Math.round((i.pagesAffected / i.pagesTotal) * 100) : 0;
        return (
          <li
            key={i.auditId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 transition-colors hover:bg-[var(--surface-subtle)] sm:flex-nowrap"
          >
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12.5px]">{i.title}</span>
                {i.kind === 'opportunity' && (
                  <span
                    className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide"
                    style={{ background: 'var(--score-average-tint)', color: 'var(--score-average-text)' }}
                  >
                    Speed
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                {/* Reach as a share: "on 98% of pages" is the sentence that
                    tells you this is a template fix, not a page fix. */}
                on {share}% of measured pages
                <span className="text-[var(--faint)]"> · {i.pagesAffected} of {i.pagesTotal}</span>
              </div>
            </div>

            {anySavings && (
              <div className="flex w-full shrink-0 items-center gap-2.5 sm:w-52">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (i.perPage / maxPerPage) * 100)}%`,
                      background: i.perPage > 0 ? 'var(--score-average)' : 'var(--score-none)',
                    }}
                  />
                </span>
                <span className="tnum w-14 shrink-0 text-right text-[11.5px] font-medium">
                  {i.perPage > 0 ? ms(i.perPage) : '—'}
                </span>
              </div>
            )}
          </li>
        );
      })}

      {anySavings && (
        <li className="px-4 py-2 text-[11px] text-[var(--faint)]">
          Bars show Lighthouse&rsquo;s estimated saving per page, so a big win on a few pages
          outranks a small one everywhere.
        </li>
      )}
    </ul>
  );
}
