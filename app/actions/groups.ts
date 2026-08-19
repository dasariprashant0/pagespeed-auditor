'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sets the order groups are swept in.
 *
 * A full sweep is ~35 minutes, so when someone is watching a specific fix they
 * want those pages measured first rather than whenever the sitemap happens to
 * reach them. Passing an empty list clears every override and returns the site
 * to sitemap order.
 */
export async function setGroupPriorityAction(slugsInOrder: string[]): Promise<ActionResult> {
  await requireCapability('groups:manage');

  try {
    await prisma.$transaction(async (tx) => {
      // Clear first: a group dropped from the list must fall back to sitemap
      // order rather than keeping a stale number.
      await tx.group.updateMany({ data: { priority: null } });
      for (const [i, slug] of slugsInOrder.entries()) {
        await tx.group.updateMany({ where: { slug }, data: { priority: i } });
      }
    });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the order.' };
  }
}
