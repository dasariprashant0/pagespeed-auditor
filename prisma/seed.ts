/**
 * Development seed.
 *
 * Since accounts became real, the first admin is created by signing up through
 * the UI, not from environment variables -- so this no longer invents a user.
 * It only makes sure a development install has an organisation and a site to
 * work with, and it never overwrites anything that already exists.
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

  const sitemapUrl = process.env.SITE_SITEMAP_URL;
  const baseUrl = process.env.SITE_BASE_URL;

  const existingSite = await prisma.site.findFirst({ where: { organizationId: org.id } });
  if (existingSite) {
    console.log(`  site          ${existingSite.name} (${existingSite.baseUrl}) — left as is`);
  } else if (sitemapUrl && baseUrl) {
    // Only used to bootstrap a fresh dev database; sites are added in the UI.
    const site = await prisma.site.create({
      data: {
        organizationId: org.id,
        name: process.env.SITE_NAME || 'My site',
        sitemapUrl,
        baseUrl,
        psiApiKey: process.env.PSI_API_KEY || null,
      },
    });
    console.log(`  site          ${site.name} (${site.baseUrl}) — created`);
  } else {
    console.log('  site          none (add one in the app, or set SITE_BASE_URL and SITE_SITEMAP_URL)');
  }

  const site = await prisma.site.findFirst({ where: { organizationId: org.id } });
  if (site) {
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
  }

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
