/**
 * Queues an audit through the real worker, rather than running it inline.
 *
 *   npm run audit:queue -- platform          # whole group, both strategies
 *   npm run audit:queue -- platform mobile   # one strategy
 *
 * Preferred over audit:group for anything non-trivial: the worker retries
 * transient PSI failures on the configured backoff, and the run shows up in the
 * dashboard's progress bar.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BOTH_STRATEGIES, createRun, expandScope, findActiveRun } from '../lib/services/run.service.ts';
import { enqueueAuditJobs } from '../lib/queue/producers.ts';
import { closeQueues } from '../lib/queue/queues.ts';
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
    await enqueueAuditJobs(runId, pairs);

    const est = await estimateRun(pairs.length, site.id);
    console.log(`\n  queued ${pairs.length} calls for "${slug}" (${strategies.join(', ')})`);
    console.log(`  ${formatDuration(est.seconds)}${est.measured ? ` based on ${est.sampleSize} measured audits` : ' (estimated)'}`);
    console.log(`  run ${runId}\n`);
  } finally {
    await closeQueues();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
