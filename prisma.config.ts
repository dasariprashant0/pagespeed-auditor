import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moved the connection URL out of schema.prisma. The CLI (migrate,
// studio, db push) reads it from here; the runtime client gets it via the
// driver adapter in lib/db.ts instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
