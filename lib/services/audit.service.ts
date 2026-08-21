import type { TenantPrismaClient } from '../db/tenant.ts';
import type { D1Credentials } from '../blob.ts';
import { runPagespeed, type PsiFetchResult } from '../psi/client.ts';
import { extractResult, fieldJsonOf } from '../psi/extract.ts';
import { pruneResponse } from '../psi/prune.ts';
import { buildMarkdownReport } from '../report/markdown.ts';
import type { ExtractedResult, PsiStrategy } from '../psi/types.ts';
import type { PsiRateLimiter } from '../psi/rateLimiter.ts';
import { getEnv } from '../env.ts';
import { isUniqueViolation, PermanentError, RetryableError } from '../errors.ts';
import { jobLogger } from '../logger.ts';
import { shouldFinalize } from './run.service.ts';
import { storeRawJson } from '../blob.ts';

/**
 * The audit WRITE path: one (page, strategy) measured and persisted.
 *
 * Everything here exists to keep two invariants true under 20-way concurrency:
 *
 *  1. Exactly one AuditResult per (run, page, strategy), even if a job is
 *     replayed after Redis evicted it.
 *  2. `completedJobs` counts every job that will never run again -- successes
 *     AND permanent failures -- so it can always reach `totalJobs` and let the
 *     run finalize. A run that can never finalize is worse than a failed one:
 *     nothing reports it and the next sweep is blocked by the overlap guard.
 */

export interface RecordOutcome {
  /** False when this was a replay and the row already existed. */
  written: boolean;
  status: 'ok' | 'error';
  readyToFinalize: boolean;
}

/**
 * Persists one measurement (or one error row) and advances the run counter.
 *
 * The result insert, its AuditIssue rows, the Page pointers and the
 * `completedJobs` increment all share ONE interactive transaction. If they did
 * not, a crash between the insert and the increment would leave a run that can
 * never finalize, and a replay would double-count.
 */
