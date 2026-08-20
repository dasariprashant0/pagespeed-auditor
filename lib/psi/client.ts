import type { PsiResponse, PsiStrategy } from './types.ts';

/**
 * The PSI HTTP client. Its real job is error CLASSIFICATION -- deciding what is
 * worth retrying and what is a waste of five attempts.
 *
 * Verified against the live API: calls take 11-24 s, occasionally longer, which
 * is what drives the queue's concurrency (see docs/DECISIONS.md 2.3).
 */

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Request params use SCREAMING_SNAKE; the response keys are hyphenated. */
const CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'] as const;

export type PsiFailureKind = 'retryable' | 'permanent' | 'content';

export type PsiFetchResult =
  | { ok: true; raw: PsiResponse; elapsedMs: number }
  | {
      ok: false;
      kind: PsiFailureKind;
      status?: number;
      retryAfterMs?: number;
      code?: string;
      message: string;
      elapsedMs: number;
    };

export interface PsiClientOptions {
  apiKey: string;
  timeoutMs: number;
  locale?: string;
  /** Injected in tests and by the fake-PSI dry run. */
  fetchImpl?: typeof fetch;
}

export function buildPsiUrl(url: string, strategy: PsiStrategy, opts: PsiClientOptions): string {
  const u = new URL(ENDPOINT);
  u.searchParams.set('url', url);
  u.searchParams.set('strategy', strategy);
  // FOUR REPEATED params. Comma-joining silently returns Performance only --
  // the other three scores come back undefined with no error.
  for (const c of CATEGORIES) u.searchParams.append('category', c);
  u.searchParams.set('locale', opts.locale ?? 'en_US');
  u.searchParams.set('key', opts.apiKey);
  return u.toString();
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Cheap shape guard. PSI occasionally returns a truncated body under load. */
function looksComplete(j: unknown): j is PsiResponse {
  const lr = (j as PsiResponse)?.lighthouseResult;
  if (!lr) return false;
  // A runtimeError response legitimately has no categories.
  if (lr.runtimeError?.code) return true;
  return !!lr.categories && !!lr.audits;
}

/**
 * Defense in depth: `buildPsiUrl` puts the API key in the query string, and
 * a fetch-level failure (DNS, connect timeout, undici's own error messages)
 * can embed the full request URL in `Error#message`. That message used to
 * only ever reach a server log; since RunTerminal now shows it directly in
 * the browser, to every role, a key sitting in it is no longer "somewhere
 * only ops looks" -- so it's scrubbed at the source, before it becomes a
 * `message` field anyone downstream can display.
 */
export function redactKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}

export async function runPagespeed(
  url: string,
  strategy: PsiStrategy,
  opts: PsiClientOptions,
): Promise<PsiFetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const elapsed = () => Date.now() - started;

  let res: Response;
  try {
    res = await doFetch(buildPsiUrl(url, strategy, opts), {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (e) {
    // Timeouts, DNS, connection resets -- all worth another go.
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'retryable', message: redactKey(`network: ${msg}`, opts.apiKey), elapsedMs: elapsed() };
  }

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    let apiMessage = '';
    let reason = '';
    try {
      const body = JSON.parse(text);
      apiMessage = body?.error?.message ?? '';
      reason = body?.error?.errors?.[0]?.reason ?? '';
    } catch {
      apiMessage = text.slice(0, 200);
    }
    // Covers both branches above: a JSON error message Google composed, or
    // the raw-text fallback slice when the body isn't JSON at all -- either
    // could in principle contain the request URL this response came from.
    apiMessage = redactKey(apiMessage, opts.apiKey);

    // Verified against the live API: a Lighthouse *content* failure arrives as
    // HTTP 400 with reason "lighthouseUserError" (e.g. "Lighthouse returned
    // error: NO_FCP"), NOT as a 200 carrying lighthouseResult.runtimeError.
    // Treating it as a malformed request would discard a legitimate
    // "this page will not render" result.
    if (res.status === 400 && reason === 'lighthouseUserError') {
      const m = /Lighthouse returned error:\s*([A-Z_]+)/.exec(apiMessage);
      return {
        ok: false,
        kind: 'content',
        status: 400,
        code: m?.[1] ?? 'LIGHTHOUSE_ERROR',
        message: apiMessage || 'Lighthouse could not measure this page',
        elapsedMs: elapsed(),
      };
    }

    if (res.status === 429 || res.status >= 500) {
      return {
        ok: false,
        kind: 'retryable',
        status: res.status,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        message: apiMessage || `HTTP ${res.status}`,
        elapsedMs: elapsed(),
      };
    }

    // 400 (malformed URL), 403 (bad key / quota exhausted), 404. Retrying burns
    // four more attempts for nothing. 403 in particular is an operator alarm.
    return {
      ok: false,
      kind: 'permanent',
      status: res.status,
      message: apiMessage || `HTTP ${res.status}`,
      elapsedMs: elapsed(),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'retryable', status: 200, message: 'malformed JSON body', elapsedMs: elapsed() };
  }

  if (!looksComplete(parsed)) {
    return { ok: false, kind: 'retryable', status: 200, message: 'incomplete response body', elapsedMs: elapsed() };
  }

  return { ok: true, raw: parsed, elapsedMs: elapsed() };
}

/**
 * Jittered exponential backoff: 30 s, 1 m, 2 m, 4 m ... capped at 15 m.
 * Full-ish jitter so a batch of simultaneous failures doesn't retry in lockstep.
 */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000);
  return Math.round(base * (0.5 + rand()));
}
