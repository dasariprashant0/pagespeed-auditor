import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { requireSession } from '@/lib/http/auth-guard';
import { redirect } from 'next/navigation';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { Section } from '@/components/settings/Section';
import { getEnv } from '@/lib/env';
import {
  demoAwareDefaultSite,
  demoAwareEstimateRun,
  demoAwareListGroupsWithAggregates,
  demoAwareScheduleAutomationData,
} from '@/lib/onboarding/demoTenant';
import { formatDuration } from '@/lib/services/estimate.service';
import { ScheduleForm } from '@/components/settings/ScheduleForm';
import { AutomationStatus, type AutomationHealth } from '@/components/settings/AutomationStatus';
import { schedulerHealth } from '@/lib/opsState';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const env = getEnv();
  // Visible to every role -- only automation:manage decides whether the
  // schedule form below actually accepts input.
  const ctx = await requireSession();
  const site = await demoAwareDefaultSite(ctx.organizationId);
  const canEdit = can(ctx.role, 'automation:manage');
  if (!site) redirect('/');

  const [groups, scheduleData, scheduler] = await Promise.all([
    demoAwareListGroupsWithAggregates(ctx.organizationId, site.id, { strategy: 'mobile' }),
    demoAwareScheduleAutomationData(ctx.organizationId, site.id),
    // Never let a Redis blip take the settings page down with it: not knowing
    // whether the scheduler is ticking is a worse answer than a 500, but only just.
    schedulerHealth(ctx.organizationId).catch(() => ({ alive: false, lastTickSecondsAgo: null })),
  ]);
  const { schedule, recentRuns } = scheduleData;

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

  const activePages = groups.reduce((n, g) => n + g.pageCount, 0);
  const sweepEstimate = await demoAwareEstimateRun(ctx.organizationId, activePages * 2, site.id);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Automation" subtitle="When it runs" />
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
      </div>
    </>
  );
}
