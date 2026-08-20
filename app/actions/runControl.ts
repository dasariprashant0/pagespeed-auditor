'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { requireRunAccess } from '@/lib/services/tenant.service';
import { prisma } from '@/lib/db';
import { controlRun, type RunControl, type RunControlResult } from '@/lib/services/run.service';
import { workflowRunQueue } from '@/lib/workflows/runControl';

export type RunControlActionResult =
  | ({ ok: true } & RunControlResult)
  | { ok: false; error: string };

/** Hold, continue, or stop a run that is already in flight. */
export async function controlRunAction(input: {
  runId: string;
  action: RunControl;
}): Promise<RunControlActionResult> {
  try {
    const ctx = await requireCapability('audits:run');
    // Server Actions are public endpoints; the run id in the form is not proof
    // the caller's organisation owns it.
    await requireRunAccess(ctx.organizationId, input.runId);

    const r = await controlRun(prisma, input.runId, input.action, workflowRunQueue(input.runId));
    revalidatePath('/runs');
    revalidatePath(`/runs/${input.runId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not change the run.' };
  }
}
