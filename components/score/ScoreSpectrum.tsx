import { BAND_ARC, scoreBand } from './scoreBucket';

export interface SpectrumPage {
  id: string;
  path: string;
  score: number | null;
}

/**
 * Every page on the site as one strip, sorted worst to best.
 *
 * This is the thing pagespeed.web.dev cannot show: it measures one page at a
 * time, and the interesting question here is the SHAPE of 747 of them. A long
 * red shoulder means a systemic problem; a thin red tail means a handful of bad
 * pages. An average hides both.
 *
 * Server-rendered SVG rather than 747 DOM nodes -- a div per page would be a
 * measurable cost on the very screen that reports page weight.
 */
export function ScoreSpectrum({ pages, height = 56 }: { pages: SpectrumPage[]; height?: number }) {
  const audited = pages.filter((p) => p.score !== null).sort((a, b) => a.score! - b.score!);
  const unaudited = pages.length - audited.length;

  if (audited.length === 0) {
    return (
      <div className="panel flex items-center justify-center px-4 py-6 text-[12px] text-[var(--muted)]">
        No pages measured yet — the spectrum fills in as audits complete.
      </div>
    );
  }

  const W = 1000;
  const w = W / audited.length;
  const counts = { fail: 0, average: 0, pass: 0 };
  for (const p of audited) {
    const b = scoreBand(p.score);
    if (b) counts[b]++;
  }

  const median = audited[Math.floor(audited.length / 2)].score!;
  const medianX = (Math.floor(audited.length / 2) / audited.length) * W;

  return (
    <div className="panel overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`${audited.length} pages measured: ${counts.fail} poor, ${counts.average} needs work, ${counts.pass} good. Median score ${median}.`}
      >
        {audited.map((p, i) => {
          const band = scoreBand(p.score);
          // Bar height encodes the score as well as colour, so the shape is
          // still readable in greyscale or to a colourblind reader.
          const h = Math.max(2, (p.score! / 100) * (height - 8));
          return (
            <rect
              key={p.id}
              x={i * w}
              y={height - h}
              width={Math.max(w - 0.5, 0.6)}
              height={h}
              fill={band ? BAND_ARC[band] : 'var(--score-none)'}
              opacity={0.9}
            />
          );
        })}
        <line x1={medianX} x2={medianX} y1={0} y2={height} stroke="var(--foreground)" strokeWidth="1" opacity="0.35" />
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--border)] px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {([
            ['fail', 'Poor', counts.fail],
            ['average', 'Needs work', counts.average],
            ['pass', 'Good', counts.pass],
          ] as const).map(([band, label, n]) => (
            <span key={band} className="flex items-center gap-1.5 text-[11px]">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: BAND_ARC[band] }} aria-hidden="true" />
              <span className="tnum font-medium">{n}</span>
              <span className="text-[var(--muted)]">{label}</span>
            </span>
          ))}
          {unaudited > 0 && (
            <span className="text-[11px] text-[var(--faint)]">
              <span className="tnum">{unaudited}</span> not measured
            </span>
          )}
        </div>
        <span className="text-[11px] text-[var(--muted)]">
          median <span className="tnum font-medium text-[var(--foreground)]">{median}</span>
        </span>
      </div>
    </div>
  );
}
