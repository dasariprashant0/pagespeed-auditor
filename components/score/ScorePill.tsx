import { scoreBand, BAND_LABEL, BAND_TEXT, BAND_TINT } from './scoreBucket';

/** Compact score chip for table rows, where a gauge would be far too heavy. */
export function ScorePill({ score, title }: { score: number | null; title?: string }) {
  const band = scoreBand(score);
  const label = band ? `${score} — ${BAND_LABEL[band]}` : 'Not audited';

  return (
    <span
      title={title ? `${title}: ${label}` : label}
      className="tnum inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-[5px] px-1.5 text-[12px] font-medium"
      style={{
        color: band ? BAND_TEXT[band] : 'var(--muted)',
        background: band ? BAND_TINT[band] : 'var(--score-none-tint)',
      }}
    >
      {score ?? '—'}
    </span>
  );
}
