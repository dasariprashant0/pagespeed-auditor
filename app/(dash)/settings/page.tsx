import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { estimateRun, formatDuration } from '@/lib/services/estimate.service';
import { AppShell } from '@/components/shell/AppShell';
import { ScheduleForm } from '@/components/settings/ScheduleForm';
import { NotificationForm } from '@/components/settings/NotificationForm';
import { PriorityForm } from '@/components/settings/PriorityForm';
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
  const site = await prisma.site.findFirstOrThrow();

  const [groups, schedule, notif] = await Promise.all([
    listGroupsWithAggregates(site.id, { strategy: 'mobile' }),
    prisma.schedule.findUnique({ where: { siteId: site.id } }),
    prisma.notificationSetting.findUnique({ where: { siteId: site.id } }),
  ]);

  const emailProblem = emailConfigProblem();
  const activePages = groups.reduce((n, g) => n + g.pageCount, 0);
  const sweepEstimate = await estimateRun(activePages * 2, site.id);

  const rail = groups.filter((g) => g.pageCount > 0).map((g) => ({ slug: g.slug, name: g.name, pageCount: g.pageCount }));
  const pinned = groups.filter((g) => g.priority !== null).sort((a, b) => a.priority! - b.priority!).map((g) => g.slug);

  return (
    <AppShell siteName={site.name} groups={rail} breadcrumb="Settings">
      <h1 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">Settings</h1>

      <div className="max-w-3xl space-y-3">
        <Section
          title="Automatic site check"
          hint={`Tests all ${activePages} pages on phone and desktop. Takes ${formatDuration(sweepEstimate.seconds)}${
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
          />
        </Section>

        <Section
          title="Notifications"
          hint={
            emailProblem
              ? `Both channels are off until you turn them on. Email cannot send yet: ${emailProblem} Slack needs none of that — a webhook URL alone works.`
              : `Both channels are off until you turn them on. Email is ready and will send via ${process.env.SMTP_HOST}.`
          }
        >
          <NotificationForm
            initial={{
              emailEnabled: notif?.emailEnabled ?? false,
              emailTo: notif?.emailTo ?? null,
              slackEnabled: notif?.slackEnabled ?? false,
              slackWebhookMasked: notif?.slackWebhookUrl ? masked(notif.slackWebhookUrl) : null,
            }}
          />
        </Section>

        <Section
          title="Which sections get tested first"
          hint="The automatic check works through your sitemap in order. If you are watching a particular section, pin it to the front so it is measured early rather than 30 minutes in."
        >
          <PriorityForm groups={rail} initialPinned={pinned} />
        </Section>

        <Section title="Configuration" hint="Set in .env; restart after changing.">
          <dl className="divide-y divide-[var(--border)] text-[12px]">
            {([
              ['Site', site.name],
              ['Base URL', site.baseUrl],
              ['Sitemap', site.sitemapUrl],
              ['Pages tracked', `${activePages} active`],
              ['PSI API key', masked(env.PSI_API_KEY)],
              ['Login user', env.AUTH_USERNAME],
              ['Password', env.AUTH_PASSWORD_HASH ? 'configured' : 'NOT SET — run npm run set-password'],
              ['Pages tested at once', String(env.WORKER_CONCURRENCY)],
              ['Google rate limit', `${env.PSI_RATE_MAX} requests per ${env.PSI_RATE_WINDOW_MS / 1000}s`],
              ['Typical time per page', sweepEstimate.measured ? `${Math.round(sweepEstimate.medianCallMs / 1000)} seconds (measured)` : 'not measured yet'],
              ['Email', emailProblem ? 'not sending — see the Notifications section' : `sending via ${process.env.SMTP_HOST}`],
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} className="flex flex-wrap gap-x-4 py-1.5">
                <dt className="w-44 shrink-0 text-[var(--muted)]">{k}</dt>
                <dd className="min-w-0 break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </AppShell>
  );
}
