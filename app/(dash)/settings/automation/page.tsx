import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/http/auth-guard';
import { defaultSite, orgEmailRef } from '@/lib/services/tenant.service';
import { redirect } from 'next/navigation';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { getEnv } from '@/lib/env';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { estimateRun, formatDuration } from '@/lib/services/estimate.service';
import { ScheduleForm } from '@/components/settings/ScheduleForm';
import { NotificationForm } from '@/components/settings/NotificationForm';
import { OrgEmailForm } from '@/components/settings/OrgEmailForm';
import { AutomationStatus, type AutomationHealth } from '@/components/settings/AutomationStatus';
import { schedulerHealth } from '@/lib/opsState';
import { emailConfigProblem } from '@/lib/notify/email';

export const dynamic = 'force-dynamic';

/** Confirms a secret is set without disclosing it. */
function masked(v: string | null | undefined): string {
  if (!v) return 'not set';
  return v.length <= 12 ? '••••••••' : `${v.slice(0, 6)}${'•'.repeat(10)}${v.slice(-4)}`;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="font-[family-name:var(--font-display)] text-[13px] font-medium">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 max-w-xl text-[11px] text-[var(--muted)]">{hint}</p>}
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const env = getEnv();
  // Visible to every role -- only automation:manage decides whether the
  // schedule/email/notification forms below actually accept input.
  const ctx = await requireSession();
  const canEdit = can(ctx.role, 'automation:manage');
  const site = await defaultSite(ctx.organizationId);
  if (!site) redirect('/');

  const [groups, schedule, notif, scheduler, recentRuns, orgEmail] = await Promise.all([
    listGroupsWithAggregates(site.id, { strategy: 'mobile' }),
    prisma.schedule.findUnique({ where: { siteId: site.id } }),
    prisma.notificationSetting.findUnique({ where: { siteId: site.id } }),
    // Never let a Redis blip take the settings page down with it: not knowing
    // whether the scheduler is ticking is a worse answer than a 500, but only just.
    schedulerHealth().catch(() => ({ alive: false, lastTickSecondsAgo: null })),
    prisma.auditRun.findMany({
      where: { siteId: site.id },
      orderBy: { startedAt: 'desc' },
      // Enough to pick from a run history "I ran this 5 times" without
      // paginating -- these are small metadata rows, not the heavy results.
      take: 30,
      select: {
        id: true, type: true, triggeredBy: true, status: true,
        startedAt: true, finishedAt: true,
        completedJobs: true, totalJobs: true, failedJobs: true,
      },
    }),
    orgEmailRef(ctx.organizationId),
  ]);

  const health: AutomationHealth = {
    schedulerAlive: scheduler.alive,
    schedulerLastTickSecondsAgo: scheduler.lastTickSecondsAgo,
    scheduleEnabled: schedule?.enabled ?? false,
    cronExpr: schedule?.cronExpr ?? null,
    nextRunAt: schedule?.nextRunAt?.toISOString() ?? null,
    lastRunAt: schedule?.lastRunAt?.toISOString() ?? null,
    timezone: schedule?.timezone ?? 'Asia/Kolkata',
    recentRuns: recentRuns.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  };

  // An organisation's own SMTP override (orgEmail.hasOverride) bypasses the
  // shared default entirely -- emailConfigProblem() only describes that
  // shared default, so it would wrongly report "not configured" for an
  // organisation that has already set its own mailbox.
  const emailProblem = orgEmail.hasOverride ? null : emailConfigProblem();
  const sentFromAddress = orgEmail.hasOverride
    ? orgEmail.user
    : process.env.EMAIL_TRANSPORT === 'resend' ? (process.env.EMAIL_FROM ?? null) : (process.env.SMTP_USER ?? null);
  const activePages = groups.reduce((n, g) => n + g.pageCount, 0);
  const sweepEstimate = await estimateRun(activePages * 2, site.id);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Automation" subtitle="When it runs and who hears about it" />
      <SettingsNav active="/settings/automation" />

      <div className="max-w-3xl space-y-3">
        <AutomationStatus
          health={health}
          maxAttempts={env.PSI_MAX_ATTEMPTS}
          canRetry={can(ctx.role, 'audits:run')}
          siteId={site.id}
          canDelete={can(ctx.role, 'site:manage')}
        />

        <Section
          title="Automatic site check"
          hint={`Tests all ${activePages} pages on mobile and desktop. Takes ${formatDuration(sweepEstimate.seconds)}${
            sweepEstimate.measured ? '' : ' (rough estimate until a few pages have been tested)'
          }, so it runs on a schedule rather than on demand — usually overnight. You can still test any single page or section whenever you like.`}
        >
          <ScheduleForm
            initial={{
              cronExpr: schedule?.cronExpr ?? null,
              timezone: schedule?.timezone ?? 'Asia/Kolkata',
              enabled: schedule?.enabled ?? false,
              nextRunAt: schedule?.nextRunAt ? schedule.nextRunAt.toISOString() : null,
            }}
            canEdit={canEdit}
          />
        </Section>

        <Section
          title="Email sending"
          hint={
            canEdit
              ? 'Your own mailbox for invitations and sweep notifications, instead of sharing the one everyone else on this deployment uses. Leave blank to keep using the shared default.'
              : 'Only an admin can change this.'
          }
        >
          <OrgEmailForm email={orgEmail} canEdit={canEdit} />
        </Section>

        <Section
          title="Notifications"
          hint={
            emailProblem
              ? `Both channels are off until you turn them on. Email cannot send yet: ${emailProblem} Slack needs none of that — a webhook URL alone works.`
              : `Both channels are off until you turn them on. Email is ready and will send via ${sentFromAddress ?? 'the shared default'}.`
          }
        >
          <NotificationForm
            sentFrom={sentFromAddress}
            appSender={!orgEmail.hasOverride && process.env.EMAIL_TRANSPORT === 'resend'}
            initial={{
              emailEnabled: notif?.emailEnabled ?? false,
              emailTo: notif?.emailTo ?? null,
              slackEnabled: notif?.slackEnabled ?? false,
              slackWebhookMasked: notif?.slackWebhookUrl ? masked(notif.slackWebhookUrl) : null,
            }}
            canEdit={canEdit}
          />
        </Section>


        <Section title="Configuration" hint="Set in .env, which is hidden and gitignored so secrets stay out of the repository. Change a value with `npm run env -- KEY value`, then restart.">
          <dl className="divide-y divide-[var(--border)] text-[12px]">
            {([
              ['Site', site.name],
              ['Base URL', site.baseUrl],
              ['Sitemap', site.sitemapUrl],
              ['Pages tracked', `${activePages} active`],
              ['PSI API key', masked(env.PSI_API_KEY)],
              ['Pages tested at once', String(env.WORKER_CONCURRENCY)],
              ['Google rate limit', `${env.PSI_RATE_MAX} requests per ${env.PSI_RATE_WINDOW_MS / 1000}s`],
              ['Typical time per page', sweepEstimate.measured ? `${Math.round(sweepEstimate.medianCallMs / 1000)} seconds (measured)` : 'not measured yet'],
              [
                'Email',
                orgEmail.hasOverride
                  ? `sending via your own mailbox (${orgEmail.host})`
                  : emailProblem
                    ? 'not sending — see the Notifications section'
                    : process.env.EMAIL_TRANSPORT === 'resend'
                      ? `sending as ${process.env.EMAIL_FROM} via Resend`
                      : `sending via ${process.env.SMTP_HOST}`,
              ],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="flex flex-wrap gap-x-4 py-1.5">
                <dt className="w-44 shrink-0 text-[var(--muted)]">{k}</dt>
                <dd className="min-w-0 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </>
  );
}
