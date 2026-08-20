/**
 * Audits N pages of one group, for real, through the same code path the worker
 * uses. Sequential and rate-limited, so it is safe to run alongside anything.
 *
 *   npm run audit:group -- platform 8 mobile
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { auditPage } from '../lib/services/audit.service.ts';
import { createRun, finalizeRun } from '../lib/services/run.service.ts';
import { PsiRateLimiter } from '../lib/psi/rateLimiter.ts';
import { createRedis } from '../lib/redis.ts';
import type { PsiStrategy } from '../lib/psi/types.ts';

async function main() {
  const slug = process.argv[2] ?? 'platform';
  const limit = Number(process.argv[3] ?? 8);
  const strategy = (process.argv[4] ?? 'mobile') as PsiStrategy;

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const redis = createRedis(process.env.REDIS_URL!);
  const limiter = new PsiRateLimiter({
    redis,
    max: Number(process.env.PSI_RATE_MAX ?? 3),
    windowMs: Number(process.env.PSI_RATE_WINDOW_MS ?? 4000),
    keyPrefix: 'psa:psi:rate',
  });

  try {
    const site = await prisma.site.findFirstOrThrow();
    const pages = await prisma.page.findMany({
      where: { siteId: site.id, isActive: true, group: { slug } },
      select: { id: true, url: true },
      orderBy: { path: 'asc' },
      take: limit,
    });
    if (pages.length === 0) throw new Error(`No active pages in group "${slug}"`);

    const runId = await createRun(prisma, {
      siteId: site.id,
      type: 'group',
      triggeredBy: 'manual',
      scope: { kind: 'group', ref: slug, strategies: [strategy] },
      totalJobs: pages.length,
    });

    console.log(`\n  ${pages.length} pages in "${slug}" (${strategy}) — roughly ${Math.ceil(pages.length / 0.75 / 60)} min\n`);
    const t0 = Date.now();

    for (const [i, p] of pages.entries()) {
      const started = Date.now();
      try {
        const o = await auditPage({ prisma, limiter }, { runId, pageId: p.id, url: p.url, strategy });
        const r = await prisma.auditResult.findFirst({
          where: { auditRunId: runId, pageId: p.id, strategy },
          select: { performanceScore: true, status: true },
        });
        console.log(
          `  ${String(i + 1).padStart(2)}/${pages.length}  ${String(r?.performanceScore ?? '--').padStart(3)}  ` +
            `${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s  ${o.written ? '' : '(replay) '}${new URL(p.url).pathname}`,
        );
      } catch (e) {
        console.log(`  ${String(i + 1).padStart(2)}/${pages.length}  ERR       ${new URL(p.url).pathname} — ${e instanceof Error ? e.message : e}`);
      }
    }

    const status = await finalizeRun(prisma, runId);
    console.log(`\n  run ${status} in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min\n`);
  } finally {
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
