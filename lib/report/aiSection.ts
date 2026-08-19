/**
 * Manages the "## AI Recommendation" block inside a stored markdown report.
 *
 * The report is generated once at audit time; the recommendation arrives later
 * (on demand) and has to be spliced in without disturbing anything else.
 *
 * Sentinels are HTML comments rather than a heading match. Matching on
 * "## AI Recommendation" is the obvious approach and it is a trap: the
 * AI-authored body contains its own `##` headings ("## Quick wins", ...), so the
 * first regeneration truncates the body at the wrong place and each subsequent
 * one eats more of the document.
 */

export const AI_START = '<!-- ai-recommendation:start -->';
export const AI_END = '<!-- ai-recommendation:end -->';

export const AI_PLACEHOLDER = '_Not generated yet — open this report in the dashboard to generate._';

/** The full block, sentinels included. */
export function aiBlock(body: string): string {
  return `${AI_START}\n## AI Recommendation\n\n${sanitize(body)}\n${AI_END}`;
}

/**
 * Strips literal sentinels out of model output. Claude will occasionally echo
 * instructions or fenced content back; a stray sentinel in the body would
 * corrupt every subsequent replace.
 */
export function sanitize(body: string): string {
  return body
    .split(AI_START)
    .join('')
    .split(AI_END)
    .join('')
    .trim();
}

/**
 * Replaces the recommendation block, or appends one if the sentinels are
 * missing (legacy rows, hand-edited content). Never throws, never duplicates.
 *
 * Uses indexOf rather than a regex deliberately: a greedy pattern over a
 * multi-hundred-KB document is a needless backtracking hazard.
 */
export function upsertAiSection(markdown: string, body: string): string {
  const start = markdown.indexOf(AI_START);
  const end = markdown.indexOf(AI_END, start + AI_START.length);

  if (start === -1 || end === -1) {
    const sep = markdown.endsWith('\n') ? '\n' : '\n\n';
    return `${markdown}${sep}${aiBlock(body)}\n`;
  }

  return markdown.slice(0, start) + aiBlock(body) + markdown.slice(end + AI_END.length);
}

/** The recommendation body alone, or null if it is still the placeholder. */
export function extractAiSection(markdown: string): string | null {
  const start = markdown.indexOf(AI_START);
  const end = markdown.indexOf(AI_END, start + AI_START.length);
  if (start === -1 || end === -1) return null;

  const inner = markdown.slice(start + AI_START.length, end);
  const body = inner.replace(/^\s*##\s*AI Recommendation\s*/i, '').trim();
  if (!body || body === AI_PLACEHOLDER) return null;
  return body;
}

export function hasAiSection(markdown: string): boolean {
  return extractAiSection(markdown) !== null;
}
