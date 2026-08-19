/**
 * Resets a user's password from the command line.
 *
 * The way back in when nobody can sign in -- there is no email-based reset
 * flow yet, and an organisation whose only admin is locked out has no path
 * through the UI.
 *
 *   npm run reset-password -- someone@example.com 'a-new-password'
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../lib/auth/password.ts';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("\n  Usage: npm run reset-password -- someone@example.com 'a-new-password'\n");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('\n  Use at least 12 characters.\n');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) {
      const all = await prisma.user.findMany({ select: { email: true }, take: 10 });
      console.error(`\n  No account for ${email}.`);
      if (all.length) console.error(`  Known accounts: ${all.map((u) => u.email).join(', ')}`);
      console.error('');
      process.exit(1);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    });
    console.log(`\n  Password reset for ${user.email}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
