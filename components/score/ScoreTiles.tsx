import { ScoreGauge } from './ScoreGauge';
import type { FourScores } from '@/lib/services/types';

const KEYS = [
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'bestPractices', label: 'Best practices' },
  { key: 'seo', label: 'SEO' },
] as const;

/**
 * The four headline scores, as PSI's own gauges.
 *
 * They used to be four naked numerals in a row, which read like a debug dump:
 * no ring, no track, no band, nothing that says 59 is bad and 91 is fine. The
 * arc is the one piece of Lighthouse's visual language the team already reads
 * without thinking, so this is the wrong place to be original.
 */
export function ScoreTiles({
  scores,
  previous,
  size = 'md',
  caption,
}: {
  scores: FourScores;
  previous?: FourScores | null;
  size?: 'sm' | 'md' | 'lg';
  caption?: React.ReactNode;
}) {
  return (
    <div className="panel px-5 py-4">
      {/* A 2x2 grid on a narrow screen rather than flex-wrap, which stranded
          the fourth gauge alone on its own row. */}
      <div className="grid grid-cols-2 items-start gap-x-4 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-8">
        {KEYS.map(({ key, label }) => (
          <ScoreGauge
            key={key}
            score={scores[key]}
            label={label}
            size={size}
            delta={
              previous && previous[key] !== null && scores[key] !== null
                ? scores[key]! - previous[key]!
                : null
            }
          />
        ))}
        {caption && (
          <div className="col-span-2 max-w-[19rem] text-[11.5px] leading-relaxed text-[var(--muted)] sm:ml-auto sm:self-center">
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}
