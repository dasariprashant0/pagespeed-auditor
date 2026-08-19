import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getEnv } from './env.ts';

/**
 * Prisma 7 takes the connection through a driver adapter rather than a `url`
 * in schema.prisma. The CLI reads its URL from prisma.config.ts instead.
 *
 * Singleton in two directions: Next's dev HMR re-evaluates modules on every
 * edit, and the worker is a separate long-lived process. Both would otherwise
 * open a new pool per reload.
 */

function create(): PrismaClient {
  const env = getEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { __psaPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__psaPrisma ?? create();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__psaPrisma = prisma;
}

/**
 * AuditResult carries a pruned-but-still-large rawJson column. Selecting it by
 * accident in a list query detoasts hundreds of MB, so every list/aggregate
 * path uses this instead of Prisma's default (which is SELECT *).
 *
 * Note `status` is included deliberately: error rows exist with null scores,
 * and callers must filter them out of averages and trends.
 */
export const AUDIT_RESULT_SUMMARY_SELECT = {
  id: true,
  pageId: true,
  auditRunId: true,
  strategy: true,
  status: true,
  runtimeError: true,
  performanceScore: true,
  accessibilityScore: true,
  bestPracticesScore: true,
  seoScore: true,
  lcp: true,
  cls: true,
  fcp: true,
  ttfb: true,
  inp: true,
  tbt: true,
  speedIndex: true,
  fieldSource: true,
  fieldOverall: true,
  fieldLcp: true,
  fieldInp: true,
  fieldCls: true,
  fieldFcp: true,
  fieldTtfb: true,
  finalUrl: true,
  lighthouseVersion: true,
  createdAt: true,
} as const;
