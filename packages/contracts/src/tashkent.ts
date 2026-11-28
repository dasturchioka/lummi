/**
 * Asia/Tashkent wall clock ↔ UTC, the one place for it (CLAUDE.md: schedules and day-based rules
 * run in Asia/Tashkent; ADR 0016: instants are stored as UTC). Uzbekistan keeps UTC+05:00 all year
 * (no DST since 1992), so this is a fixed offset. Months are 1–12.
 */
const OFFSET_MS = 5 * 60 * 60 * 1000;

export interface TashkentDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** The UTC instant of a Tashkent wall-clock time; null when the fields are not a real date-time. */
export function tashkentToUtc(local: TashkentDateTime): Date | null {
  const { year, month, day, hour, minute, second = 0 } = local;
  const parts = [year, month, day, hour, minute, second];
  if (!parts.every(Number.isInteger)) return null;
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls 31.02 over to March and 24:00 to the next day; reading back catches both.
  const expected = { year, month, day, hour, minute, second };
  const back = utcFields(asUtc);
  const fits = (Object.keys(expected) as (keyof typeof expected)[]).every(
    (k) => back[k] === expected[k],
  );
  return fits ? new Date(asUtc.getTime() - OFFSET_MS) : null;
}

/** The Tashkent wall-clock fields of a UTC instant. */
export function utcToTashkent(instant: Date): Required<TashkentDateTime> {
  return utcFields(new Date(instant.getTime() + OFFSET_MS));
}

function utcFields(d: Date): Required<TashkentDateTime> {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/**
 * The start of a Tashkent calendar day (`YYYY-MM-DD`, already checked to be a real day) as a UTC
 * instant, `plusDays` later: day filters read `from` as its 00:00 and `to` up to the next midnight.
 */
export function tashkentDayStart(day: string, plusDays = 0): Date {
  const [year, month, d] = day.split('-').map(Number) as [number, number, number];
  // roll the calendar forward in UTC arithmetic, then read it back as a Tashkent wall-clock date
  const rolled = new Date(Date.UTC(year, month - 1, d + plusDays));
  return tashkentToUtc({
    year: rolled.getUTCFullYear(),
    month: rolled.getUTCMonth() + 1,
    day: rolled.getUTCDate(),
    hour: 0,
    minute: 0,
  }) as Date;
}

/*
 * Calendar days on the Tashkent wall clock, for day-based terms: the birthday coupon's window
 * (#30) and the upgrade right's term (#38).
 */

const DAY_MS = 86_400_000;

/** A calendar day; months are 1–12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
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

/** The last day of something that ends at `expiresAt`, 00:00 Tashkent the day after it (exclusive). */
export function lastDayOf(expiresAt: Date): LocalDate {
  return addDays(tashkentDay(expiresAt), -1);
}

/** Whole Tashkent days from today to `lastDay`: 0 on the last day itself. */
export function daysLeft(lastDay: LocalDate, now: Date): number {
  return Math.max(0, daysBetween(tashkentDay(now), lastDay));
}
