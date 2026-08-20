/**
 * Runs a group's audit through the real audit path, rather than going
 * through the dashboard.
 *
 *   npm run audit:queue -- platform          # whole group, both strategies
 *   npm run audit:queue -- platform mobile   # one strategy
 *
 * Preferred over audit:group for anything non-trivial: this retries transient
 * PSI failures on the configured backoff and shows up in the dashboard's
 * progress bar, same as auditPage() does for every other run.
 *
 * Runs sequentially in this process rather than starting a Workflow run --
 * see the same note in scripts/canary.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BOTH_STRATEGIES, createRun, expandScope, findActiveRun } from '../lib/services/run.service.ts';
import { auditPage } from '../lib/services/audit.service.ts';
import { getPsiRateLimiter, getRedis } from '../lib/redis.ts';
import { estimateRun, formatDuration } from '../lib/services/estimate.service.ts';
import type { PsiStrategy } from '../lib/psi/types.ts';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('\n  Usage: npm run audit:queue -- <group-slug> [mobile|desktop]\n');
    process.exit(1);
  }
  const only = process.argv[3] as PsiStrategy | undefined;
  const strategies = only ? [only] : BOTH_STRATEGIES;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const site = await prisma.site.findFirstOrThrow();

    const active = await findActiveRun(prisma, site.id);
    if (active) {
      console.error(`\n  A ${active.type} run is already active (${active.id}). Wait for it.\n`);
      process.exit(1);
    }

    const scope = { kind: 'group' as const, ref: slug, strategies };
    const pairs = await expandScope(prisma, site.id, scope);
    if (pairs.length === 0) {
      console.error(`\n  No active pages in group "${slug}".\n`);
      process.exit(1);
    }

    const runId = await createRun(prisma, {
      siteId: site.id, type: 'group', triggeredBy: 'manual', scope, totalJobs: pairs.length,
    });
    console.log(`\n  running ${pairs.length} calls for "${slug}" (${strategies.join(', ')})`);
    console.log(`  run ${runId}, running sequentially...\n`);

    const limiter = getPsiRateLimiter();
    for (const p of pairs) {
      await auditPage({ prisma, limiter }, { runId, pageId: p.pageId, url: p.url, strategy: p.strategy });
    }

    const est = await estimateRun(pairs.length, site.id);
    console.log(`  done. ${formatDuration(est.seconds)}${est.measured ? ` based on ${est.sampleSize} measured audits` : ' (estimated)'}\n`);
  } finally {
    await getRedis().quit();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
