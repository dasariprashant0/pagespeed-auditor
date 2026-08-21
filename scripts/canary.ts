/**
 * M9: the canary.
 *
 * A bounded slice of the real site through the real audit path (the same
 * auditPage()/PsiRateLimiter every production run uses), BEFORE any full
 * sweep is ever scheduled. The point is to catch a quota, rate or correctness
 * problem at 100 calls rather than at 1,494.
 *
 * Runs sequentially in this process rather than starting a Workflow run --
 * Workflow's start() needs a live app instance with its routes registered,
 * which a bare CLI script doesn't have. Fine here: this is a manual,
 * synchronous check, not something that needs the batching/pause/resume
 * machinery a real run gets.
 *
 *   npm run canary            # 50 pages, both strategies
 *   npm run canary -- 20
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BOTH_STRATEGIES, createRun, findActiveRun } from '../lib/services/run.service.ts';
import { auditPage } from '../lib/services/audit.service.ts';
import { getPsiRateLimiter } from '../lib/opsState.ts';
import { estimateRun, formatDuration } from '../lib/services/estimate.service.ts';

async function main() {
  const limit = Number(process.argv[2] ?? 50);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  try {
    const site = await prisma.site.findFirstOrThrow();
    const active = await findActiveRun(prisma, site.id);
    if (active) throw new Error(`A ${active.type} run is already active (${active.id}).`);

    // Spread across the sitemap rather than the first N, so the sample is not
    // all one section of the site.
    const all = await prisma.page.findMany({
      where: { siteId: site.id, isActive: true },
      select: { id: true, url: true },
      orderBy: [{ sitemapIndex: 'asc' }, { path: 'asc' }],
    });
    const step = Math.max(1, Math.floor(all.length / limit));
    const sample = all.filter((_, i) => i % step === 0).slice(0, limit);

    const pairs = sample.flatMap((p) =>
      BOTH_STRATEGIES.map((strategy) => ({ pageId: p.id, url: p.url, strategy })),
    );

    /*
     * Scope is 'page' with no ref, NOT 'site'.
     *
     * A site-wide label would be a lie about what this run committed to, and
     * resume re-reads that label: labelling a 50-page sample as site-wide once
     * caused a resume to re-expand it into a full 1,494-call sweep. resumeRun
     * now refuses to grow a run, but the label should be honest regardless.
     */
    const runId = await createRun(prisma, {
      siteId: site.id,
      type: 'page',
      triggeredBy: 'manual',
      scope: { kind: 'page', ref: null, strategies: BOTH_STRATEGIES },
      totalJobs: pairs.length,
    });
    console.log(`\n  canary: ${sample.length} pages x 2 strategies = ${pairs.length} PSI calls`);
    console.log(`  sampled every ${step} pages across the sitemap`);
    console.log(`  run ${runId}, running sequentially...\n`);

    const limiter = getPsiRateLimiter();
    for (const p of pairs) {
      await auditPage({ prisma, limiter }, { runId, pageId: p.pageId, url: p.url, strategy: p.strategy });
    }

    const est = await estimateRun(pairs.length, site.id);
    console.log(`  done. ${formatDuration(est.seconds)}${est.measured ? ` (median ${Math.round(est.medianCallMs / 1000)}s/call, ${est.sampleSize} samples)` : ''}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error('  ' + (e instanceof Error ? e.message : e)); process.exit(1); });
