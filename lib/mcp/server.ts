import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { listGroupsWithAggregates, listPagesInGroup, getScoreHistory } from '../services/results.service.ts';
import { getPageReport } from '../services/report.service.ts';
import { getTopIssues } from '../services/issues.service.ts';
import { getRunProgress } from '../services/site.service.ts';
import { getOrCreateRecommendation } from '../services/recommendation.service.ts';
import { BOTH_STRATEGIES, createRun, expandScope, findActiveRun } from '../services/run.service.ts';
import { enqueueAuditJobs } from '../queue/producers.ts';
import { estimateRun, formatDuration } from '../services/estimate.service.ts';
import { normalizeUrl } from '../sitemap/normalize.ts';
import type { PsiStrategy } from '../psi/types.ts';

/**
 * The MCP tool surface.
 *
 * Every tool is a thin adapter over the same service layer the dashboard uses,
 * which is the entire reason for the framework-free boundary. There is
 * deliberately no run_full_sweep tool: sweeps are schedule-only, and the
 * description on run_group_audit says so explicitly, because otherwise an agent
 * will try to fake one by looping over every group.
 */

const strategyArg = z.enum(['mobile', 'desktop']).default('mobile');

/**
 * The organisation this call belongs to, taken from the bearer token.
 *
 * mcp-handler puts the verified auth info on the request. Resolving the site
 * any other way -- findFirst, an env var, an id in the arguments -- would let
 * one tenant's agent read another's data.
 */
function orgIdOf(ctx: unknown): string {
  const org = (ctx as { authInfo?: { organizationId?: string } } | undefined)?.authInfo?.organizationId;
  if (!org) throw new Error('This token is not associated with an organisation.');
  return org;
}

