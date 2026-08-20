import type { FieldDataDTO } from '@/lib/services/types';
import { BUCKET_LABEL } from '@/lib/psi/buckets';
import type { Bucket } from '@/lib/psi/types';

const COLOR: Record<Bucket, string> = {
  good: 'var(--score-pass-text)',
  ni: 'var(--score-average-text)',
  poor: 'var(--score-fail-text)',
};

const ORDER = [
  ['lcp', 'LCP'],
  ['inp', 'INP'],
  ['cls', 'CLS'],
  ['fcp', 'FCP'],
  ['ttfb', 'TTFB'],
] as const;

/**
 * Absent field data is a NORMAL state, not an error.
 *
 * Most pages on a large site never get enough traffic for CrUX to report on
 * them individually. Rendering that as a red failure would train people to
 * ignore a whole panel. Origin-fallback data gets its own visibly distinct
 * treatment, because presenting site-wide numbers as page numbers would make a
 * thin page look great on figures it did not earn.
 */
export function FieldDataPanel({ field }: { field: FieldDataDTO }) {
  if (field.source === 'none') {
    return (
      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[12px] text-[var(--muted)]">
        Not enough real-user data for this URL. Chrome UX Report needs roughly 28 days of
        sufficient traffic before it reports on a specific page — the lab metrics below are
        still accurate.
      </div>
    );
  }

  const isFallback = field.source === 'origin_fallback';
  // Google's own pass/fail line: overall_category is FAST only when LCP, INP
  // and CLS are ALL "good" at p75 -- the same rule pagespeed.web.dev's
  // "Core Web Vitals Assessment" banner uses. FCP/TTFB below are diagnostic,
  // not part of that assessment, so this reuses field.overall rather than
  // re-deriving anything.
  const passed = field.overall === 'good';

  return (
    <div
      className="rounded-[8px] border bg-[var(--surface)]"
      style={{
        borderColor: 'var(--border)',
        borderLeftWidth: isFallback ? 3 : 1,
        borderLeftStyle: isFallback ? 'dotted' : 'solid',
        borderLeftColor: isFallback ? 'var(--score-average)' : 'var(--border)',
      }}
    >
      {field.overall && (
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
          <span className="text-[12px] font-medium">Core Web Vitals</span>
          <span
            className="inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-medium"
            style={{
              color: passed ? 'var(--score-pass-text)' : 'var(--score-fail-text)',
              background: passed ? 'var(--score-pass-tint)' : 'var(--score-fail-tint)',
            }}
          >
            {passed ? 'Passed' : 'Failed'}
          </span>
        </div>
      )}
      {isFallback && (
        <p className="border-b border-[var(--border)] px-3.5 py-2 text-[11px] text-[var(--muted)]">
          Showing site-wide real-user data — this page does not have enough traffic of its own.
        </p>
      )}
      <div className="grid gap-2 p-3 sm:grid-cols-5">
        {ORDER.map(([id, label]) => {
          const m = field.metrics[id];
          const display = m ? (id === 'cls' ? m.value.toFixed(3) : m.value < 1000 ? `${Math.round(m.value)} ms` : `${(m.value / 1000).toFixed(1)} s`) : '—';
          return (
            <div key={id}>
              <div className="text-[11px] text-[var(--muted)]">{label}</div>
              <div className="tnum mt-0.5 text-[14px] font-medium" style={{ color: m ? COLOR[m.bucket] : 'var(--muted)' }}>
                {display}
              </div>
              <div className="text-[10px] text-[var(--muted)]">
                {m ? BUCKET_LABEL[m.bucket] : 'Not enough samples'}
              </div>

              {/* PSI's distribution bar: what share of real visits landed in
                  each band. The 75th percentile alone hides a bimodal page. */}
              {m?.distribution && (
                <div
                  className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
                  role="img"
                  aria-label={`${Math.round(m.distribution[0] * 100)}% good, ${Math.round(m.distribution[1] * 100)}% needs improvement, ${Math.round(m.distribution[2] * 100)}% poor`}
                >
                  <div style={{ width: `${m.distribution[0] * 100}%`, background: 'var(--score-pass)' }} />
                  <div style={{ width: `${m.distribution[1] * 100}%`, background: 'var(--score-average)' }} />
                  <div style={{ width: `${m.distribution[2] * 100}%`, background: 'var(--score-fail)' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
