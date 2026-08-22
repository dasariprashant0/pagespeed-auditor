/**
 * Proves one tenant cannot reach another's data.
 *
 * Asserting isolation in a comment is worth nothing; this creates TWO real,
 * freshly migrated tenant databases -- not two rows in one shared database --
 * and attempts every cross-tenant access the app exposes, requiring each to
 * be refused. Since Phase 5 (docs/DECISIONS.md §19), tenant.service.ts's
 * require*Access functions resolve their own Prisma client per organisation
 * via getTenantPrisma(organizationId), which looks up the encrypted
 * connection string on the central Organization row and throws
 * NotProvisionedError for anything not 'ready'. A single shared database
 * with two fake Organization rows in it (the previous shape of this script)
 * can no longer exercise that path at all -- both fake orgs would just throw
 * NotProvisionedError, and this script's own mustRefuse() treats ANY thrown
 * error as a pass, so it silently stopped proving anything real.
 *
 * Needs two throwaway Postgres databases you don't mind this script wiping
 * on every run (it drops and recreates the `public` schema in each one
 * before migrating, so a crashed previous run doesn't need manual cleanup):
 *
 *   docker exec pagespeed-auditor-postgres-1 psql -U psa -d postgres -c "CREATE DATABASE pagespeed_auditor_tenant_dev_a;"
 *   docker exec pagespeed-auditor-postgres-1 psql -U psa -d postgres -c "CREATE DATABASE pagespeed_auditor_tenant_dev_b;"
 *
 * Then set, alongside the existing single TENANT_DEV_DATABASE_URL
 * (prisma/tenant/prisma.config.ts documents that one's convention):
 *
 *   TENANT_DEV_DATABASE_URL_A=postgresql://psa:psa@localhost:5432/pagespeed_auditor_tenant_dev_a?schema=public
 *   TENANT_DEV_DATABASE_URL_B=postgresql://psa:psa@localhost:5432/pagespeed_auditor_tenant_dev_b?schema=public
 *
 *   npm run verify:tenants
 */
