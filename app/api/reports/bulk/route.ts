import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';
import { defaultSite } from '@/lib/services/tenant.service';
import { getPageReport } from '@/lib/services/report.service';
import { buildAgentReport } from '@/lib/report/agentMarkdown';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Every audited page in a group as one markdown file.
 *
 * One file rather than a zip: an agent is handed a single document, and a
 * cross-page view is what surfaces the shared root cause -- the same blocking
 * stylesheet on forty pages is one fix, not forty.
 */
export async function GET(req: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const groupSlug = url.searchParams.get('group');
  const asked = url.searchParams.get('strategy');
  const wanted: PsiStrategy[] =
    asked === 'both' ? ['mobile', 'desktop'] : asked === 'desktop' ? ['desktop'] : ['mobile'];
  const strategy = wanted[0];
  // Capped: a whole-site export would be megabytes and blow any agent's context.
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 50);

  const site = await defaultSite(session.organizationId);
  if (!site) return new NextResponse('No site configured.', { status: 404 });

  const prisma = await getTenantPrisma(session.organizationId);
  const pages = await prisma.page.findMany({
    where: {
      siteId: site.id,
      isActive: true,
      ...(groupSlug ? { group: { slug: groupSlug } } : {}),
      // Only pages with something to report.
      OR: [{ latestResultMobileId: { not: null } }, { latestResultDesktopId: { not: null } }],
    },
    select: { id: true, path: true },
    orderBy: [{ sitemapIndex: 'asc' }, { path: 'asc' }],
    take: limit,
  });

  if (pages.length === 0) {
    return new NextResponse('No audited pages here yet.', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  const reports = await Promise.all(
    pages.map(async (p) => {
      const sections: string[] = [];
      for (const s of wanted) {
        try {
          const report = await getPageReport(session.organizationId, p.id, s);
          if (!report.result) continue;
          sections.push(
            wanted.length > 1
              ? `## ${p.path} — ${s === 'mobile' ? 'mobile' : 'desktop'}\n\n${buildAgentReport(report)}`
              : buildAgentReport(report),
          );
        } catch {
          sections.push(`# ${p.path}\n\nCould not build a ${s} report for this page.`);
        }
      }
      return sections.join('\n\n');
    }),
  );

  const header = [
    `# PageSpeed fixes — ${site.name}${groupSlug ? ` / ${groupSlug}` : ''}`,
    '',
    `${pages.length} page${pages.length === 1 ? '' : 's'}, tested as ${wanted.length > 1 ? 'mobile and desktop' : strategy}. Generated ${new Date().toISOString()}.`,
    '',
    'Each page below is a separate report. Before working page by page, read across',
    'them: a problem that appears on most pages is one shared fix (a template, a',
    'global stylesheet, a third-party tag), not one fix per page.',
    '',
    '---',
    '',
  ].join('\n');

  const slug = groupSlug ?? 'site';
  return new NextResponse(header + reports.join('\n\n---\n\n'), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="pagespeed-${slug}-${wanted.length > 1 ? 'mobile-and-desktop' : strategy}.md"`,
      'cache-control': 'no-store',
    },
  });
}
