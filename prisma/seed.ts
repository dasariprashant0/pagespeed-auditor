/**
 * Idempotent seed: the single team user, the one Site, and its disabled-by-default
 * Schedule and NotificationSetting rows.
 *
 * Safe to re-run. Changing AUTH_PASSWORD_HASH in .env and re-seeding rotates the
 * password; changing SITE_SITEMAP_URL re-points the site without touching pages
 * or audit history.
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
  const username = process.env.AUTH_USERNAME || 'admin';
  const passwordHash = process.env.AUTH_PASSWORD_HASH || '';

  if (!passwordHash) {
    // Not fatal -- the schema and site are still worth seeding during early
    // development -- but login cannot work, so say so loudly rather than
    // creating a user with an empty hash that silently accepts nothing.
    console.warn(
      '\n  AUTH_PASSWORD_HASH is empty. Skipping user creation.\n' +
        "  Generate one with:  npm run hash-password -- 'your-password'\n",
    );
  } else {
    const user = await prisma.user.upsert({
      where: { username },
      update: { passwordHash },
      create: { username, passwordHash },
    });
    console.log(`  user      ${user.username}`);
  }

  const sitemapUrl = process.env.SITE_SITEMAP_URL;
  const baseUrl = process.env.SITE_BASE_URL;
  if (!sitemapUrl || !baseUrl) {
    console.warn('  SITE_SITEMAP_URL / SITE_BASE_URL not set — skipping site seed.');
    return;
  }

  // One site, keyed by sitemap URL so re-seeding updates rather than duplicates.
  const existing = await prisma.site.findFirst({ where: { sitemapUrl } });
  const site = existing
    ? await prisma.site.update({
        where: { id: existing.id },
        data: { name: process.env.SITE_NAME || 'Company Site', baseUrl },
      })
    : await prisma.site.create({
        data: { name: process.env.SITE_NAME || 'Company Site', sitemapUrl, baseUrl },
      });
  console.log(`  site      ${site.name} (${site.baseUrl})`);

  // Both disabled by default, per spec §12 -- nothing fires until a human opts in.
  await prisma.schedule.upsert({
    where: { siteId: site.id },
    update: {},
    create: { siteId: site.id, enabled: false },
  });
  await prisma.notificationSetting.upsert({
    where: { siteId: site.id },
    update: {},
    create: { siteId: site.id },
  });
  console.log('  schedule  disabled (no cron set)');
  console.log('  notify    email off, slack off');
}

main()
  .then(() => console.log('\nSeed complete.\n'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
