import type { PrismaClient } from '@prisma/client';

/**
 * Manual group edits. Both operations leave a GroupAlias behind, which is the
 * whole point: without it, the next ingest recreates the old slug and pulls the
 * pages straight back out.
 */

export async function renameGroup(
  prisma: PrismaClient,
  groupId: string,
  newName: string,
  newSlug?: string,
): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

  await prisma.$transaction(async (tx) => {
    if (newSlug && newSlug !== group.slug) {
      // The old slug must keep resolving here, or re-ingest recreates it.
      await tx.groupAlias.upsert({
        where: { slug: group.slug },
        update: { groupId },
        create: { slug: group.slug, groupId },
      });
    }
    await tx.group.update({
      where: { id: groupId },
      // isManual: the group's identity is now user-owned.
      data: { name: newName, slug: newSlug ?? group.slug, isManual: true },
    });
  });
}

export async function mergeGroups(
  prisma: PrismaClient,
  sourceIds: string[],
  targetId: string,
): Promise<{ pagesMoved: number; aliasesCreated: number }> {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) return { pagesMoved: 0, aliasesCreated: 0 };

  return prisma.$transaction(async (tx) => {
    const sourceGroups = await tx.group.findMany({
      where: { id: { in: sources } },
      select: { id: true, slug: true },
    });

    const moved = await tx.page.updateMany({
      where: { groupId: { in: sources } },
      data: { groupId: targetId },
    });

    // Every merged-away slug becomes an alias pointing at the target.
    for (const g of sourceGroups) {
      await tx.groupAlias.upsert({
        where: { slug: g.slug },
        update: { groupId: targetId },
        create: { slug: g.slug, groupId: targetId },
      });
    }
    // Re-point any aliases that already pointed at a source.
    await tx.groupAlias.updateMany({ where: { groupId: { in: sources } }, data: { groupId: targetId } });

    await tx.group.update({ where: { id: targetId }, data: { isManual: true } });
    await tx.group.deleteMany({ where: { id: { in: sources } } });

    return { pagesMoved: moved.count, aliasesCreated: sourceGroups.length };
  });
}
