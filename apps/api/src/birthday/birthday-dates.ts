import { tashkentToUtc, utcToTashkent } from '@lummi/contracts';

/**
 * The birthday coupon's calendar (TZ §3.8, ticket #30), pure: no DB, no clock. Every day is a day
 * on the Asia/Tashkent wall clock (CLAUDE.md schedules). A coupon is issued at 10:00 Tashkent
 * `daysBefore` days before the birthday and works through the whole `daysAfter`-th day after it; a
 * 29 February birthday is celebrated on 28 February in a common year.
 */

/** A calendar day; months are 1–12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** The settings the calendar reads (`birthday.*`). */
export interface BirthdayRules {
  daysBefore: number;
  daysAfter: number;
  /** Abuse guard (TZ §3.8): no coupon opens sooner than this many days after the date was entered. */
  firstCouponAfterDays: number;
}

/** The daily job's hour (TZ §3.8: «в 10:00 по Ташкенту»), and so the hour a window opens. */
export const ISSUE_HOUR = 10;

const DAY_MS = 86_400_000;

/** One birthday's coupon: the days it covers and the instants that bound it. */
export interface CouponWindow {
  /** The year of the birthday it celebrates: one coupon per customer per such year. */
  birthdayYear: number;
  birthday: LocalDate;
  firstDay: LocalDate;
  lastDay: LocalDate;
  /** 10:00 Tashkent on the first day. */
  issuesAt: Date;
  /** 00:00 Tashkent the day after the last day: the coupon works while now is before it. */
  expiresAt: Date;
}

export function parseLocalDate(text: string): LocalDate {
  const [year, month, day] = text.split('-').map(Number);
  if (!year || !month || !day) throw new RangeError(`not a YYYY-MM-DD date: ${text}`);
  return { year, month, day };
}

export function formatLocalDate(d: LocalDate): string {
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `d` moved by `days` calendar days. */
export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * DAY_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
function daysBetween(a: LocalDate, b: LocalDate): number {
  return (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS;
}

/** The Tashkent calendar day of an instant. */
export function tashkentDay(instant: Date): LocalDate {
  const { year, month, day } = utcToTashkent(instant);
  return { year, month, day };
}

function atTashkent(d: LocalDate, hour: number): Date {
  const instant = tashkentToUtc({ ...d, hour, minute: 0 });
  if (!instant) throw new RangeError(`not a calendar day: ${formatLocalDate(d)}`);
  return instant;
}

/** The day a birthday is celebrated in `year`: 29 February becomes 28 February in a common year. */
export function celebratedOn(birth: LocalDate, year: number): LocalDate {
  if (birth.month === 2 && birth.day === 29 && !isLeap(year)) return { year, month: 2, day: 28 };
  return { year, month: birth.month, day: birth.day };
}

export function couponWindow(birth: LocalDate, year: number, rules: BirthdayRules): CouponWindow {
  const birthday = celebratedOn(birth, year);
  const firstDay = addDays(birthday, -rules.daysBefore);
  const lastDay = addDays(birthday, rules.daysAfter);
  return {
    birthdayYear: year,
    birthday,
    firstDay,
    lastDay,
    issuesAt: atTashkent(firstDay, ISSUE_HOUR),
    expiresAt: atTashkent(addDays(lastDay, 1), 0),
  };
}

/** The windows around `now`: last year's, this year's and the next two (a window may cross a year). */
function windowsAround(birth: LocalDate, now: Date, rules: BirthdayRules): CouponWindow[] {
  const { year } = tashkentDay(now);
  return [year - 1, year, year + 1, year + 2].map((y) => couponWindow(birth, y, rules));
}

/** The window whose coupon is due at `now` (it has opened and not expired), if any. */
export function openWindow(birth: LocalDate, now: Date, rules: BirthdayRules): CouponWindow | null {
  const t = now.getTime();
  return (
    windowsAround(birth, now, rules).find(
      (w) => w.issuesAt.getTime() <= t && t < w.expiresAt.getTime(),
    ) ?? null
  );
}

/** Abuse guard (TZ §3.8): the window opens at least `firstCouponAfterDays` after the date was entered. */
export function passesGuard(w: CouponWindow, setAt: Date, rules: BirthdayRules): boolean {
  return w.issuesAt.getTime() >= setAt.getTime() + rules.firstCouponAfterDays * DAY_MS;
}

/**
 * The next coupon still to come, for Profile («появится 11 марта»): the first window not yet over,
 * not issued yet, and past the abuse guard.
 */
export function nextWindow(
  birth: LocalDate,
  setAt: Date,
  now: Date,
  rules: BirthdayRules,
  issuedYears: readonly number[],
): CouponWindow | null {
  return (
    windowsAround(birth, now, rules).find(
      (w) =>
        w.expiresAt.getTime() > now.getTime() &&
        !issuedYears.includes(w.birthdayYear) &&
        passesGuard(w, setAt, rules),
    ) ?? null
  );
}

/**
 * The birth dates (month and day) whose window covers the Tashkent day `today`: birthdays from
 * `daysAfter` days ago to `daysBefore` days ahead, plus 29 February wherever that range holds the
 * 28 February of a common year. The job looks up only these customers.
 */
export function birthDaysOpenOn(
  today: LocalDate,
  rules: BirthdayRules,
): { month: number; day: number }[] {
  const out = new Map<string, { month: number; day: number }>();
  for (let n = -rules.daysAfter; n <= rules.daysBefore; n++) {
    const b = addDays(today, n);
    out.set(`${b.month}-${b.day}`, { month: b.month, day: b.day });
    if (b.month === 2 && b.day === 28 && !isLeap(b.year)) out.set('2-29', { month: 2, day: 29 });
  }
  return [...out.values()];
}

/** Whole Tashkent days from today to `lastDay`: 0 on the last day itself. */
export function daysLeft(lastDay: LocalDate, now: Date): number {
  return Math.max(0, daysBetween(tashkentDay(now), lastDay));
}
