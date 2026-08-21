import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Local-dev-only. There is no fixed tenant database at build or runtime --
 * every real tenant database is provisioned on demand from
 * lib/tenantDb/migrations.generated.ts (built by
 * scripts/build-tenant-migrations.ts from this schema's migrations/
 * directory), never by pointing this config at a live connection string.
 * This file exists so `prisma migrate dev --config prisma/tenant/prisma.config.ts`
 * can author and verify new tenant migrations against a throwaway local
 * database before they're baked into that generated module.
 */
export default defineConfig({
  schema: 'schema.prisma',
  datasource: {
    url: env('TENANT_DEV_DATABASE_URL'),
  },
});
