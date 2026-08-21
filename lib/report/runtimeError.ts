/**
 * "8 failed" on its own is an accusation without evidence. These are real rows
 * — a job that runs out of attempts writes an AuditResult with status 'error'
 * and null scores, so the run can still finalize — and each one names the page
 * and what Lighthouse said. This is the one translation from Lighthouse's
 * runtimeError codes to a sentence a non-engineer can act on; every place that
 * shows one of these codes should go through here rather than printing it raw.
 */
export const EXPLAIN_RUNTIME_ERROR: Record<string, string> = {
  RETRIES_EXHAUSTED:
    'Google never returned a result, across every attempt. Usually a page heavy enough to exceed the 90-second limit.',
  ERRORED_DOCUMENT_REQUEST: 'The page itself did not load for Google — a redirect, a block, or a server error.',
  NO_FCP: 'The page never painted anything, so there was nothing to measure.',
  FAILED_DOCUMENT_REQUEST: 'Google could not fetch the URL at all.',
  NOT_HTML: 'The URL did not return an HTML page.',
};

export function explainRuntimeError(code: string | null | undefined): string {
  if (!code) return 'Lighthouse did not say why.';
  return EXPLAIN_RUNTIME_ERROR[code] ?? `Lighthouse reported "${code}", which this app does not have a plain-language explanation for yet.`;
}
