'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { getTenantPrisma } from '@/lib/db/tenant';

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sets the order groups are swept in.
 *
 * A full sweep is ~35 minutes, so when someone is watching a specific fix they
 * want those pages measured first rather than whenever the sitemap happens to
 * reach them. Passing an empty list clears every override and returns the site
 * to sitemap order.
 */
export async function reorderGroupsAction(slugsInOrder: string[]): Promise<ActionResult> {
  try {
    const ctx = await requireCapability('groups:manage');
    const prisma = await getTenantPrisma(ctx.organizationId);
    await prisma.$transaction(async (tx) => {
      // Scoped to this organisation: an unscoped updateMany keyed on slug would
      // reorder another tenant's sections, since slugs are only unique per site.
      const owned = await tx.group.findMany({
        where: { slug: { in: slugsInOrder }, site: { organizationId: ctx.organizationId } },
        select: { id: true, slug: true },
      });
      const idBySlug = new Map(owned.map((g) => [g.slug, g.id]));

      for (const [i, slug] of slugsInOrder.entries()) {
        const id = idBySlug.get(slug);
        if (id) await tx.group.update({ where: { id }, data: { priority: i } });
      }
    });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save the order.' };
  }
}

/** Drops every manual position, returning to the sitemap's own order. */
export async function resetGroupOrderAction(): Promise<ActionResult> {
  try {
    const ctx = await requireCapability('groups:manage');
    const prisma = await getTenantPrisma(ctx.organizationId);
    await prisma.group.updateMany({
      where: { site: { organizationId: ctx.organizationId } },
      data: { priority: null },
    });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reset the order.' };
  }
}

export async function setGroupPriorityAction(slugsInOrder: string[]): Promise<ActionResult> {
  try {
    const ctx = await requireCapability('groups:manage');
    const prisma = await getTenantPrisma(ctx.organizationId);
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
