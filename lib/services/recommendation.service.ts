import { prisma } from '../db.ts';
import { logger } from '../logger.ts';
import { upsertAiSection } from '../report/aiSection.ts';
import { buildRecommendationPrompt } from '../ai/prompt.ts';
import { resolveProvider } from '../ai/provider.ts';
import { getPageReport } from './report.service.ts';
import type { PsiStrategy } from '../psi/types.ts';

/**
 * On-demand, versioned AI recommendations.
 *
 * Generated when a report is opened rather than for every page after every
 * sweep: 1,494 generations per sweep would cost more than the audits and almost
 * none of them would be read.
 *
 * Regenerating APPENDS a version instead of overwriting. Someone regenerates
 * precisely when they doubt the answer they got, and comparing the two is the
 * whole point of doing it again -- so the old one has to survive. History is
 * capped per audit result; see KEEP_VERSIONS.
 */

/** Ten regenerations per result. Beyond that, the oldest are dropped. */
export const KEEP_VERSIONS = 10;

export interface RecommendationResult {
  content: string;
  model: string;
  generatedAt: string;
  version: number;
  durationMs: number | null;
  cached: boolean;
}

export interface RecommendationVersion {
  version: number;
  model: string;
  generatedAt: string;
  durationMs: number | null;
  status: string;
  content: string;
}

const STALE_GENERATING_MS = 3 * 60 * 1000;

async function resultIdFor(pageId: string, strategy: PsiStrategy) {
  const report = await getPageReport(pageId, strategy);
  const result = report.result;
  if (!result) throw new Error('This page has not been audited on this strategy yet.');
  if (result.status !== 'ok') throw new Error('The last audit failed, so there is nothing to analyse.');
  return { report, auditResultId: result.id };
}

/** Every saved answer for this page and strategy, newest first. */
export async function listRecommendations(
  pageId: string,
  strategy: PsiStrategy,
): Promise<RecommendationVersion[]> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { latestResultMobileId: true, latestResultDesktopId: true },
  });
  const auditResultId =
    strategy === 'mobile' ? page?.latestResultMobileId : page?.latestResultDesktopId;
  if (!auditResultId) return [];

  const rows = await prisma.recommendation.findMany({
    where: { auditResultId, status: 'complete' },
    orderBy: { version: 'desc' },
    select: { version: true, model: true, generatedAt: true, durationMs: true, status: true, content: true },
  });

  return rows.map((r) => ({
    version: r.version,
    model: r.model,
    generatedAt: r.generatedAt.toISOString(),
    durationMs: r.durationMs,
    status: r.status,
    content: r.content,
  }));
}

export async function getOrCreateRecommendation(
  pageId: string,
  strategy: PsiStrategy,
  opts: { force?: boolean } = {},
): Promise<RecommendationResult> {
  const { report, auditResultId } = await resultIdFor(pageId, strategy);

  const latest = await prisma.recommendation.findFirst({
    where: { auditResultId },
    orderBy: { version: 'desc' },
  });

  if (!opts.force && latest?.status === 'complete' && latest.content) {
    return {
      content: latest.content,
      model: latest.model,
      generatedAt: latest.generatedAt.toISOString(),
      version: latest.version,
      durationMs: latest.durationMs,
      cached: true,
    };
  }

  // Someone else is mid-generation. A crash would otherwise hold the slot
  // forever, so a stale claim is taken over rather than waited on.
  if (
    latest?.status === 'generating' &&
    Date.now() - latest.startedAt.getTime() < STALE_GENERATING_MS
  ) {
    throw new Error('A recommendation is already being generated for this audit. Try again shortly.');
  }

  // The claim. Two tabs both compute the same next version and race on the
  // same insert; ON CONFLICT DO NOTHING (skipDuplicates) lets exactly one
  // through, so `count === 1` means THIS caller owns the generation. Without
  // that distinction the creator blocks on its own claim and nothing is ever
  // produced.
  const version = (latest?.version ?? 0) + 1;
  const claimed = await prisma.recommendation.createMany({
    data: [{ auditResultId, version, status: 'generating', model: '', content: '' }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    throw new Error('Another tab just started this one. Give it a moment and reload.');
  }

  const provider = resolveProvider();
  const previous = latest?.status === 'complete' ? latest.content : null;
  const prompt = buildRecommendationPrompt(report, { previous });
  const startedAt = Date.now();

  try {
    const content = await provider.generate(prompt);
    if (!content) throw new Error('The model returned nothing.');
    const durationMs = Date.now() - startedAt;

    const saved = await prisma.$transaction(async (tx) => {
      const rec = await tx.recommendation.update({
        where: { auditResultId_version: { auditResultId, version } },
        data: { content, model: provider.model, status: 'complete', error: null, generatedAt: new Date(), durationMs },
      });

      // Keep the stored markdown in step with the newest answer, so the
      // dashboard, the .md export and the MCP `get_report` tool never disagree
      // about what this page's advice is.
      const row = await tx.auditResult.findUniqueOrThrow({
        where: { id: auditResultId },
        select: { markdownReport: true },
      });
      await tx.auditResult.update({
        where: { id: auditResultId },
        data: { markdownReport: upsertAiSection(row.markdownReport, content) },
      });

      // Trim inside the same transaction: a separate pass could be skipped by a
      // crash and let history grow without bound.
      const keep = await tx.recommendation.findMany({
        where: { auditResultId },
        orderBy: { version: 'desc' },
        skip: KEEP_VERSIONS,
        select: { id: true },
      });
      if (keep.length > 0) {
        await tx.recommendation.deleteMany({ where: { id: { in: keep.map((k) => k.id) } } });
      }

      return rec;
    });

    logger.info({ pageId, strategy, version, durationMs, provider: provider.name }, 'recommendation generated');
    return {
      content: saved.content,
      model: saved.model,
      generatedAt: saved.generatedAt.toISOString(),
      version: saved.version,
      durationMs,
      cached: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Release the claim by marking it failed, so the next attempt is not told
    // that a generation is already running.
    await prisma.recommendation.update({
      where: { auditResultId_version: { auditResultId, version } },
      data: { status: 'failed', error: message, durationMs: Date.now() - startedAt },
    }).catch(() => { /* the row may already be gone with its result */ });
    throw new Error(`Could not generate a recommendation: ${message}`);
  }
}
