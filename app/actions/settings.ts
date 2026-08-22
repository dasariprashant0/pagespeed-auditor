'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { friendlyErrorMessage } from '@/lib/http/actionError';
import { getTenantPrisma } from '@/lib/db/tenant';
import { defaultSite } from '@/lib/services/tenant.service';
import { saveSchedule, validateCron } from '@/lib/services/schedule.service';
import { dispatchSweepNotification } from '@/lib/notify';
import { getEnv } from '@/lib/env';

export type SettingsResult = { ok: true; message: string; next?: string[] } | { ok: false; error: string };

export async function saveScheduleAction(_prev: unknown, form: FormData): Promise<SettingsResult> {
  try {
    const ctx = await requireCapability('automation:manage');
    const site = await defaultSite(ctx.organizationId);
    if (!site) return { ok: false, error: 'No site configured.' };

    const enabled = form.get('enabled') === 'on';
    const cronExpr = String(form.get('cronExpr') ?? '').trim() || null;
    const timezone = String(form.get('timezone') ?? 'UTC').trim() || 'UTC';

    const result = await saveSchedule(ctx.organizationId, site.id, { cronExpr, timezone, enabled });
    if (!result.valid) return { ok: false, error: result.error ?? 'Invalid schedule.' };

    revalidatePath('/settings');
    return {
      ok: true,
      message: enabled ? 'Schedule saved and enabled.' : 'Schedule saved (disabled).',
      next: result.next,
    };
  } catch (e) {
    return { ok: false, error: friendlyErrorMessage(e, 'Could not save the schedule.') };
  }
}

export async function saveNotificationsAction(_prev: unknown, form: FormData): Promise<SettingsResult> {
  try {
    const ctx = await requireCapability('automation:manage');
    const prisma = await getTenantPrisma(ctx.organizationId);
    const site = await defaultSite(ctx.organizationId);
    if (!site) return { ok: false, error: 'No site configured.' };

    const emailEnabled = form.get('emailEnabled') === 'on';
    const emailTo = String(form.get('emailTo') ?? '').trim() || null;
    const slackEnabled = form.get('slackEnabled') === 'on';
    const slackRaw = String(form.get('slackWebhookUrl') ?? '').trim();

    if (emailEnabled && !emailTo) return { ok: false, error: 'Add an address before enabling email.' };
    if (slackEnabled && !slackRaw) return { ok: false, error: 'Add a webhook URL before enabling Slack.' };

    // The form shows a masked placeholder rather than the real webhook, so an
    // unchanged field must not overwrite the stored secret with dots.
    const existing = await prisma.notificationSetting.findUnique({ where: { siteId: site.id } });
    const slackWebhookUrl = slackRaw.includes('•') ? (existing?.slackWebhookUrl ?? null) : slackRaw || null;

    await prisma.notificationSetting.upsert({
      where: { siteId: site.id },
      update: { emailEnabled, emailTo, slackEnabled, slackWebhookUrl },
      create: { siteId: site.id, emailEnabled, emailTo, slackEnabled, slackWebhookUrl },
    });

    revalidatePath('/settings');
    return { ok: true, message: 'Notification settings saved.' };
  } catch (e) {
    return { ok: false, error: friendlyErrorMessage(e, 'Could not save notification settings.') };
  }
}

/** Sends a sample through whatever channels are enabled, using real numbers. */
export async function sendTestNotificationAction(): Promise<SettingsResult> {
  try {
    const ctx = await requireCapability('automation:manage');
    const prisma = await getTenantPrisma(ctx.organizationId);
    const site = await defaultSite(ctx.organizationId);
    if (!site) return { ok: false, error: 'No site configured.' };

    const settings = await prisma.notificationSetting.findUnique({ where: { siteId: site.id } });
    if (!settings?.emailEnabled && !settings?.slackEnabled) {
      return { ok: false, error: 'Enable a channel first — nothing is switched on.' };
    }

    const worst = await prisma.auditResult.findMany({
      where: { status: 'ok', strategy: 'mobile', performanceScore: { not: null } },
      orderBy: { performanceScore: 'asc' },
      take: 3,
      select: { performanceScore: true, page: { select: { url: true } } },
    });

    const outcome = await dispatchSweepNotification(ctx.organizationId, site.id, {
      runId: 'test',
      siteName: site.name,
      event: 'sweep.completed',
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      durationMinutes: null,
      averagePerformance: null,
      previousAveragePerformance: null,
      worstPages: worst.map((w) => ({ url: w.page.url, score: w.performanceScore })),
      dashboardUrl: getEnv().APP_URL,
      error: 'This is a test notification — no sweep actually ran.',
    });

    // Report what actually happened. Claiming "sent" when the transport is
    // log-only is exactly how this looked broken rather than unconfigured.
    if (outcome.problems.length > 0) {
      return { ok: false, error: outcome.problems.join('  ') };
    }
    return { ok: true, message: `Delivered via ${outcome.attempted.join(' and ')}.` };
  } catch (e) {
    return { ok: false, error: friendlyErrorMessage(e, 'Could not send the test notification.') };
  }
}

export async function previewCronAction(expr: string, timezone: string) {
  await requireCapability('automation:manage');
  return validateCron(expr, timezone);
}
