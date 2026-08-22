import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { requireRunAccess } from '@/lib/services/tenant.service';
import { readRunLog } from '@/lib/opsState';
import { NotProvisionedError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Polled by RunTerminal for the live "what's running" view. Postgres-backed
 * and short-lived (see lib/opsState.ts) -- this is not the durable record of
 * what happened, AuditResult already is that. A run with nothing logged yet
 * (or one that finished, whose log was cleared by finalizeAndNotify) just
 * returns an empty array.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { runId } = await params;
  try {
    await requireRunAccess(session.organizationId, runId);
  } catch (e) {
    if (e instanceof NotProvisionedError) {
      return NextResponse.json({ error: 'not_provisioned' }, { status: 409 });
    }
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const events = await readRunLog(session.organizationId, runId);
  return NextResponse.json({ events }, { headers: { 'cache-control': 'no-store' } });
}
