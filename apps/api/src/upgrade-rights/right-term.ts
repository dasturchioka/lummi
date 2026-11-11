import { tashkentDayStart, utcToTashkent } from '@lummi/contracts';

const DAY_MS = 86_400_000;

/** The Tashkent calendar day of an instant, `YYYY-MM-DD`. */
export function tashkentDate(instant: Date): string {
  const { year, month, day } = utcToTashkent(instant);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * An upgrade right's term (TZ §3.4: «30 дней с момента статуса Доставлен»), counted in Tashkent
 * days: opened on day D, it works through the whole of day D + `validityDays` and ends at 00:00
 * the day after, so the customer never loses part of the last day to the hour of delivery.
 */
export function rightTerm(
  openedAt: Date,
  validityDays: number,
): { lastDay: string; expiresAt: Date } {
  const opened = tashkentDate(openedAt);
  return {
    lastDay: tashkentDate(tashkentDayStart(opened, validityDays)),
    expiresAt: tashkentDayStart(opened, validityDays + 1),
  };
}

/** The last day of a right that ends at `expiresAt` (00:00 Tashkent the day after it). */
export function lastDayOf(expiresAt: Date): string {
  return tashkentDate(new Date(expiresAt.getTime() - DAY_MS));
}
