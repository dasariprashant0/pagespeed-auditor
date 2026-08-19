import { BAND_ARC, scoreBand } from '@/components/score/scoreBucket';

/**
 * The spectrum, shown to someone who has not signed in yet.
 *
 * Deliberately an illustration of the SHAPE, not a reading: no numbers, no axis
 * and aria-hidden, so it can never be mistaken for a measurement of anyone's
 * site. What it communicates is the one idea the product turns on — hundreds of
 * pages sorted worst to best, and the red shoulder is where the work is.
 */
const CURVE = [
  18, 21, 24, 26, 29, 31, 33, 36, 38, 41, 43, 45, 47, 48, 50, 52, 54, 55, 57, 58,
  60, 61, 63, 64, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
  82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 99, 100,
];

export function BrandTrace() {
  const W = 600;
  const H = 84;
  const w = W / CURVE.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: H }}
        aria-hidden="true"
      >
        {CURVE.map((v, i) => (
          <rect
            key={i}
            x={i * w}
            y={H - (v / 100) * H}
            width={w - 1.5}
            height={(v / 100) * H}
            rx={1}
            fill={BAND_ARC[scoreBand(v)!]}
            opacity={0.9}
          />
        ))}
      </svg>

      <div className="mt-3 flex items-center gap-4">
        {([
          ['fail', 'Poor'],
          ['average', 'Needs work'],
          ['pass', 'Good'],
        ] as const).map(([band, label]) => (
          <span key={band} className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-[2px]"
              style={{ background: BAND_ARC[band] }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
