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

/** Lighthouse's own codes are SCREAMING_SNAKE_CASE; a PermanentError's own
 *  .message (auditRunWorkflow's PermanentError branch) is stored here
 *  verbatim instead, and isn't shaped like that -- it's already a full,
 *  human-readable sentence, so it's returned as-is rather than wrapped in
 *  the "Lighthouse reported ..." framing that's only correct for an
 *  actual, unrecognized Lighthouse code. */
const LOOKS_LIKE_A_CODE = /^[A-Z][A-Z0-9_]*$/;

export function explainRuntimeError(code: string | null | undefined): string {
  if (!code) return 'Lighthouse did not say why.';
  if (EXPLAIN_RUNTIME_ERROR[code]) return EXPLAIN_RUNTIME_ERROR[code];
  if (!LOOKS_LIKE_A_CODE.test(code)) return code;
  return `Lighthouse reported "${code}", which this app does not have a plain-language explanation for yet.`;
}

/**
 * True for one of the known Lighthouse content-failure codes above --
 * something genuinely about THIS page (it never painted, the server
 * rejected the request, ...). False for anything else, including a
 * PermanentError's own message (missing API key, D1 misconfigured, ...):
 * those are operational problems with the audit setup itself, not a
 * finding about the page, and must not be reassured over as if they were.
 */
export function isPageContentFailure(code: string | null | undefined): boolean {
  return Boolean(code && EXPLAIN_RUNTIME_ERROR[code]);
}
