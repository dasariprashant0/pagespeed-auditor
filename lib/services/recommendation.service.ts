import { prisma } from '../db.ts';
import { logger } from '../logger.ts';
import { upsertAiSection } from '../report/aiSection.ts';
import { buildRecommendationPrompt } from '../ai/prompt.ts';
import { resolveProvider } from '../ai/provider.ts';
import { getPageReport } from './report.service.ts';
import type { PsiStrategy } from '../psi/types.ts';

/**
 * On-demand, cached AI recommendations.
 *
 * Generated when a report is first opened rather than for every page after
 * every sweep: 1,494 generations per sweep would cost far more than the audits
 * and almost none of them would be read.
 */

export interface RecommendationResult {
  content: string;
  model: string;
  generatedAt: string;
  cached: boolean;
}

const STALE_GENERATING_MS = 3 * 60 * 1000;

export async function getOrCreateRecommendation(
  pageId: string,
  strategy: PsiStrategy,
  opts: { force?: boolean } = {},
): Promise<RecommendationResult> {
  const report = await getPageReport(pageId, strategy);
  const result = report.result;
  if (!result) throw new Error('This page has not been audited on this strategy yet.');
  if (result.status !== 'ok') throw new Error('The last audit failed, so there is nothing to analyse.');

  const auditResultId = result.id;

  // createMany + skipDuplicates compiles to ON CONFLICT DO NOTHING, which is a
  // real atomic lock rather than a check-then-act race. Two tabs opening the
  // same report therefore generate exactly once.
  if (!opts.force) {
    // ON CONFLICT DO NOTHING: `count === 1` means THIS caller inserted the row
    // and therefore owns the lock. Without that distinction the creator blocks
    // on its own lock and nothing is ever generated.
    const claimed = await prisma.recommendation.createMany({
      data: [{ auditResultId, status: 'generating', model: '', content: '' }],
      skipDuplicates: true,
    });

    if (claimed.count === 0) {
      const existing = await prisma.recommendation.findUnique({ where: { auditResultId } });
      if (existing?.status === 'complete' && existing.content) {
        return {
          content: existing.content,
          model: existing.model,
          generatedAt: existing.generatedAt.toISOString(),
          cached: true,
        };
      }

      // Someone else is mid-generation. A crash would otherwise hold this row
      // forever, so a stale claim is taken over rather than waited on.
      if (
        existing?.status === 'generating' &&
        Date.now() - existing.startedAt.getTime() < STALE_GENERATING_MS
      ) {
        throw new Error('A recommendation is already being generated for this audit. Try again shortly.');
      }

      await prisma.recommendation.update({
        where: { auditResultId },
        data: { status: 'generating', startedAt: new Date(), error: null },
      });
    }
  }

  const provider = resolveProvider();
  const prompt = buildRecommendationPrompt(report);

  try {
    const content = await provider.generate(prompt);
    if (!content) throw new Error('The model returned nothing.');

    const saved = await prisma.$transaction(async (tx) => {
      const rec = await tx.recommendation.upsert({
        where: { auditResultId },
        update: { content, model: provider.model, status: 'complete', error: null, generatedAt: new Date() },
        create: { auditResultId, content, model: provider.model, status: 'complete' },
      });

      // Keep the stored markdown report in step, so the dashboard and the MCP
      // `get_report` tool never disagree about what this page's advice is.
      const row = await tx.auditResult.findUniqueOrThrow({
        where: { id: auditResultId },
        select: { markdownReport: true },
      });
      await tx.auditResult.update({
        where: { id: auditResultId },
        data: { markdownReport: upsertAiSection(row.markdownReport, content) },
      });

      return rec;
    });

    logger.info({ pageId, strategy, provider: provider.name }, 'recommendation generated');
    return { content: saved.content, model: saved.model, generatedAt: saved.generatedAt.toISOString(), cached: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.recommendation.upsert({
      where: { auditResultId },
      update: { status: 'failed', error: message },
      create: { auditResultId, status: 'failed', error: message, content: '', model: provider.model },
    });
    throw new Error(`Could not generate a recommendation: ${message}`);
  }
}
