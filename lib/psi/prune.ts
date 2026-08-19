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

/** Audit ids that carry image or debug payloads and nothing we display. */
const DROP_AUDITS = [
  'screenshot-thumbnails',
  'final-screenshot',
  'full-page-screenshot',
  'script-treemap-data',
  'main-thread-tasks',
  'network-requests',
  'diagnostics',
] as const;

/** Top-level lighthouseResult keys that are large and unused. */
const DROP_LH_KEYS = ['fullPageScreenshot', 'timing', 'entities', 'i18n', 'stackPacks'] as const;

/** Audits whose details.items lists can run to thousands of rows. */
const CAP_ITEMS = 50;

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
        if (Array.isArray(items) && items.length > CAP_ITEMS) {
          audit.details!.items = items.slice(0, CAP_ITEMS);
        }
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
