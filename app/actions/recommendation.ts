'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { requirePageAccess } from '@/lib/services/tenant.service';
import {
  getOrCreateRecommendation,
  listRecommendations,
  type RecommendationVersion,
} from '@/lib/services/recommendation.service';
import type { PsiStrategy } from '@/lib/services/types';

export type RecommendationActionResult =
  | { ok: true; content: string; model: string; cached: boolean; version: number; generatedAt: string }
  | { ok: false; error: string };

export async function generateRecommendationAction(input: {
  pageId: string;
  strategy: PsiStrategy;
  force?: boolean;
}): Promise<RecommendationActionResult> {
  try {
    const ctx = await requireCapability('recommendations:generate');
    // A Server Action is a public endpoint: the capability check says this ROLE
    // may generate, and this says the page belongs to their organisation.
    await requirePageAccess(ctx.organizationId, input.pageId);

    const r = await getOrCreateRecommendation(input.pageId, input.strategy, { force: input.force });
    revalidatePath(`/p/${input.pageId}`);
    return {
      ok: true,
      content: r.content,
      model: r.model,
      cached: r.cached,
      version: r.version,
      generatedAt: r.generatedAt,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}

/** Every saved answer for this page, newest first. */
export async function recommendationHistoryAction(input: {
  pageId: string;
  strategy: PsiStrategy;
}): Promise<{ ok: true; versions: RecommendationVersion[] } | { ok: false; error: string }> {
  try {
    const ctx = await requireCapability('reports:read');
    await requirePageAccess(ctx.organizationId, input.pageId);
    return { ok: true, versions: await listRecommendations(input.pageId, input.strategy) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not load earlier answers.' };
  }
}