import 'dotenv/config';
import { Client } from 'pg';
import { PrismaClient as CentralPrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { runTenantMigrations } from '../lib/tenantDb/provision.ts';
import { encryptSecret } from '../lib/crypto/secretBox.ts';
import { getTenantPrisma } from '../lib/db/tenant.ts';
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} must be set to a throwaway Postgres connection string this script can freely wipe. See the header comment in scripts/verify-tenant-isolation.ts.`,
    );
  }
  return v;
}

/** Wipes a database back to empty so runTenantMigrations always starts from a clean schema, even after a crashed previous run. */
async function resetSchema(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}

async function main() {
  const urlA = requireEnv('TENANT_DEV_DATABASE_URL_A');
  const urlB = requireEnv('TENANT_DEV_DATABASE_URL_B');

  console.log('\n  provisioning two fresh, isolated tenant databases\n');
  await resetSchema(urlA);
  await resetSchema(urlB);
  await runTenantMigrations(urlA);
  await runTenantMigrations(urlB);

  const central = new CentralPrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const stamp = Date.now();

  // Two real central Organization rows, each pointing (via the same
  // envelope-encrypted tenantDbUrlEnc column and 'ready' provisionStatus a
  // real provisioned org would have) at one of the two databases above.
  // This is what lets getTenantPrisma(orgA.id) / getTenantPrisma(orgB.id) --
  // called internally by every tenant.service.ts function under test --
  // resolve to two genuinely different databases instead of both throwing
  // NotProvisionedError.
  const orgA = await central.organization.create({ data: { name: 'Tenant A', slug: `tenant-a-${stamp}` } });
  const orgB = await central.organization.create({ data: { name: 'Tenant B', slug: `tenant-b-${stamp}` } });
  await central.organization.update({
    where: { id: orgA.id },
    data: { provisionStatus: 'ready', tenantDbUrlEnc: encryptSecret(urlA, `${orgA.id}:tenantDbUrl`) },
  });
  await central.organization.update({
    where: { id: orgB.id },
    data: { provisionStatus: 'ready', tenantDbUrlEnc: encryptSecret(urlB, `${orgB.id}:tenantDbUrl`) },
  });

  try {
    // Resolved exactly the way the app resolves them -- through the same
    // cache tenant.service.ts's functions read from -- so fixture creation
    // and the assertions below are provably hitting the same two databases.
    const dbA = await getTenantPrisma(orgA.id);
    const dbB = await getTenantPrisma(orgB.id);

    const siteA = await dbA.site.create({
      data: { organizationId: orgA.id, name: 'A site', baseUrl: 'https://a.test', sitemapUrl: 'https://a.test/s.xml', psiApiKey: 'KEY-A' },
    });
    const siteB = await dbB.site.create({
      data: { organizationId: orgB.id, name: 'B site', baseUrl: 'https://b.test', sitemapUrl: 'https://b.test/s.xml', psiApiKey: 'KEY-B' },
    });
    const groupB = await dbB.group.create({ data: { siteId: siteB.id, name: 'Secret', slug: 'secret' } });
    const pageB = await dbB.page.create({
      data: { siteId: siteB.id, groupId: groupB.id, url: 'https://b.test/secret', path: '/secret' },
    });
    const runB = await dbB.auditRun.create({
      data: { siteId: siteB.id, type: 'page', triggeredBy: 'manual', status: 'completed', totalJobs: 1 },
    });

    console.log('\n  A sees only its own\n');
    const sites = await listSites(orgA.id);
    check('listSites returns one site', sites.length === 1, `${sites.length}`);
    check('and it is A\'s', sites[0]?.id === siteA.id);
    check('the PSI key never leaves the server', !('psiApiKey' in (sites[0] ?? {})), 'only hasPsiKey is exposed');
    check('defaultSite is scoped', (await defaultSite(orgA.id))?.id === siteA.id);

    console.log("\n  A cannot reach B's ids -- because A's own client is a different database, not because of a query filter\n");
    await mustRefuse("A cannot open B's site", () => requireSiteAccess(orgA.id, siteB.id));
    await mustRefuse("A cannot open B's page", () => requirePageAccess(orgA.id, pageB.id));
    await mustRefuse("A cannot open B's group", () => requireGroupAccess(orgA.id, 'secret'));
    await mustRefuse("A cannot poll B's run", () => requireRunAccess(orgA.id, runB.id));

    console.log('\n  B still can, against its own real database\n');
    check('B opens its own page', (await requirePageAccess(orgB.id, pageB.id)).id === pageB.id);
    check('B opens its own group', (await requireGroupAccess(orgB.id, 'secret')).id === groupB.id);
    check('B polls its own run', (await requireRunAccess(orgB.id, runB.id)).id === runB.id);

    console.log("\n  Proving this is real cross-database isolation, not just a WHERE clause\n");
    // Query B's own client -- the actual database B's tenant service calls
    // resolve to -- for an id that only exists in A's database. There is no
    // row to find, not merely a filtered-out one; a shared-database version
    // of this check couldn't tell those two apart.
    const crossRead = await dbB.site.findUnique({ where: { id: siteA.id } });
    check("B's own database genuinely has no row for A's site id", crossRead === null);
  } finally {
    // getTenantPrisma caches its clients globally by organisationId; disconnect
    // through it rather than a second ad hoc client so nothing is left pooling.
    // Must happen BEFORE the central Organization rows are deleted below --
    // once they're gone, getTenantPrisma can no longer resolve which database
    // to disconnect from.
    await (await getTenantPrisma(orgA.id).catch(() => null))?.$disconnect().catch(() => {});
    await (await getTenantPrisma(orgB.id).catch(() => null))?.$disconnect().catch(() => {});
    await central.organization.deleteMany({ where: { slug: { in: [`tenant-a-${stamp}`, `tenant-b-${stamp}`] } } });
    await central.$disconnect();
    await resetSchema(urlA).catch(() => {});
    await resetSchema(urlB).catch(() => {});
  }

  console.log(failures === 0 ? '\n  TENANT ISOLATION HOLDS\n' : `\n  ${failures} FAILURE(S)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
