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
  const strategy = (url.searchParams.get('strategy') === 'desktop' ? 'desktop' : 'mobile') as PsiStrategy;
  const includePassed = url.searchParams.get('passed') === '1';

  // Same id-in-the-URL exposure as the report page.
  try {
    await requirePageAccess(session.organizationId, pageId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const report = await getPageReport(pageId, strategy);
  const md = buildAgentReport(report, { includePassed });

  const slug = (report.page.path.replace(/^\/|\/$/g, '') || 'home').replace(/[^a-z0-9]+/gi, '-');
  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-${strategy}.md"`,
      'cache-control': 'no-store',
    },
  });
}
