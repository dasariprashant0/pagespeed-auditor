/**
 * Runs sitemap ingestion against the seeded site.
 *
 *   npm run ingest              # write
 *   npm run ingest -- --dry     # crawl and report, write nothing
 */
import 'dotenv/config';
import { PrismaClient } from '../lib/generated/tenant/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { ingestSitemap } from '../lib/services/ingest.service.ts';

async function main() {
  const connectionString = process.env.TENANT_DEV_DATABASE_URL!;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const dryRun = process.argv.includes('--dry');

  try {
    const site = await prisma.site.findFirstOrThrow();
    console.log(`\n  site: ${site.name} (${site.baseUrl})${dryRun ? '  [DRY RUN]' : ''}`);

    const t0 = Date.now();
    const s = await ingestSitemap(prisma, site.id, { dryRun });
    console.log(`  completed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    console.log(`  discovered     ${s.discovered}`);
    console.log(`  created        ${s.created}`);
    console.log(`  updated        ${s.updated}`);
    console.log(`  reactivated    ${s.reactivated}`);
    console.log(`  deactivated    ${s.deactivated}`);
    console.log(`  regrouped      ${s.regrouped}`);
    console.log(`  groups created ${s.groupsCreated}`);
    console.log(`  duplicates     ${s.duplicates}`);
    const rej = Object.entries(s.rejected).filter(([, v]) => v > 0);
    console.log(`  rejected       ${rej.length ? rej.map(([k, v]) => `${k}=${v}`).join(', ') : 'none'}`);
    if (s.errors.length) console.log(`  errors         ${s.errors.length}`);
    console.log();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
