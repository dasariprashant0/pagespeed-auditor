/**
 * End-to-end proof of the audit write path: one real PSI call, extracted,
 * pruned, rendered to markdown, and persisted -- then the invariants checked.
 *
 *   npm run verify:audit
 *
 * Makes ONE real PSI call against one page of the configured site.
 */
import 'dotenv/config';
import { PrismaClient } from '../lib/generated/tenant/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { auditPage } from '../lib/services/audit.service.ts';
import { createRun, finalizeRun } from '../lib/services/run.service.ts';
import { PsiRateLimiter } from '../lib/psi/rateLimiter.ts';

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TENANT_DEV_DATABASE_URL! }) });
  // A distinct key, not the real "psi" bucket, so this verification run
  // never contends with (or is throttled by) whatever a real sweep is doing.
  const limiter = new PsiRateLimiter({
    db: prisma,
    max: Number(process.env.PSI_RATE_MAX ?? 3),
    windowMs: Number(process.env.PSI_RATE_WINDOW_MS ?? 4000),
    key: `verify:${process.pid}`,
  });

  try {
    const site = await prisma.site.findFirstOrThrow();
    const page = await prisma.page.findFirstOrThrow({
      where: { siteId: site.id, isActive: true, path: '/' },
    });

    const runId = await createRun(prisma, {
      siteId: site.id,
      type: 'page',
      triggeredBy: 'manual',
      scope: { kind: 'page', ref: page.id, strategies: ['mobile'] },
      totalJobs: 1,
    });

    console.log(`\n  auditing ${page.url} (mobile) — one real PSI call, ~15-25s\n`);
    const t0 = Date.now();
    const outcome = await auditPage({ prisma, limiter, sharedLimiter: limiter, organizationId: site.organizationId }, {
      runId, pageId: page.id, url: page.url, strategy: 'mobile',
    });
    console.log(`  completed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    check('result written', outcome.written);
    check('run ready to finalize (1/1)', outcome.readyToFinalize);

    const r = await prisma.auditResult.findFirstOrThrow({
      where: { auditRunId: runId },
      select: {
        id: true, status: true, performanceScore: true, accessibilityScore: true,
        bestPracticesScore: true, seoScore: true, lcp: true, cls: true, inp: true,
        tbt: true, fieldSource: true, fieldCls: true, lighthouseVersion: true,
        markdownReport: true, rawJson: true,
      },
    });

    console.log(`\n  scores: perf=${r.performanceScore} a11y=${r.accessibilityScore} bp=${r.bestPracticesScore} seo=${r.seoScore}`);
    console.log(`  lab: lcp=${r.lcp?.toFixed(0)}ms cls=${r.cls?.toFixed(3)} tbt=${r.tbt?.toFixed(0)}ms inp=${r.inp}`);
    console.log(`  field: source=${r.fieldSource} cls=${r.fieldCls}`);
    console.log(`  lighthouse ${r.lighthouseVersion}\n`);

    check('status is ok', r.status === 'ok');
    check('performance score is a 0-100 int', Number.isInteger(r.performanceScore) && r.performanceScore! >= 0);
    check('all four categories scored', [r.performanceScore, r.accessibilityScore, r.bestPracticesScore, r.seoScore].every((v) => v !== null));
    // The invariant that would otherwise poison every trend, silently.
    check('lab INP is null (field-only metric)', r.inp === null);
    check('TBT populated and NOT copied into inp', r.tbt !== null && r.inp !== r.tbt);
    check('field CLS is a real value, not x100', r.fieldCls === null || r.fieldCls < 5, `fieldCls=${r.fieldCls}`);

    const rawKb = JSON.stringify(r.rawJson).length / 1024;
    check('rawJson was pruned', rawKb < 200, `${rawKb.toFixed(0)} KB stored`);
    check('markdown report generated', r.markdownReport.includes('## Core Web Vitals'));
    check('markdown carries the AI sentinel', r.markdownReport.includes('<!-- ai-recommendation:start -->'));

    const issues = await prisma.auditIssue.count({ where: { auditRunId: runId } });
    check('AuditIssue rows written', issues > 0, `${issues} issues`);

    const pageAfter = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    check('Page.latestResultMobileId pointer set', pageAfter.latestResultMobileId === r.id);
    check('Page.lastAuditedAt set', pageAfter.lastAuditedAt !== null);

    // Replay: the same job delivered twice must NOT double-count.
    const before = await prisma.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { completedJobs: true } });
    const replay = await auditPage({ prisma, limiter, sharedLimiter: limiter, organizationId: site.organizationId }, {
      runId, pageId: page.id, url: page.url, strategy: 'mobile',
    });
    const after = await prisma.auditRun.findUniqueOrThrow({ where: { id: runId }, select: { completedJobs: true } });
    check('replay did not write a second result', !replay.written);
    check('replay did not increment completedJobs', before.completedJobs === after.completedJobs,
      `${before.completedJobs} -> ${after.completedJobs}`);

    const status = await finalizeRun(prisma, runId);
    check('run finalizes', status === 'completed', `status=${status}`);
    const again = await finalizeRun(prisma, runId);
    check('finalize is idempotent', again === 'completed');

    console.log(`\n  run ${runId}`);
  } finally {
    await prisma.$disconnect();
  }

  console.log(fail === 0 ? '\n  AUDIT PATH VERIFIED\n' : `\n  ${fail} FAILURE(S)\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
