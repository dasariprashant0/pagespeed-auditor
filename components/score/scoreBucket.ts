/** PSI's own bands, defined once in lib/psi/buckets.ts so every score surface agrees. */
import { scoreBand, type ScoreBand } from '@/lib/psi/buckets';

export { scoreBand, type ScoreBand };

export const BAND_LABEL: Record<ScoreBand, string> = {
  fail: 'Poor',
  average: 'Needs improvement',
  pass: 'Good',
};

/**
 * Lighthouse's own glyphs. They exist so a score is never communicated by
 * colour alone -- which matters on a tool whose whole job is reporting
 * accessibility scores.
 */
export const BAND_GLYPH: Record<ScoreBand, string> = {
  fail: '▲',
  average: '■',
  pass: '●',
};

export const BAND_ARC: Record<ScoreBand, string> = {
  fail: 'var(--score-fail)',
  average: 'var(--score-average)',
  pass: 'var(--score-pass)',
};

export const BAND_TEXT: Record<ScoreBand, string> = {
  fail: 'var(--score-fail-text)',
  average: 'var(--score-average-text)',
  pass: 'var(--score-pass-text)',
};

export const BAND_TINT: Record<ScoreBand, string> = {
  fail: 'var(--score-fail-tint)',
  average: 'var(--score-average-tint)',
  pass: 'var(--score-pass-tint)',
};