async function siteId(ctx: unknown): Promise<string> {
  const site = await prisma.site.findFirst({
    where: { organizationId: orgIdOf(ctx) },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!site) throw new Error('No site is configured for this organisation yet.');
  return site.id;
}

/** Resolves a URL the way ingestion did, so agents can pass any form of it. */
async function findPage(url: string, ctx: unknown) {
  const site = await prisma.site.findFirst({
    where: { organizationId: orgIdOf(ctx) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, baseUrl: true },
  });
  if (!site) throw new Error('No site is configured for this organisation yet.');
  const norm = normalizeUrl(url, site.baseUrl);
  const candidates = norm.ok ? [norm.url, url] : [url];

  const page = await prisma.page.findFirst({
    where: { siteId: site.id, url: { in: candidates } },
    select: { id: true, url: true, path: true },
  });
  if (page) return page;

  // A near-miss list beats "not found": the agent can correct itself.
  const near = await prisma.page.findMany({
    where: { siteId: site.id, path: { contains: norm.ok ? norm.path.split('/').filter(Boolean).pop() ?? '' : '' } },
    select: { url: true },
    take: 3,
  });
  throw new Error(
    `No page matches ${url}.` + (near.length ? ` Closest: ${near.map((n) => n.url).join(', ')}` : ''),
  );
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export const mcpHandler = createMcpHandler((server) => {
  server.registerTool(
    'list_groups',
    {
      title: 'List groups',
      description: 'Every page group with its average scores, worst page and audit coverage.',
      inputSchema: { strategy: strategyArg },
      annotations: { readOnlyHint: true },
    },
    async ({ strategy }, ctx) => {
      const groups = await listGroupsWithAggregates(await siteId(ctx), { strategy: strategy as PsiStrategy });
      const rows = groups
        .filter((g) => g.pageCount > 0)
        .map((g) => `${g.slug}\t${g.pageCount} pages\tperf ${g.aggregate.performance ?? '--'}\tworst ${g.worstPerformance ?? '--'}\t${g.auditedCount} audited`);
      return text(`slug\tpages\tavg perf\tworst\taudited\n${rows.join('\n')}`);
    },
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List pages',
      description: 'Pages with their latest scores. Filter by group, and cap the result — the site has ~750 pages.',
      inputSchema: {
        group: z.string().optional(),
        strategy: strategyArg,
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ group, strategy, limit }, ctx) => {
      const sid = await siteId(ctx);
      const g = group
        ? await prisma.group.findFirst({ where: { siteId: sid, slug: group }, select: { id: true } })
        : null;
      if (group && !g) throw new Error(`No group "${group}". Call list_groups first.`);

      const pages = g
        ? await listPagesInGroup(g.id, { strategy: strategy as PsiStrategy })
        : (await Promise.all(
            (await listGroupsWithAggregates(sid, { strategy: strategy as PsiStrategy }))
              .filter((x) => x.pageCount > 0)
              .map((x) => listPagesInGroup(x.id, { strategy: strategy as PsiStrategy })),
          )).flat();

      const shown = pages.slice(0, limit);
      const rows = shown.map((p) => `${p.path}\t${p.scores.performance ?? '--'}\t${p.scores.accessibility ?? '--'}\t${p.scores.bestPractices ?? '--'}\t${p.scores.seo ?? '--'}`);
      return text(
        `path\tperf\ta11y\tbp\tseo\n${rows.join('\n')}\n\n${shown.length} of ${pages.length} shown.`,
      );
    },
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get a page report',
      description: 'The full stored markdown report for one page — scores, metrics, field data, opportunities and diagnostics.',
      inputSchema: { url: z.string(), strategy: strategyArg },
      annotations: { readOnlyHint: true },
    },
    async ({ url, strategy }, ctx) => {
      const page = await findPage(url, ctx);
      const report = await getPageReport(page.id, strategy as PsiStrategy);
      if (!report.result) {
        return text(`${page.url} has not been audited on ${strategy}. Use run_page_audit to measure it.`);
      }
      return text(report.result.markdownReport);
    },
  );

  server.registerTool(
    'get_trend',
    {
      title: 'Score history',
      description: 'Score history over time for a page or a group.',
      inputSchema: {
        url: z.string().optional(),
        group: z.string().optional(),
        strategy: strategyArg,
        limit: z.number().int().min(2).max(90).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ url, group, strategy, limit }, ctx) => {
      if (!url === !group) throw new Error('Pass exactly one of url or group.');

      if (url) {
        const page = await findPage(url, ctx);
        const history = await getScoreHistory({ pageId: page.id }, { strategy: strategy as PsiStrategy, limit });
        const pts = history.filter((p) => p.v !== null);
        if (pts.length === 0) return text(`No history for ${page.url} on ${strategy}.`);
        return text(
          `${page.path} (${strategy})\n` +
            pts.map((p) => `${p.t.slice(0, 10)}  ${p.v}`).join('\n') +
            `\n\n${pts[0].v} → ${pts[pts.length - 1].v} over ${pts.length} audits.`,
        );
      }

      const sid = await siteId(ctx);
      const g = await prisma.group.findFirstOrThrow({ where: { siteId: sid, slug: group! }, select: { id: true } });
      const history = await getScoreHistory({ groupId: g.id }, { strategy: strategy as PsiStrategy, limit });
      const pts = history.filter((p) => p.v !== null);
      return text(pts.length ? pts.map((p) => `${p.t.slice(0, 10)}  ${p.v}`).join('\n') : `No history for ${group}.`);
    },
  );

  server.registerTool(
    'top_issues',
    {
      title: 'Site-wide top issues',
      description: 'The problems affecting the most pages, from the latest complete run. Use this to find one root cause behind many pages rather than fixing pages one at a time.',
      inputSchema: { strategy: strategyArg, limit: z.number().int().min(1).max(40).default(15) },
      annotations: { readOnlyHint: true },
    },
    async ({ strategy, limit }, ctx) => {
      const issues = await getTopIssues({ siteId: await siteId(ctx), strategy: strategy as PsiStrategy, limit });
      if (issues.length === 0) return text('No completed run yet, so there is nothing to rank.');
      return text(
        issues.map((i) => `${String(i.pagesAffected).padStart(4)} of ${i.pagesTotal} pages  ${i.title}`).join('\n'),
      );
    },
  );

  server.registerTool(
    'get_recommendation',
    {
      title: 'Get fix recommendations',
      description: 'AI recommendations for one page. Cached per audit; generates on first request.',
      inputSchema: { url: z.string(), strategy: strategyArg, refresh: z.boolean().default(false) },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ url, strategy, refresh }, ctx) => {
      const page = await findPage(url, ctx);
      const rec = await getOrCreateRecommendation(page.id, strategy as PsiStrategy, { force: refresh });
      return text(`${rec.cached ? '(cached) ' : ''}${rec.content}`);
    },
  );

  server.registerTool(
    'run_page_audit',
    {
      title: 'Audit one page',
      description: 'Queues a fresh audit for one page. Returns a run id to poll with get_run_status — a PSI call takes roughly a minute per strategy.',
      inputSchema: { url: z.string(), strategy: z.enum(['mobile', 'desktop', 'both']).default('both') },
      annotations: { readOnlyHint: false },
    },
    async ({ url, strategy }, ctx) => {
      const page = await findPage(url, ctx);
      const sid = await siteId(ctx);
      const active = await findActiveRun(prisma, sid);
      if (active) throw new Error(`A ${active.type} run is already active (${active.id}). Poll it with get_run_status.`);

      const strategies = (strategy === 'both' ? BOTH_STRATEGIES : [strategy]) as PsiStrategy[];
      const scope = { kind: 'page' as const, ref: page.id, strategies };
      const pairs = await expandScope(prisma, sid, scope);
      const runId = await createRun(prisma, { siteId: sid, type: 'page', triggeredBy: 'manual', scope, totalJobs: pairs.length });
      await enqueueAuditJobs(runId, pairs);

      const est = await estimateRun(pairs.length, sid);
      return text(`Queued ${pairs.length} audit(s) for ${page.url}.\nrunId: ${runId}\nEstimated ${formatDuration(est.seconds)}.`);
    },
  );

  server.registerTool(
    'run_group_audit',
    {
      title: 'Audit a group',
      description:
        'Queues audits for every page in a group. Returns a run id to poll. NOTE: there is no whole-site tool — full sweeps run only on the configured schedule, so do not loop over every group to imitate one.',
      inputSchema: { group: z.string(), strategy: z.enum(['mobile', 'desktop', 'both']).default('both') },
      annotations: { readOnlyHint: false },
    },
    async ({ group, strategy }, ctx) => {
      const sid = await siteId(ctx);
      const active = await findActiveRun(prisma, sid);
      if (active) throw new Error(`A ${active.type} run is already active (${active.id}).`);

      const strategies = (strategy === 'both' ? BOTH_STRATEGIES : [strategy]) as PsiStrategy[];
      const scope = { kind: 'group' as const, ref: group, strategies };
      const pairs = await expandScope(prisma, sid, scope);
      if (pairs.length === 0) throw new Error(`No active pages in group "${group}".`);

      const runId = await createRun(prisma, { siteId: sid, type: 'group', triggeredBy: 'manual', scope, totalJobs: pairs.length });
      await enqueueAuditJobs(runId, pairs);

      const est = await estimateRun(pairs.length, sid);
      return text(`Queued ${pairs.length} audit(s) for "${group}".\nrunId: ${runId}\nEstimated ${formatDuration(est.seconds)}.`);
    },
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Run progress',
      description: 'Progress of a queued or running audit.',
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ runId }, ctx) => {
      const p = await getRunProgress(runId);
      if (!p) throw new Error(`No run ${runId}.`);
      const eta = p.etaSeconds === null ? '' : `, ~${Math.round(p.etaSeconds / 60)} min left`;
      return text(
        `${p.status} — ${p.completedJobs}/${p.totalJobs} complete${p.failedJobs ? `, ${p.failedJobs} failed` : ''}${eta}\n${p.scopeLabel ?? ''}`,
      );
    },
  );
});
