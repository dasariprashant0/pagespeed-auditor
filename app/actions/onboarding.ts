'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/http/auth-guard';
import { centralPrisma } from '@/lib/db/central';

/**
 * Every one of these requires only a session, not a specific capability --
 * dismissing your own onboarding view is not an org-admin action, per
 * docs/superpowers/specs/2026-08-22-onboarding-tour-design.md section B.
 */

/** Idempotent: a duplicate id in the array changes nothing observable, since remainingTourSteps() dedupes via a Set. */
export async function markTourStepSeenAction(stepId: string): Promise<void> {
  const ctx = await requireSession();
  await centralPrisma.membership.updateMany({
    where: { userId: ctx.userId, organizationId: ctx.organizationId },
    data: { tourStepsSeen: { push: stepId } },
  });
}

export async function dismissChecklistAction(): Promise<void> {
  const ctx = await requireSession();
  await centralPrisma.membership.updateMany({
    where: { userId: ctx.userId, organizationId: ctx.organizationId },
    data: { checklistDismissedAt: new Date() },
  });
  revalidatePath('/', 'layout');
}

export async function reopenChecklistAction(): Promise<void> {
  const ctx = await requireSession();
  await centralPrisma.membership.updateMany({
    where: { userId: ctx.userId, organizationId: ctx.organizationId },
    data: { checklistDismissedAt: null },
  });
  revalidatePath('/', 'layout');
}
