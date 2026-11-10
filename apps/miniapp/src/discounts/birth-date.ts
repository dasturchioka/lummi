import { BIRTH_YEAR_MIN, isCalendarDate } from '@lummi/contracts/constants';

/**
 * The date of birth as the shopper types it: `ДД.ММ.ГГГГ` on a digit keyboard, the dots added as
 * they go (a native date picker opens on today and needs some thirty taps back to 1996). The
 * server checks the date again; these only say early what it would refuse.
 */

/** Keeps up to eight digits and puts the dots after the day and the month. */
export function maskBirthDate(typed: string): string {
  const digits = typed.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4);
  // a dot the shopper typed right after the day stays, so «14.» does not jump back to «14»
  if (digits.length === 2 && /^\d{2}\D/.test(typed)) return `${day}.`;
  if (digits.length === 4 && /^\d{2}\D\d{2}\D/.test(typed)) return `${day}.${month}.`;
  return [day, month, year].filter(Boolean).join('.');
}

export type BirthDateVerdict =
  { ok: true; iso: string | null } | { ok: false; reason: 'format' | 'range' };

/**
 * Empty is fine (the field is optional); otherwise a whole calendar day from 1900 to `today`
 * (Tashkent, `YYYY-MM-DD`).
 */
export function judgeBirthDate(masked: string, today: string): BirthDateVerdict {
  if (masked.trim() === '') return { ok: true, iso: null };
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(masked);
  const iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  if (!iso || !isCalendarDate(iso)) return { ok: false, reason: 'format' };
  if (iso < `${BIRTH_YEAR_MIN}-01-01` || iso > today) return { ok: false, reason: 'range' };
  return { ok: true, iso };
}

/** Today in Tashkent (UTC+5 all year) as `YYYY-MM-DD`. */
export function tashkentToday(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}