export async function recordAuditResult(
  prisma: TenantPrismaClient,
  args: {
    runId: string;
    pageId: string;
    url: string;
    strategy: PsiStrategy;
    extracted: ExtractedResult;
    rawJson: unknown;
    fieldJson: unknown;
    markdownReport: string;
    isFailure: boolean;
    /** Measured PSI wall-clock, used to estimate future runs. */
    durationMs?: number;
  },
  d1?: D1Credentials,
  /** Injectable so a test can force the PermanentError/RetryableError paths
   *  below without a real D1 round trip. Defaults to the real storeRawJson. */
  storeRawJsonFn: typeof storeRawJson = storeRawJson,
): Promise<RecordOutcome> {
  const { runId, pageId, strategy, extracted, isFailure } = args;

  // Uploaded before the transaction, not after: see the pathname comment in
  // lib/blob.ts for why this doesn't need the row's own id. Nothing to
  // upload for an error row (args.rawJson is already null there).
  //
  // A PermanentError here (D1 genuinely misconfigured) must NOT throw away a
  // measurement that already succeeded -- retrying changes nothing about a
  // config problem, and the caller's top-level PermanentError handling
  // (auditOnePageStep) has no way to tell "PSI never ran" apart from
  // "PSI succeeded but storage failed" once this throws. Recorded with
  // rawJsonBlobKey null instead: the scores are real and worth keeping, the
  // evidence tables just aren't available for this one result. A
  // RetryableError (a transient D1 blip) is NOT swallowed here -- letting it
  // propagate and retry the whole page is exactly what should happen, the
  // same as any other transient failure this function's caller retries.
  let rawJsonBlobKey: string | null = null;
  if (args.rawJson != null) {
    try {
      rawJsonBlobKey = await storeRawJsonFn(runId, pageId, strategy, args.rawJson, d1);
    } catch (e) {
      if (!(e instanceof PermanentError)) throw e;
      jobLogger(runId, pageId, strategy).warn(
        { message: e.message },
        'raw JSON storage permanently failed — keeping the measured scores anyway',
      );
    }
  }

  try {
    const run = await prisma.$transaction(
      async (tx) => {
        const created = await tx.auditResult.create({
          data: {
            auditRunId: runId,
            pageId,
            strategy,
            status: extracted.status,
            runtimeError: extracted.runtimeError,
            performanceScore: extracted.scores.performance,
            accessibilityScore: extracted.scores.accessibility,
            bestPracticesScore: extracted.scores.bestPractices,
            seoScore: extracted.scores.seo,
            lcp: extracted.lab.lcp,
            cls: extracted.lab.cls,
            fcp: extracted.lab.fcp,
            ttfb: extracted.lab.ttfb,
            // Lab INP, which is null on every real page. NEVER tbt.
            inp: extracted.lab.inp,
            tbt: extracted.lab.tbt,
            speedIndex: extracted.lab.speedIndex,
            fieldSource: extracted.field.source,
            fieldOverall: extracted.field.overall,
            fieldLcp: extracted.field.metrics.lcp?.value ?? null,
            fieldInp: extracted.field.metrics.inp?.value ?? null,
            fieldCls: extracted.field.metrics.cls?.value ?? null,
            fieldFcp: extracted.field.metrics.fcp?.value ?? null,
            fieldTtfb: extracted.field.metrics.ttfb?.value ?? null,
            fieldJson: (args.fieldJson ?? undefined) as never,
            finalUrl: extracted.finalUrl,
            lighthouseVersion: extracted.lighthouseVersion,
            // Never inline for new rows -- the pruned JSON lives in Blob
            // (rawJsonBlobKey) now. See docs/DECISIONS.md §13. undefined
            // (not null) omits the field, which is how the rest of this
            // create() already spells "leave this JSON column null" -- a
            // bare `null` needs Prisma.JsonNull instead, which is more
            // ceremony than this needs.
            rawJson: undefined as never,
            rawJsonBlobKey,
            markdownReport: args.markdownReport,
            durationMs: args.durationMs ?? null,
          },
          select: { id: true },
        });

        if (extracted.audits.length > 0) {
          await tx.auditIssue.createMany({
            data: extracted.audits.map((a) => ({
              auditResultId: created.id,
              auditRunId: runId,
              pageId,
              strategy,
              auditId: a.auditId,
              category: a.category,
              group: a.kind,
              title: a.title,
              score: a.score,
              displayValue: a.displayValue,
              savingsMs: a.savingsMs,
              savingsBytes: a.savingsBytes,
              weight: a.weight,
            })),
            skipDuplicates: true,
          });
        }

        await tx.page.update({
          where: { id: pageId },
          data: {
            lastAuditedAt: new Date(),
            ...(strategy === 'mobile'
              ? { latestResultMobileId: created.id }
              : { latestResultDesktopId: created.id }),
          },
        });

        // Atomic at the row level, so 20 concurrent writers cannot lose an
        // increment without any explicit locking.
        return tx.auditRun.update({
          where: { id: runId },
          data: {
            completedJobs: { increment: 1 },
            ...(isFailure ? { failedJobs: { increment: 1 } } : {}),
          },
          select: { completedJobs: true, totalJobs: true },
        });
      },
      { timeout: 15_000 },
    );

    return {
      written: true,
      status: extracted.status,
      readyToFinalize: shouldFinalize(run),
    };
  } catch (e) {
    if (isUniqueViolation(e)) {
      // A replayed job. The whole transaction rolled back, so completedJobs was
      // NOT incremented -- which is the point. Double-counting here would let a
      // run finalize while pages were still unmeasured.
      return { written: false, status: extracted.status, readyToFinalize: false };
    }
    throw e;
  }
}

/** Turns a client failure into the error row we store for it. */
export function errorResultFor(code: string): ExtractedResult {
  return {
    status: 'error',
    runtimeError: code,
    finalUrl: null,
    lighthouseVersion: null,
    fetchTime: null,
    scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
    lab: { lcp: null, cls: null, fcp: null, ttfb: null, inp: null, tbt: null, speedIndex: null },
    field: { source: 'none', overall: null, metrics: {} },
    audits: [],
  };
}

