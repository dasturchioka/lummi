import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  REPORT_DEFAULT_DAYS,
  REPORT_MAX_DAYS,
  tashkentDay,
  tashkentDayStart,
  tashkentDaySchema,
  type ReportQuery,
} from '@lummi/contracts';
import { and, sql, type SQL } from '@lummi/db';
import type { AnyColumn } from 'drizzle-orm';

/*
 * The range rules every report shares (#42, #43): which days a report may cover, the default
 * range, the instants a range spans, and how an average is rounded.
 */

/** Tashkent days `YYYY-MM-DD`, both inclusive. */
export interface TashkentRange {
  from: string;
  to: string;
}

/**
 * A range a report takes: two real Tashkent days written `YYYY-MM-DD`, `from` not after `to`,
 * at most `REPORT_MAX_DAYS` days.
 */
export function isReportRange(range: TashkentRange): boolean {
  const real = (day: string) => tashkentDaySchema.safeParse(day).success;
  if (!real(range.from) || !real(range.to) || range.from > range.to) return false;
  const last = formatLocalDate(addDays(parseLocalDate(range.from), REPORT_MAX_DAYS - 1));
  return range.to <= last;
}

/** The `days` Tashkent days that end with `to`, `to` included. */
export function daysEnding(to: string, days: number): TashkentRange {
  return { from: formatLocalDate(addDays(parseLocalDate(to), 1 - days)), to };
}

/** The last `days` Tashkent days up to `now`'s Tashkent day, that day included. */
export function lastTashkentDays(days: number, now: Date): TashkentRange {
  return daysEnding(formatLocalDate(tashkentDay(now)), days);
}

/**
 * The range a report URL asked for, a missing end filled in: no `to` is today (Tashkent), no
 * `from` is 30 days up to `to`. Null when it is no report range (`isReportRange`): backwards, or
 * over a year.
 */
export function askedRange(query: ReportQuery, now: Date): TashkentRange | null {
  const fallback = query.to
    ? daysEnding(query.to, REPORT_DEFAULT_DAYS)
    : lastTashkentDays(REPORT_DEFAULT_DAYS, now);
  const range = { from: query.from ?? fallback.from, to: query.to ?? fallback.to };
  return isReportRange(range) ? range : null;
}

/** The instants a range spans: 00:00 Tashkent of `from`, up to (not including) the day after `to`. */
export function rangeBounds(range: TashkentRange): { start: string; end: string } {
  return {
    start: tashkentDayStart(range.from).toISOString(),
    end: tashkentDayStart(range.to, 1).toISOString(),
  };
}

/** An instant on a day of the range, as a SQL condition. */
export function within(at: SQL | AnyColumn, range: TashkentRange): SQL {
  const { start, end } = rangeBounds(range);
  return and(sql`${at} >= ${start}`, sql`${at} < ${end}`)!;
}

/**
 * `total ÷ count` to the nearest so'm, halves up; null for no count. The reports' average check
 * and the admin Home's average payment (#48) round alike. For a total of zero or more.
 */
export function roundedAverage(total: number, count: number): number | null {
  return count === 0 ? null : Math.floor((2 * total + count) / (2 * count));
}
