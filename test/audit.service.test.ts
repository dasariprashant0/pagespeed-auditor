import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recordAuditResult } from '../lib/services/audit.service.ts';
import { PermanentError, RetryableError } from '../lib/errors.ts';
import type { ExtractedResult } from '../lib/psi/types.ts';

/**
 * A real, successful measurement -- the scenario that matters here is
 * "PSI worked, only the raw-JSON storage step failed," not an already-failed
 * page. Losing this data because a separate storage system hiccupped would
 * throw away a genuine result and the PSI quota it cost to get it.
 */
const OK_RESULT: ExtractedResult = {
  status: 'ok',
  runtimeError: null,
  finalUrl: 'https://example.com/',
  lighthouseVersion: '13.4.1',
  fetchTime: new Date().toISOString(),
  scores: { performance: 87, accessibility: 95, bestPractices: 92, seo: 100 },
  lab: { lcp: 2100, cls: 0.03, fcp: 900, ttfb: 300, inp: null, tbt: 120, speedIndex: 1800 },
  field: { source: 'none', overall: null, metrics: {} },
  audits: [],
};

/** Records every AuditResult.create() call so a test can inspect what was persisted. */
function fakePrisma() {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        auditResult: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: `result-${created.length}` };
          },
        },
        auditIssue: { createMany: async () => ({ count: 0 }) },
        page: { update: async () => ({}) },
        auditRun: { update: async () => ({ completedJobs: 1, totalJobs: 1 }) },
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { prisma, created };
}

const BASE_ARGS = {
  runId: 'run1',
  pageId: 'page1',
  url: 'https://example.com/',
  strategy: 'mobile' as const,
  markdownReport: '# report',
  isFailure: false,
};

describe('recordAuditResult — raw JSON storage failure handling', () => {
  test('a PermanentError from storage keeps the measured scores, with a null blob key', async () => {
    const { prisma, created } = fakePrisma();
    const storeRawJsonFn = async (): Promise<string> => {
      throw new PermanentError('Cloudflare D1 is not configured.');
    };

    const outcome = await recordAuditResult(
      prisma,
      { ...BASE_ARGS, extracted: OK_RESULT, rawJson: { some: 'payload' }, fieldJson: null },
      undefined,
      storeRawJsonFn,
    );

    assert.equal(outcome.written, true);
    assert.equal(outcome.status, 'ok');
    assert.equal(created.length, 1);
    assert.equal(created[0].rawJsonBlobKey, null);
    // The real measurement is NOT discarded -- this is the actual bug fix.
    assert.equal(created[0].performanceScore, 87);
    assert.equal(created[0].seoScore, 100);
  });

  test('a RetryableError from storage propagates -- the whole page retries, nothing is silently recorded', async () => {
    const { prisma, created } = fakePrisma();
    const storeRawJsonFn = async (): Promise<string> => {
      throw new RetryableError('D1 query failed (HTTP 503)');
    };

    await assert.rejects(
      () =>
        recordAuditResult(
          prisma,
          { ...BASE_ARGS, extracted: OK_RESULT, rawJson: { some: 'payload' }, fieldJson: null },
          undefined,
          storeRawJsonFn,
        ),
      RetryableError,
    );
    assert.equal(created.length, 0);
  });

  test('an error row (args.rawJson null) never calls storage at all', async () => {
    const { prisma, created } = fakePrisma();
    let calls = 0;
    const storeRawJsonFn = async (): Promise<string> => {
      calls++;
      return 'should-not-be-called';
    };

    const errorResult: ExtractedResult = { ...OK_RESULT, status: 'error', runtimeError: 'NO_FCP' };
    const outcome = await recordAuditResult(
      prisma,
      { ...BASE_ARGS, extracted: errorResult, rawJson: null, fieldJson: null, isFailure: true },
      undefined,
      storeRawJsonFn,
    );

    assert.equal(calls, 0);
    assert.equal(outcome.status, 'error');
    assert.equal(created[0].rawJsonBlobKey, null);
  });
});
