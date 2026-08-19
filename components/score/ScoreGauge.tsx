import { scoreBand, BAND_LABEL, BAND_GLYPH, BAND_ARC, BAND_TINT } from './scoreBucket';

const SIZES = { sm: 44, md: 68, lg: 104 } as const;
const R = 56;
const C = 2 * Math.PI * R;

export interface ScoreGaugeProps {
  score: number | null;
  label: string;
  size?: keyof typeof SIZES;
  /** Change vs the previous audit; rendered under the number. */
  delta?: number | null;
}

/**
 * PSI's arc gauge, as pure inline SVG.
 *
 * A Server Component on purpose: a group page renders hundreds of these, and a
 * charting library would turn every one into a client island. Shipping a slow
 * dashboard from a performance tool is a credibility problem, not just a
 * technical one.
 *
 * The numeral is an absolutely-positioned span rather than SVG <text>, because
 * text inside a viewBox scales with the box and stops matching the page's font.
 */
export function ScoreGauge({ score, label, size = 'md', delta = null }: ScoreGaugeProps) {
  const px = SIZES[size];
  const band = scoreBand(score);
  const arc = band ? BAND_ARC[band] : 'var(--score-none)';
  const tint = band ? BAND_TINT[band] : 'var(--score-none-tint)';

  const description = band
    ? `${label}: ${score} out of 100. ${BAND_LABEL[band]}.`
    : `${label}: not audited yet.`;
  const deltaText =
    delta !== null && delta !== 0
      ? ` ${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} points from the previous audit.`
      : '';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: px, height: px }}>
        <svg viewBox="0 0 120 120" width={px} height={px} role="img" aria-label={description + deltaText}>
          <circle cx="60" cy="60" r={R} fill={tint} />
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--gauge-track)" strokeWidth="8" />
          {band && (
            <circle
              cx="60" cy="60" r={R} fill="none"
              stroke={arc} strokeWidth="8" strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - (score ?? 0) / 100)}
              transform="rotate(-90 60 60)"
            />
          )}
          {!band && (
            <circle
              cx="60" cy="60" r={R} fill="none"
              stroke="var(--score-none)" strokeWidth="8"
              strokeDasharray="4 8" opacity="0.5"
            />
          )}
        </svg>
        <span
          aria-hidden="true"
          className="tnum absolute inset-0 flex items-center justify-center font-[family-name:var(--font-display)] font-medium"
          style={{ color: arc, fontSize: px * 0.34 }}
        >
          {score ?? '—'}
        </span>
      </div>

      <div className="text-center leading-tight">
        <div className="text-[11px] text-[var(--muted)]">{label}</div>
        {/* Never colour-only: the glyph and the word both carry the band. */}
        {band && (
          <div aria-hidden="true" className="text-[10px]" style={{ color: arc }}>
            {BAND_GLYPH[band]}
          </div>
        )}
      </div>
    </div>
  );
}
