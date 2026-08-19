import { logger } from '../logger.ts';
import type { SweepSummary } from './types.ts';

/**
 * Incoming webhook rather than a Slack app: no OAuth, no scopes, no token
 * refresh, and nothing to re-authorize when someone leaves the workspace.
 */
export async function sendSlack(webhookUrl: string, s: SweepSummary): Promise<void> {
  const failed = s.event === 'sweep.failed';

  const lines = [
    `*${failed ? ':red_circle: Sweep failed' : ':white_check_mark: Sweep complete'}* — ${s.siteName}`,
    `${s.completedJobs}/${s.totalJobs} audits${s.failedJobs > 0 ? `, ${s.failedJobs} failed` : ''}${
      s.durationMinutes !== null ? ` · ${s.durationMinutes} min` : ''
    }`,
  ];
  if (s.averagePerformance !== null) lines.push(`Average performance: *${s.averagePerformance}*`);
  if (s.error) lines.push(`\`${s.error}\``);
  if (s.worstPages.length > 0) {
    lines.push('*Lowest scoring:*');
    for (const p of s.worstPages) lines.push(`  \`${p.score ?? '--'}\`  ${p.url}`);
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: lines.join('\n'),
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open dashboard' }, url: s.dashboardUrl }],
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
  logger.info({ runId: s.runId }, 'slack notification sent');
}
