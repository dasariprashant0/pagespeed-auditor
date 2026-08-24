/**
 * Development seed.
 *
 * Since accounts became real, the first admin is created by signing up
 * through the UI, not from environment variables -- so this no longer
 * invents a user. It only makes sure a development install has an
 * organisation to work with, and it never overwrites anything that
 * already exists.
 *
 * Used to also seed a Site, Schedule, and NotificationSetting here --
 * removed as dead/wrong after the Phase 5 per-tenant cutover
 * (docs/PER_TENANT_ARCHITECTURE.md): those models don't exist in the
 * central schema anymore, and creating them requires a real, provisioned
 * tenant database this script has no way to know or reach. A site is
 * added through the app's own UI, by an admin, after the organisation's
 * tenant database is provisioned under Settings -> Database.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const org =
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.organization.create({ data: { name: 'Default', slug: 'default' } }));
  console.log(`  organisation  ${org.name}`);

  const users = await prisma.user.count();
  console.log(
    users === 0
      ? '\n  No accounts yet — open the app and create one; the first becomes admin.\n'
      : `\n  ${users} account(s) already exist.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
