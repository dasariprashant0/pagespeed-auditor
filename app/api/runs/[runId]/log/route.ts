import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/http/auth-guard';
import { requireRunAccess } from '@/lib/services/tenant.service';
import { readRunLog } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * Polled by RunTerminal for the live "what's running" view. Redis-backed and
 * short-lived (see lib/redis.ts) -- this is not the durable record of what
 * happened, AuditResult already is that. A run with nothing logged yet (or
 * one that finished and aged out of the list) just returns an empty array.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { runId } = await params;
  try {
    await requireRunAccess(session.organizationId, runId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const events = await readRunLog(runId);
  return NextResponse.json({ events }, { headers: { 'cache-control': 'no-store' } });
}