export interface AuditPageDeps {
  prisma: TenantPrismaClient;
  limiter: PsiRateLimiter;
  organizationId: string;
  d1?: D1Credentials;
  /** Injected so the throughput dry-run and tests can substitute a fake PSI. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Measures one (page, strategy) and persists the outcome.
 *
 * Throws RetryableError for conditions worth another attempt; the caller (the
 * BullMQ processor, or the synchronous path) decides how to react. Everything
 * else is written as a result row and returns normally -- including a page
 * Lighthouse could not render, which is a real finding, not a broken job.
 */
export async function auditPage(
  deps: AuditPageDeps,
  args: { runId: string; pageId: string; url: string; strategy: PsiStrategy },
): Promise<RecordOutcome> {
  const env = getEnv();
  const log = jobLogger(args.runId, args.pageId, args.strategy);
  const at = deps.now?.() ?? new Date();

  // Both the queued and the synchronous path acquire here, which is the only
  // reason a dashboard-triggered audit cannot push the sustained rate over the
  // line during a sweep.
  await deps.limiter.acquire();

  // The key belongs to the SITE, not the deployment: each organisation uses
  // its own Google quota rather than sharing one and starving each other.
  // Falling back to the environment keeps single-tenant installs working.
  const { psiKeyForSite } = await import('./tenant.service.ts');
  const page = await deps.prisma.page.findUnique({
    where: { id: args.pageId },
    select: { siteId: true },
  });
  const apiKey = (page ? await psiKeyForSite(deps.organizationId, page.siteId) : null) ?? env.PSI_API_KEY;

  if (!apiKey) {
    // Naming the cause here saves a very confusing 403 on every page of a run.
    throw new PermanentError(
      'No Google API key is configured for this site. An admin can add one under Settings → Site.',
    );
  }

  const res: PsiFetchResult = await runPagespeed(args.url, args.strategy, {
    apiKey,
    timeoutMs: env.PSI_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
  });

  if (!res.ok && res.kind === 'retryable') {
    log.warn({ status: res.status, message: res.message }, 'psi retryable failure');
    throw new RetryableError(res.message, res.retryAfterMs);
  }

  if (!res.ok && res.kind === 'permanent') {
    // A 403 means a bad key or exhausted quota -- an operator problem that
    // would otherwise repeat silently across every remaining job.
    log.error({ status: res.status, message: res.message }, 'psi permanent failure');
    const extracted = errorResultFor(`HTTP_${res.status ?? 'ERROR'}`);
    const outcome = await recordAuditResult(
      deps.prisma,
      {
        ...args,
        extracted,
        rawJson: null,
        fieldJson: null,
        markdownReport: buildMarkdownReport({
          url: args.url,
          strategy: args.strategy,
          generatedAt: at,
          result: extracted,
        }),
        isFailure: true,
        durationMs: res.elapsedMs,
      },
      deps.d1,
    );
    if (res.status === 403) throw new PermanentError(`PSI rejected the API key or quota: ${res.message}`);
    return outcome;
  }

  if (!res.ok) {
    // kind === 'content': Lighthouse ran and could not measure the page (it
    // 4xx'd, never painted...). Storable, and NOT worth retrying.
    log.info({ code: res.code }, 'lighthouse content error');
    const extracted = errorResultFor(res.code ?? 'LIGHTHOUSE_ERROR');
    return recordAuditResult(
      deps.prisma,
      {
        ...args,
        extracted,
        rawJson: null,
        fieldJson: null,
        markdownReport: buildMarkdownReport({
          url: args.url,
          strategy: args.strategy,
          generatedAt: at,
          result: extracted,
        }),
        isFailure: true,
        durationMs: res.elapsedMs,
      },
      deps.d1,
    );
  }

  const extracted = extractResult(res.raw);

  // The delta column needs the previous SUCCESSFUL result, not merely the
  // previous row -- comparing against an error row's nulls renders nothing.
  const prev = await deps.prisma.auditResult.findFirst({
    where: { pageId: args.pageId, strategy: args.strategy, status: 'ok' },
    orderBy: { createdAt: 'desc' },
    select: {
      performanceScore: true,
      accessibilityScore: true,
      bestPracticesScore: true,
      seoScore: true,
    },
  });

  const markdownReport = buildMarkdownReport({
    url: args.url,
    strategy: args.strategy,
    generatedAt: at,
    result: extracted,
    previousScores: prev
      ? {
          performance: prev.performanceScore,
          accessibility: prev.accessibilityScore,
          bestPractices: prev.bestPracticesScore,
          seo: prev.seoScore,
        }
      : null,
  });

  const { pruned } = pruneResponse(res.raw);

  return recordAuditResult(
    deps.prisma,
    {
      ...args,
      extracted,
      rawJson: pruned,
      fieldJson: fieldJsonOf(res.raw),
      markdownReport,
      isFailure: extracted.status === 'error',
      durationMs: res.elapsedMs,
    },
    deps.d1,
  );
}
