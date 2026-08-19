import type { PsiResponse } from './types.ts';

/**
 * Strips the bulk out of a PSI response before it goes into AuditResult.rawJson.
 *
 * Measured on real Lighthouse 13.4.1 responses: 202-584 KB each. At 2,000 per
 * sweep daily that is roughly 500 GB/year, and any accidental `SELECT *` on
 * AuditResult detoasts all of it.
 *
 * Targets were chosen by measuring, not guessing. On the recorded fixtures the
 * single biggest item is audits['screenshot-thumbnails'] at 259 KB, and
 * `fullPageScreenshot` is a TOP-LEVEL lighthouseResult key rather than an audit
 * (an earlier draft looked for audits['full-page-screenshot'], which matches
 * nothing).
 *
 * Pure: returns a new object, never mutates the input. The caller still has the
 * untouched response for extraction.
 */

/**
 * Audit ids that carry image or debug payloads we never display.
 *
 * `final-screenshot` is deliberately NOT here. It is 5-33 KB and it is the
 * image pagespeed.web.dev leads with, so dropping it to save a rounding error
 * costs the report its visual anchor. The filmstrip
 * (`screenshot-thumbnails`, 259 KB on one measured page) and
 * `fullPageScreenshot` (43-78 KB, only used for element highlighting) stay
 * dropped -- those are where the weight actually is.
 */
const DROP_AUDITS = [
  'screenshot-thumbnails',
  'script-treemap-data',
  'main-thread-tasks',
  'diagnostics',
] as const;

/** Top-level lighthouseResult keys that are large and unused. */
const DROP_LH_KEYS = ['fullPageScreenshot', 'timing', 'entities', 'i18n', 'stackPacks'] as const;

/**
 * Audits whose details.items lists can run to thousands of rows.
 *
 * 50 was too generous against a real marketing page: `target-size` alone was
 * 36 KB across only 28 items, because each item embeds a DOM node snippet.
 * The item COUNT was never the problem -- the per-item payload was.
 */
const CAP_ITEMS = 10;

/** Longest string kept inside a details item. DOM snippets dominate the rest. */
const MAX_ITEM_STRING = 200;

/**
 * Audits whose items are the evidence a person actually reads, kept deeper than
 * the default so the report can show a useful table rather than a teaser.
 */
const DEEP_ITEM_AUDITS = new Set([
  'network-requests',
  'render-blocking-insight',
  'unused-css-rules',
  'unused-javascript',
  'uses-responsive-images',
  'modern-image-format-insight',
  'image-delivery-insight',
  'legacy-javascript-insight',
  'duplicated-javascript-insight',
  'third-parties-insight',
  'font-display-insight',
  'cache-insight',
  'lcp-discovery-insight',
  'cls-culprits-insight',
]);
const DEEP_CAP_ITEMS = 30;

/**
 * Shortens the long strings inside one details item.
 *
 * Lighthouse embeds full DOM snippets, selectors and explanations per item;
 * those are what make a 28-item audit weigh 36 KB. We keep enough to identify
 * the element and drop the rest -- the markdown report only ever shows a
 * handful of rows anyway.
 */
function truncateItem(item: unknown): Record<string, unknown> {
  if (typeof item !== 'object' || item === null) return item as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (typeof v === 'string') {
      out[k] = v.length > MAX_ITEM_STRING ? `${v.slice(0, MAX_ITEM_STRING)}…` : v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Nested node objects carry snippet/selector/explanation -- same treatment.
      out[k] = truncateItem(v);
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, CAP_ITEMS).map(truncateItem);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface PruneStats {
  beforeBytes: number;
  afterBytes: number;
  removedPct: number;
}

export function pruneResponse(input: PsiResponse): { pruned: PsiResponse; stats: PruneStats } {
  const beforeBytes = JSON.stringify(input).length;

  // Structured clone keeps this honest -- no shared references back into the
  // caller's object, so extraction can't be affected by pruning.
  const out: PsiResponse = structuredClone(input);
  const lr = out.lighthouseResult;

  if (lr) {
    for (const k of DROP_LH_KEYS) {
      delete (lr as Record<string, unknown>)[k];
    }

    if (lr.audits) {
      for (const id of DROP_AUDITS) delete lr.audits[id];

      for (const audit of Object.values(lr.audits)) {
        const items = audit.details?.items;
        if (!Array.isArray(items)) continue;
        const cap = DEEP_ITEM_AUDITS.has(audit.id ?? '') ? DEEP_CAP_ITEMS : CAP_ITEMS;
        audit.details!.items = items.slice(0, cap).map(truncateItem);
      }
    }
  }

  const afterBytes = JSON.stringify(out).length;
  return {
    pruned: out,
    stats: {
      beforeBytes,
      afterBytes,
      removedPct: beforeBytes === 0 ? 0 : ((beforeBytes - afterBytes) / beforeBytes) * 100,
    },
  };
}
