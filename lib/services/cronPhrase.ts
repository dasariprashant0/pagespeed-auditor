/**
 * Cron <-> plain English.
 *
 * A cron expression is not something a marketing or web team should have to
 * read to know when their site gets checked. The picker builds the expression;
 * this describes it back so nobody has to trust that it did the right thing.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Frequency = 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface ScheduleChoice {
  frequency: Frequency;
  /** 0-23 */
  hour: number;
  /** 0-6, Sunday = 0. Weekly only. */
  weekday: number;
  /** 1-28. Monthly only; capped so it exists in every month. */
  monthday: number;
}

export const DEFAULT_CHOICE: ScheduleChoice = { frequency: 'daily', hour: 3, weekday: 1, monthday: 1 };

export function choiceToCron(c: ScheduleChoice): string {
  switch (c.frequency) {
    case 'daily':
      return `0 ${c.hour} * * *`;
    case 'weekdays':
      return `0 ${c.hour} * * 1-5`;
    case 'weekly':
      return `0 ${c.hour} * * ${c.weekday}`;
    case 'monthly':
      return `0 ${c.hour} ${c.monthday} * *`;
  }
}

/** Best-effort parse, so an existing expression reopens in the right state. */
export function cronToChoice(expr: string | null): ScheduleChoice | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hourRaw, dom, month, dow] = parts;
  if (minute !== '0' || month !== '*') return null;

  const hour = Number(hourRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  if (dom === '*' && dow === '*') return { ...DEFAULT_CHOICE, frequency: 'daily', hour };
  if (dom === '*' && dow === '1-5') return { ...DEFAULT_CHOICE, frequency: 'weekdays', hour };
  if (dom === '*' && /^[0-6]$/.test(dow)) return { ...DEFAULT_CHOICE, frequency: 'weekly', hour, weekday: Number(dow) };
  if (dow === '*' && /^\d{1,2}$/.test(dom)) return { ...DEFAULT_CHOICE, frequency: 'monthly', hour, monthday: Number(dom) };

  return null; // a hand-written expression the picker cannot represent
}

export function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? 'am' : 'pm'}`;
}

/** "Every Monday at 3:00 am" — what the picker currently means. */
export function describeChoice(c: ScheduleChoice): string {
  const at = `at ${formatHour(c.hour)}`;
  switch (c.frequency) {
    case 'daily':
      return `Every day ${at}`;
    case 'weekdays':
      return `Every weekday (Mon–Fri) ${at}`;
    case 'weekly':
      return `Every ${DAYS[c.weekday]} ${at}`;
    case 'monthly':
      return `On the ${ordinal(c.monthday)} of each month ${at}`;
  }
}

/** Describes any expression, including hand-written ones the picker can't build. */
export function describeCron(expr: string | null): string {
  if (!expr) return 'No schedule set';
  const choice = cronToChoice(expr);
  return choice ? describeChoice(choice) : `Custom schedule (${expr})`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export { DAYS };
