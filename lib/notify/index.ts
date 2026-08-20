import { prisma } from '../db.ts';
import { logger } from '../logger.ts';
import { sendEmail } from './email.ts';
import { sendSlack } from './slack.ts';
import { emailConfigForOrg } from '../services/tenant.service.ts';
import type { NotificationEvent, SweepSummary } from './types.ts';

export type { NotificationEvent, SweepSummary };

/**
 * Sweep notifications.
 *
 * Fires on sweep completion or failure only -- never on an on-demand page or
 * group run. Someone re-running one page does not need an email, and a channel
 * that notifies on everything gets muted, which loses the alerts that mattered.
 *
 * Both channels are off by default and fail independently: one broken Slack
 * webhook must never stop the email going out.
 */
export interface DispatchOutcome {
  attempted: string[];
  /** Channels that did not actually deliver, with why. Empty means all sent. */
  problems: string[];
}

export async function dispatchSweepNotification(
  siteId: string,
  summary: SweepSummary,
): Promise<DispatchOutcome> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { organizationId: true, notif: true },
  });
  const settings = site?.notif;
  if (!settings) return { attempted: [], problems: ['No notification settings saved.'] };

  const subject =
    summary.event === 'sweep.failed'
      ? `PageSpeed sweep FAILED — ${summary.siteName}`
      : `PageSpeed sweep complete — ${summary.siteName}`;

  const channels: Array<[string, Promise<unknown>]> = [];
  if (settings.emailEnabled && settings.emailTo) {
    const to = settings.emailTo.split(',').map((s) => s.trim()).filter(Boolean);
    const override = await emailConfigForOrg(site.organizationId);
    channels.push(['email', sendEmail(to, subject, renderHtml(summary), renderText(summary), override ?? undefined)]);
  }
  if (settings.slackEnabled && settings.slackWebhookUrl) {
    channels.push(['slack', sendSlack(settings.slackWebhookUrl, summary)]);
  }
  if (channels.length === 0) return { attempted: [], problems: ['No channel is enabled.'] };

  const results = await Promise.allSettled(channels.map(([, p]) => p));
  const problems: string[] = [];

  for (const [i, r] of results.entries()) {
    const channel = channels[i][0];
    if (r.status === 'rejected') {
      logger.error({ channel, err: String(r.reason) }, 'notification channel failed');
      problems.push(`${channel}: ${String(r.reason)}`);
      continue;
    }
    // A suppressed email resolves successfully but was not delivered.
    const v = r.value as { sent?: boolean; reason?: string } | undefined;
    if (v && v.sent === false) problems.push(`${channel}: ${v.reason ?? 'not delivered'}`);
  }

  return { attempted: channels.map(([c]) => c), problems };
}

function delta(s: SweepSummary): string {
  const { averagePerformance: now, previousAveragePerformance: before } = s;
  if (now === null || before === null) return '';
  const d = now - before;
  if (d === 0) return ' (no change)';
  return d > 0 ? ` (up ${d} from the last sweep)` : ` (down ${Math.abs(d)} from the last sweep)`;
}

export function renderText(s: SweepSummary): string {
  const lines = [
    s.event === 'sweep.failed' ? `Sweep FAILED for ${s.siteName}` : `Sweep complete for ${s.siteName}`,
    '',
    `Audits: ${s.completedJobs}/${s.totalJobs}${s.failedJobs > 0 ? `, ${s.failedJobs} failed` : ''}`,
  ];
  if (s.durationMinutes !== null) lines.push(`Duration: ${s.durationMinutes} min`);
  if (s.averagePerformance !== null) lines.push(`Average performance: ${s.averagePerformance}${delta(s)}`);
  if (s.error) lines.push('', `Error: ${s.error}`);
  if (s.worstPages.length > 0) {
    lines.push('', 'Lowest scoring pages:');
    for (const p of s.worstPages) lines.push(`  ${p.score ?? '--'}  ${p.url}`);
  }
  lines.push('', s.dashboardUrl);
  return lines.join('\n');
}

export function renderHtml(s: SweepSummary): string {
  const rows = s.worstPages
    .map(
      (p) =>
        `<tr><td style="padding:4px 10px 4px 0;font-variant-numeric:tabular-nums">${p.score ?? '—'}</td>` +
        `<td style="padding:4px 0"><a href="${p.url}">${p.url}</a></td></tr>`,
    )
    .join('');

  return `<div style="font:14px/1.5 -apple-system,system-ui,sans-serif;color:#1c1917">
<h2 style="margin:0 0 4px">${s.event === 'sweep.failed' ? 'Sweep failed' : 'Sweep complete'} — ${s.siteName}</h2>
<p style="margin:0 0 12px;color:#78716c">${s.completedJobs}/${s.totalJobs} audits${
    s.failedJobs > 0 ? `, ${s.failedJobs} failed` : ''
  }${s.durationMinutes !== null ? ` · ${s.durationMinutes} min` : ''}</p>
${s.averagePerformance !== null ? `<p style="margin:0 0 12px"><strong>Average performance: ${s.averagePerformance}</strong>${delta(s)}</p>` : ''}
${s.error ? `<p style="margin:0 0 12px;color:#c00000">${s.error}</p>` : ''}
${rows ? `<p style="margin:0 0 4px;font-weight:600">Lowest scoring pages</p><table>${rows}</table>` : ''}
<p style="margin:16px 0 0"><a href="${s.dashboardUrl}">Open the dashboard</a></p>
</div>`;
}
