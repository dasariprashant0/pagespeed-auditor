import { CronExpressionParser } from 'cron-parser';
import { getTenantPrisma } from '../db/tenant.ts';
import { logger } from '../logger.ts';

/**
 * Scheduling for the one thing that is schedule-only: the full sweep.
 *
 * Validation lives here rather than in the UI because the worker registers
 * schedules from the same rows, and a cron that the UI accepted but the worker
 * cannot parse would fail silently at 3am.
 */

export interface CronValidation {
  valid: boolean;
  error?: string;
  /** Next few fire times, so a person can sanity-check what they typed. */
  next: string[];
}

/**
 * A sweep takes roughly 35 minutes. Anything more frequent than hourly would
 * stack runs indefinitely -- and because the planner's overlap guard skips
 * rather than queues, most of those firings would silently do nothing.
 */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

export function validateCron(expr: string, timezone = 'UTC'): CronValidation {
  const trimmed = expr.trim();
  if (!trimmed) return { valid: false, error: 'Enter a schedule.', next: [] };

  // A misspelled zone would otherwise be accepted and then quietly run in UTC,
  // hours away from what was intended.
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
  } catch {
    return { valid: false, error: `"${timezone}" is not a timezone. Use a name like Asia/Kolkata or Europe/London.`, next: [] };
  }

  let times: Date[];
  try {
    const it = CronExpressionParser.parse(trimmed, { tz: timezone });
    times = Array.from({ length: 5 }, () => it.next().toDate());
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Not a valid cron expression.', next: [] };
  }

  for (let i = 1; i < times.length; i++) {
    if (times[i].getTime() - times[i - 1].getTime() < MIN_INTERVAL_MS) {
      return {
        valid: false,
        error: 'Sweeps take about 35 minutes, so schedules must be at least an hour apart.',
        next: [],
      };
    }
  }

  return { valid: true, next: times.map((d) => d.toISOString()) };
}

export function nextRunAt(expr: string, timezone = 'UTC'): Date | null {
  try {
    return CronExpressionParser.parse(expr, { tz: timezone }).next().toDate();
  } catch {
    return null;
  }
}

export async function saveSchedule(
  organizationId: string,
  siteId: string,
  input: { cronExpr: string | null; timezone: string; enabled: boolean },
): Promise<CronValidation> {
  const prisma = await getTenantPrisma(organizationId);
  if (input.enabled) {
    if (!input.cronExpr) return { valid: false, error: 'Enter a schedule before enabling it.', next: [] };
    const check = validateCron(input.cronExpr, input.timezone);
    if (!check.valid) return check;
  }

  const next = input.cronExpr && input.enabled ? nextRunAt(input.cronExpr, input.timezone) : null;

  await prisma.schedule.upsert({
    where: { siteId },
    update: { cronExpr: input.cronExpr, timezone: input.timezone, enabled: input.enabled, nextRunAt: next },
    create: { siteId, cronExpr: input.cronExpr, timezone: input.timezone, enabled: input.enabled, nextRunAt: next },
  });

  logger.info({ siteId, cron: input.cronExpr, enabled: input.enabled }, 'schedule saved');
  return input.cronExpr ? validateCron(input.cronExpr, input.timezone) : { valid: true, next: [] };
}

/** Schedules whose next fire time has passed. Called by the worker's ticker. */
export async function dueSchedules(organizationId: string, now = new Date()) {
  const prisma = await getTenantPrisma(organizationId);
  return prisma.schedule.findMany({
    where: { enabled: true, cronExpr: { not: null }, nextRunAt: { lte: now } },
    select: { id: true, siteId: true, cronExpr: true, timezone: true },
  });
}

/** Advances nextRunAt after a firing, so the same tick cannot fire twice. */
export async function advanceSchedule(organizationId: string, scheduleId: string, cronExpr: string, timezone: string): Promise<void> {
  const prisma = await getTenantPrisma(organizationId);
  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { lastRunAt: new Date(), nextRunAt: nextRunAt(cronExpr, timezone) },
  });
}
