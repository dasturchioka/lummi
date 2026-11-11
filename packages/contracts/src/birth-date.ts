/**
 * The date of birth's rules the Mini App also needs at runtime (ticket #30). No imports, so it
 * travels through `@lummi/contracts/constants` without zod (ADR 0030).
 */

/** The earliest year a date of birth may be in; the latest day is today in Tashkent (the server checks). */
export const BIRTH_YEAR_MIN = 1900;

/** True for a real calendar day written `YYYY-MM-DD` (no 31 April; 29 February only in a leap year). */
export function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
