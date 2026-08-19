/**
 * Proves one tenant cannot reach another's data.
 *
 * Asserting isolation in a comment is worth nothing; this creates two real
 * organisations with real sites and pages, then attempts every cross-tenant
 * access the app exposes and requires each to be refused.
 *
 *   npm run verify:tenants
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  requireSiteAccess, requirePageAccess, requireGroupAccess, requireRunAccess, defaultSite, listSites,
} from '../lib/services/tenant.service.ts';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** A cross-tenant read must throw. Returning data is the failure. */
async function mustRefuse(label: string, fn: () => Promise<unknown>) {
  try {
    const got = await fn();
    check(label, false, `returned ${JSON.stringify(got).slice(0, 80)} instead of refusing`);
  } catch {
    check(label, true);
  }
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const stamp = Date.now();

  const orgA = await prisma.organization.create({ data: { name: 'Tenant A', slug: `tenant-a-${stamp}` } });
  const orgB = await prisma.organization.create({ data: { name: 'Tenant B', slug: `tenant-b-${stamp}` } });

  try {
    const siteA = await prisma.site.create({
      data: { organizationId: orgA.id, name: 'A site', baseUrl: 'https://a.test', sitemapUrl: 'https://a.test/s.xml', psiApiKey: 'KEY-A' },
    });
    const siteB = await prisma.site.create({
      data: { organizationId: orgB.id, name: 'B site', baseUrl: 'https://b.test', sitemapUrl: 'https://b.test/s.xml', psiApiKey: 'KEY-B' },
    });

    const groupB = await prisma.group.create({ data: { siteId: siteB.id, name: 'Secret', slug: 'secret' } });
    const pageB = await prisma.page.create({
      data: { siteId: siteB.id, groupId: groupB.id, url: 'https://b.test/secret', path: '/secret' },
    });
    const runB = await prisma.auditRun.create({
      data: { siteId: siteB.id, type: 'page', triggeredBy: 'manual', status: 'completed', totalJobs: 1 },
    });

    console.log('\n  A sees only its own\n');
    const sites = await listSites(orgA.id);
    check('listSites returns one site', sites.length === 1, `${sites.length}`);
    check('and it is A\'s', sites[0]?.id === siteA.id);
    check('the PSI key never leaves the server', !('psiApiKey' in (sites[0] ?? {})), 'only hasPsiKey is exposed');
    check('defaultSite is scoped', (await defaultSite(orgA.id))?.id === siteA.id);

    console.log('\n  A cannot reach B by id\n');
    await mustRefuse("A cannot open B's site", () => requireSiteAccess(orgA.id, siteB.id));
    await mustRefuse("A cannot open B's page", () => requirePageAccess(orgA.id, pageB.id));
    await mustRefuse("A cannot open B's group", () => requireGroupAccess(orgA.id, 'secret'));
    await mustRefuse("A cannot poll B's run", () => requireRunAccess(orgA.id, runB.id));

    console.log('\n  B still can\n');
    check("B opens its own page", (await requirePageAccess(orgB.id, pageB.id)).id === pageB.id);
    check("B opens its own group", (await requireGroupAccess(orgB.id, 'secret')).id === groupB.id);
    check("B polls its own run", (await requireRunAccess(orgB.id, runB.id)).id === runB.id);

    console.log('\n  Deleting a tenant removes its data, not the other\'s\n');
    await prisma.organization.delete({ where: { id: orgB.id } });
    check("B's pages went with it", (await prisma.page.count({ where: { id: pageB.id } })) === 0);
    check("A's site survived", (await prisma.site.count({ where: { id: siteA.id } })) === 1);
  } finally {
    await prisma.organization.deleteMany({ where: { slug: { in: [`tenant-a-${stamp}`, `tenant-b-${stamp}`] } } });
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\n  TENANT ISOLATION HOLDS\n' : `\n  ${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
