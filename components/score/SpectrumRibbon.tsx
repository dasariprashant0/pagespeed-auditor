import { BAND_ARC, scoreBand } from './scoreBucket';

/**
 * The whole site's performance as one continuous trace.
 *
 * This is the tool's signature, and it is the one thing pagespeed.web.dev
 * structurally cannot show: it measures a single page at a time, so the SHAPE
 * of 747 of them is invisible there. A long red shoulder is a systemic problem;
 * a thin red tail is a handful of bad pages. An average hides both.
 *
 * It appears on every screen. On the overview it is tall and interactive; on a
 * section or a page report it collapses to a strip with a marker showing where
 * what you are looking at sits in the whole distribution. That marker is the
 * point -- "this page is worse than 91% of the site" is the context a
 * single-page report can never give you.
 *
 * Server-rendered SVG. A div per page would be a measurable cost on the one
 * screen that reports page weight.
 */
export function SpectrumRibbon({
  scores,
  height = 26,
  /** Scores to mark on the trace -- the pages currently in view. */
  mark = [],
  label,
}: {
  scores: number[];
  height?: number;
  mark?: number[];
  label?: string;
}) {
  const sorted = [...scores].sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const W = 1000;
  const w = W / sorted.length;

  // Where a marked score falls in the distribution. Reported as a percentile
  // rather than a position so the sentence under it is true at any list length.
  const positionOf = (v: number) => {
    let i = 0;
    while (i < sorted.length && sorted[i] < v) i++;
    return i;
  };

  const marks = mark.map((v) => ({ v, x: (positionOf(v) / sorted.length) * W }));

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={label ?? `Performance across ${sorted.length} measured pages, worst to best.`}
    >
      {sorted.map((v, i) => (
        <rect
          key={i}
          x={i * w}
          y={height - Math.max(2, (v / 100) * height)}
          width={Math.max(w - 0.4, 0.5)}
          height={Math.max(2, (v / 100) * height)}
          fill={BAND_ARC[scoreBand(v)!]}
          opacity={marks.length ? 0.5 : 0.85}
        />
      ))}

      {marks.map((m, i) => (
        <g key={i}>
          <line
            x1={m.x} x2={m.x} y1={0} y2={height}
            stroke="var(--foreground)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
          />
          <rect x={m.x - 1.5} y={0} width={3} height={3} fill="var(--foreground)" />
        </g>
      ))}
    </svg>
  );
}

/** The sentence that makes the ribbon mean something on a single-page screen. */
export function rankSentence(scores: number[], value: number | null): string | null {
  if (value === null || scores.length < 8) return null;
  const worseThan = scores.filter((s) => s < value).length;
  const pct = Math.round((worseThan / scores.length) * 100);
  if (pct <= 10) return `Slower than ${100 - pct}% of your pages`;
  if (pct >= 90) return `Faster than ${pct}% of your pages`;
  return `Faster than ${pct}% of your pages`;
}
