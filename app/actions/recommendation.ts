'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/http/auth-guard';
import { getOrCreateRecommendation } from '@/lib/services/recommendation.service';
import type { PsiStrategy } from '@/lib/services/types';

export type RecommendationActionResult =
  | { ok: true; content: string; model: string; cached: boolean }
  | { ok: false; error: string };

export async function generateRecommendationAction(input: {
  pageId: string;
  strategy: PsiStrategy;
  force?: boolean;
}): Promise<RecommendationActionResult> {
  await requireSession();
  try {
    const r = await getOrCreateRecommendation(input.pageId, input.strategy, { force: input.force });
    revalidatePath(`/p/${input.pageId}`);
    return { ok: true, content: r.content, model: r.model, cached: r.cached };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}
