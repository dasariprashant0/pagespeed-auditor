import { bucketOf, BUCKET_LABEL } from '@/lib/psi/buckets';
import type { Bucket } from '@/lib/psi/types';

const BUCKET_COLOR: Record<Bucket, string> = {
  good: 'var(--score-pass-text)',
  ni: 'var(--score-average-text)',
  poor: 'var(--score-fail-text)',
};

export interface LabMetrics {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
  tbt: number | null;
  speedIndex: number | null;
}

const fmtMs = (v: number | null) =>
  v === null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;

export function CWVGrid({ lab }: { lab: LabMetrics }) {
  const rows: Array<{ id: keyof LabMetrics; label: string; core: boolean }> = [
    { id: 'lcp', label: 'LCP', core: true },
    { id: 'inp', label: 'INP', core: true },
    { id: 'cls', label: 'CLS', core: true },
    { id: 'fcp', label: 'FCP', core: false },
    { id: 'ttfb', label: 'TTFB', core: false },
    { id: 'tbt', label: 'TBT', core: false },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {rows.map(({ id, label, core }) => {
        const value = lab[id];

        // INP is field-only: Lighthouse lab runs never produce it. Saying so
        // explicitly beats a bare em-dash that reads like a bug, and it is why
        // TBT is never quietly shown under an INP label.
        if (id === 'inp' && value === null) {
          return (
            <div key={id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-[11px] text-[var(--muted)]">INP {core && '· Core'}</div>
              <div className="tnum mt-1 text-[15px] text-[var(--muted)]">—</div>
              <div className="mt-0.5 text-[10px] leading-tight text-[var(--muted)]">
                Not measurable in lab{lab.tbt !== null && ` · TBT ${fmtMs(lab.tbt)} is the proxy`}
              </div>
            </div>
          );
        }

        const bucket = bucketOf(id === 'speedIndex' ? 'fcp' : (id as 'lcp'), value);
        const display = id === 'cls' ? (value === null ? '—' : value.toFixed(3)) : fmtMs(value);

        return (
          <div key={id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="text-[11px] text-[var(--muted)]">
              {label} {core && '· Core'}
            </div>
            <div className="tnum mt-1 text-[15px] font-medium" style={{ color: bucket ? BUCKET_COLOR[bucket] : 'var(--muted)' }}>
              {display}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--muted)]">
              {bucket ? BUCKET_LABEL[bucket] : 'No data'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
