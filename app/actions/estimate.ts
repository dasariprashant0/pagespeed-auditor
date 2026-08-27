'use server';

import { requireCapability } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';
import { estimateRun, formatDuration } from '@/lib/services/estimate.service';

export type EstimatePreview = {
  jobs: number;
  eta: string;
  measured: boolean;
  medianSeconds: number;
  sampleSize: number;
};

/**
 * What a run WOULD cost, before committing to it.
 *
 * Reads the same measured history the post-queue estimate uses, so the number
 * shown on the button and the number shown after clicking it agree.
 */
export async function previewEstimateAction(input: {
  kind: 'page' | 'group' | 'pages';
  ref: string;
  strategyCount?: number;
}): Promise<EstimatePreview> {
  const ctx = await requireCapability('reports:read');
  const prisma = await getTenantPrisma(ctx.organizationId);

  const strategies = input.strategyCount ?? 2;
  const pageCount =
    input.kind === 'page'
      ? 1
      // `ref` is already the exact comma-joined selection -- counting it
      // directly avoids a query for what's already known, and matches what
      // expandScope will actually do with the same ids.
      : input.kind === 'pages'
        ? input.ref.split(',').filter(Boolean).length
        : await prisma.page.count({ where: { isActive: true, group: { slug: input.ref } } });

  const est = await estimateRun(ctx.organizationId, pageCount * strategies);
  return {
    jobs: est.jobs,
    eta: formatDuration(est.seconds),
    measured: est.measured,
    medianSeconds: Math.round(est.medianCallMs / 1000),
    sampleSize: est.sampleSize,
  };
}
