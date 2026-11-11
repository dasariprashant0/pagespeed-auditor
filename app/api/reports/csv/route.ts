import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';
import { defaultSite } from '@/lib/services/tenant.service';
import { toCsv } from '@/lib/report/csv';
import { bucketOf, cwvAssessment } from '@/lib/psi/buckets';
import { NotProvisionedError } from '@/lib/errors';
import type { Bucket } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

const HEADER = [
  'url', 'path', 'group', 'strategy', 'status', 'runtime_error', 'measured_at',
  'performance', 'accessibility', 'best_practices', 'seo',
  'lab_lcp_ms', 'lab_cls', 'lab_fcp_ms', 'lab_ttfb_ms', 'lab_tbt_ms', 'lab_speed_index_ms',
  'field_source', 'cwv_assessment', 'field_lcp_ms', 'field_inp_ms', 'field_cls', 'field_fcp_ms', 'field_ttfb_ms',
];

const round = (v: number | null) => (v === null ? null : Math.round(v));

/**
 * Latest scores for every active page, one row per page per strategy, for a
 * spreadsheet. `?group=<slug>` narrows it to one section.
 */
export async function GET(req: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const groupSlug = new URL(req.url).searchParams.get('group');

  let site: Awaited<ReturnType<typeof defaultSite>>;
  let prisma: Awaited<ReturnType<typeof getTenantPrisma>>;
  try {
    site = await defaultSite(session.organizationId);
    prisma = await getTenantPrisma(session.organizationId);
  } catch (e) {
    if (e instanceof NotProvisionedError) return NextResponse.json({ error: 'not_provisioned' }, { status: 409 });
    throw e;
  }
  if (!site) return new NextResponse('No site configured.', { status: 404 });

  const pages = await prisma.page.findMany({
    where: { siteId: site.id, isActive: true, ...(groupSlug ? { group: { slug: groupSlug } } : {}) },
    select: {
      url: true, path: true, latestResultMobileId: true, latestResultDesktopId: true,
      group: { select: { name: true } },
    },
    orderBy: [{ sitemapIndex: { sort: 'asc', nulls: 'last' } }, { path: 'asc' }],
  });

  const ids = pages.flatMap((p) => [p.latestResultMobileId, p.latestResultDesktopId]).filter((id): id is string => !!id);
  // Explicit select: never pull fieldJson or anything large for an export.
  const results = await prisma.auditResult.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, strategy: true, status: true, runtimeError: true, createdAt: true,
      performanceScore: true, accessibilityScore: true, bestPracticesScore: true, seoScore: true,
      lcp: true, cls: true, fcp: true, ttfb: true, tbt: true, speedIndex: true,
      fieldSource: true, fieldLcp: true, fieldInp: true, fieldCls: true, fieldFcp: true, fieldTtfb: true,
    },
  });
  const byId = new Map(results.map((r) => [r.id, r]));

  const rows = pages.flatMap((p) =>
    [p.latestResultMobileId, p.latestResultDesktopId].flatMap((id) => {
      const r = id ? byId.get(id) : undefined;
      if (!r) return [];
      // Recomputed rather than read from fieldOverall: rows written before the
      // LCP/INP/CLS-only fix stored PSI's overall_category there.
      const metric = (k: 'lcp' | 'inp' | 'cls', v: number | null) => {
        const bucket = bucketOf(k, v);
        return bucket ? { bucket } : undefined;
      };
      const cwv: Bucket | null = cwvAssessment({
        lcp: metric('lcp', r.fieldLcp), inp: metric('inp', r.fieldInp), cls: metric('cls', r.fieldCls),
      });
      return [[
        p.url, p.path, p.group?.name ?? '', r.strategy, r.status, r.runtimeError, r.createdAt.toISOString(),
        r.performanceScore, r.accessibilityScore, r.bestPracticesScore, r.seoScore,
        round(r.lcp), r.cls?.toFixed(3) ?? null, round(r.fcp), round(r.ttfb), round(r.tbt), round(r.speedIndex),
        r.fieldSource, cwv === null ? null : cwv === 'good' ? 'passed' : 'failed',
        round(r.fieldLcp), round(r.fieldInp), r.fieldCls?.toFixed(3) ?? null, round(r.fieldFcp), round(r.fieldTtfb),
      ]];
    }),
  );

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(HEADER, rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pagespeed-${groupSlug ?? 'site'}-${date}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
