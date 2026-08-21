import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { getRunProgress } from '@/lib/services/site.service';
import { requireRunAccess } from '@/lib/services/tenant.service';

export const dynamic = 'force-dynamic';

/** Polled by RunProgress. See docs/PLAN.md for why this is polling, not SSE. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { runId } = await params;
  try {
    await requireRunAccess(session.organizationId, runId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const progress = await getRunProgress(session.organizationId, runId);
  if (!progress) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(progress, { headers: { 'cache-control': 'no-store' } });
}
