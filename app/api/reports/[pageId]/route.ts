import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getPageReport } from '@/lib/services/report.service';
import { requirePageAccess } from '@/lib/services/tenant.service';
import { buildAgentReport } from '@/lib/report/agentMarkdown';
import type { PsiStrategy } from '@/lib/services/types';

export const dynamic = 'force-dynamic';

/**
 * The markdown a coding agent gets fed.
 *
 * Served as a download rather than shown in the UI: the point is to hand the
 * file to Cursor / Claude / Codex, not to read it here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { pageId } = await params;
  const url = new URL(req.url);
  const asked = url.searchParams.get('strategy');
  // "both" is one file, not two downloads: an agent given mobile and desktop
  // side by side can tell a device-specific problem from a page-wide one, and
  // two separate files it has to correlate loses exactly that.
  const wanted: PsiStrategy[] =
    asked === 'both' ? ['mobile', 'desktop'] : asked === 'desktop' ? ['desktop'] : ['mobile'];
  const includePassed = url.searchParams.get('passed') === '1';

  // Same id-in-the-URL exposure as the report page.
  try {
    await requirePageAccess(session.organizationId, pageId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const reports = await Promise.all(wanted.map((s) => getPageReport(pageId, s)));
  // A strategy the page was never measured on is skipped rather than emitted
  // as an empty section -- a heading with nothing under it reads as a result.
  const parts = reports
    .map((report, i) => (report.result ? { strategy: wanted[i], report } : null))
    .filter((x): x is { strategy: PsiStrategy; report: (typeof reports)[number] } => x !== null);

  if (parts.length === 0) {
    return new NextResponse('This page has not been measured yet.', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const first = reports[0];
  const slug = (first.page.path.replace(/^\/|\/$/g, '') || 'home').replace(/[^a-z0-9]+/gi, '-');
  const suffix = parts.length > 1 ? 'mobile-and-desktop' : parts[0].strategy;

  const md =
    parts.length === 1
      ? buildAgentReport(parts[0].report, { includePassed })
      : [
          `# ${first.page.path} — mobile and desktop`,
          '',
          'Both measurements of the same page. Fix what appears in both first: that is the',
          'page itself. Anything in only one is device-specific — usually an image size, a',
          'viewport-conditional script, or a layout that only reflows at one width.',
          '',
          '---',
          '',
          ...parts.map(
            ({ strategy: s, report }) =>
              `## Measured as ${s === 'mobile' ? 'mobile' : 'a desktop browser'}\n\n` +
              buildAgentReport(report, { includePassed }),
          ),
        ].join('\n');

  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-${suffix}.md"`,
      'cache-control': 'no-store',
    },
  });
}
