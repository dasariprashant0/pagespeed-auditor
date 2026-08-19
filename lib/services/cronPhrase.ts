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
  /** 0-59. Whole hours only was a needless limitation -- "01:25" is a
   *  perfectly reasonable thing to want, and cron has always supported it. */
  minute: number;
  /** 0-6, Sunday = 0. Weekly only. */
  weekday: number;
  /** 1-28. Monthly only; capped so it exists in every month. */
  monthday: number;
}

export const DEFAULT_CHOICE: ScheduleChoice = {
  frequency: 'daily', hour: 3, minute: 0, weekday: 1, monthday: 1,
};

export function choiceToCron(c: ScheduleChoice): string {
  const m = c.minute;
  switch (c.frequency) {
    case 'daily':
      return `${m} ${c.hour} * * *`;
    case 'weekdays':
      return `${m} ${c.hour} * * 1-5`;
    case 'weekly':
      return `${m} ${c.hour} * * ${c.weekday}`;
    case 'monthly':
      return `${m} ${c.hour} ${c.monthday} * *`;
  }
}

/** Best-effort parse, so an existing expression reopens in the right state. */
export function cronToChoice(expr: string | null): ScheduleChoice | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteRaw, hourRaw, dom, month, dow] = parts;
  if (month !== '*') return null;

  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const base = { ...DEFAULT_CHOICE, hour, minute };
  if (dom === '*' && dow === '*') return { ...base, frequency: 'daily' };
  if (dom === '*' && dow === '1-5') return { ...base, frequency: 'weekdays' };
  if (dom === '*' && /^[0-6]$/.test(dow)) return { ...base, frequency: 'weekly', weekday: Number(dow) };
  if (dow === '*' && /^\d{1,2}$/.test(dom)) return { ...base, frequency: 'monthly', monthday: Number(dom) };

  return null; // a hand-written expression the picker cannot represent
}

export function formatTime(hour: number, minute = 0): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "01:25" for an <input type="time">. */
export function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function fromTimeValue(v: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** "Every Monday at 3:00 am" — what the picker currently means. */
export function describeChoice(c: ScheduleChoice): string {
  const at = `at ${formatTime(c.hour, c.minute)}`;
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
