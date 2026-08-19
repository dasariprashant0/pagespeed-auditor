import type { SparkPoint } from '@/lib/services/types';
import { scoreBand, BAND_ARC } from '@/components/score/scoreBucket';

/**
 * Score history as inline SVG. Server-rendered, ~40 lines, no dependency.
 *
 * Fixed 0-100 domain on purpose: a per-series auto-domain makes a 78-to-80
 * wiggle look like a cliff, and these sit next to each other where they must be
 * comparable.
 */
export function ScoreHistory({
  history,
  label,
}: {
  history: SparkPoint[];
  label: string;
}) {
  const points = history.filter((p) => p.v !== null);

  if (points.length < 2) {
    return (
      <div className="text-[11px] text-[var(--muted)]">
        {points.length === 1 ? 'Only one audit so far — a trend needs at least two.' : 'No history yet.'}
      </div>
    );
  }

  const W = 240;
  const H = 44;
  const PAD = 3;
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2);

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v!).toFixed(1)}`).join(' ');
  const last = points[points.length - 1].v!;
  const first = points[0].v!;
  const band = scoreBand(last);
  const stroke = band ? BAND_ARC[band] : 'var(--score-none)';
  const change = last - first;

  const summary = `${label} over the last ${points.length} audits: ${first} to ${last}, ${
    change > 0 ? 'improving' : change < 0 ? 'declining' : 'flat'
  }.`;

  return (
    <div className="flex items-center gap-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="max-w-full">
        {/* The two PSI thresholds, so a line is readable without an axis. */}
        {[50, 90].map((t) => (
          <line key={t} x1={PAD} x2={W - PAD} y1={y(t)} y2={y(t)}
            stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" />
        ))}
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"
          vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(last)} r="2.5" fill={stroke} />
      </svg>

      <div className="text-[11px] text-[var(--muted)]">
        <span className="tnum">{first}</span> → <span className="tnum font-medium" style={{ color: stroke }}>{last}</span>
        {change !== 0 && (
          <span className="tnum ml-1">({change > 0 ? '+' : ''}{change})</span>
        )}
        <div className="text-[10px]">{points.length} audits</div>
      </div>
    </div>
  );
}
