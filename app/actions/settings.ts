'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { saveSchedule, validateCron } from '@/lib/services/schedule.service';
import { dispatchSweepNotification } from '@/lib/notify';
import { getEnv } from '@/lib/env';

export type SettingsResult = { ok: true; message: string; next?: string[] } | { ok: false; error: string };

export async function saveScheduleAction(_prev: unknown, form: FormData): Promise<SettingsResult> {
  await requireSession();

  const site = await prisma.site.findFirst({ select: { id: true } });
  if (!site) return { ok: false, error: 'No site configured.' };

  const enabled = form.get('enabled') === 'on';
  const cronExpr = String(form.get('cronExpr') ?? '').trim() || null;
  const timezone = String(form.get('timezone') ?? 'UTC').trim() || 'UTC';

  const result = await saveSchedule(site.id, { cronExpr, timezone, enabled });
  if (!result.valid) return { ok: false, error: result.error ?? 'Invalid schedule.' };

  revalidatePath('/settings');
  return {
    ok: true,
    message: enabled ? 'Schedule saved and enabled.' : 'Schedule saved (disabled).',
    next: result.next,
  };
}

export async function saveNotificationsAction(_prev: unknown, form: FormData): Promise<SettingsResult> {
  await requireSession();

  const site = await prisma.site.findFirst({ select: { id: true } });
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
}

/** Sends a sample through whatever channels are enabled, using real numbers. */
export async function sendTestNotificationAction(): Promise<SettingsResult> {
  await requireSession();

  const site = await prisma.site.findFirst({ select: { id: true, name: true } });
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

  await dispatchSweepNotification(site.id, {
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

  const via = [settings.emailEnabled && 'email', settings.slackEnabled && 'Slack'].filter(Boolean).join(' and ');
  return { ok: true, message: `Test sent via ${via}. Check the worker log if nothing arrives.` };
}

export async function previewCronAction(expr: string, timezone: string) {
  await requireSession();
  return validateCron(expr, timezone);
}
