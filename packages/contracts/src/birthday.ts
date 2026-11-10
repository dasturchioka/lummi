import { z } from 'zod';

/**
 * The date of birth and the birthday coupon as the Mini App sees them (TZ §3.8, ticket #30). The
 * coupon itself applies through the cart's quote like any discount; these are Profile's
 * «Мои скидки» and the one-time date entry.
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

/** `YYYY-MM-DD`, a real calendar day. */
export const birthDateSchema = z.string().refine(isCalendarDate, 'a YYYY-MM-DD calendar date');

export const setBirthDateBodySchema = z.object({
  birthDate: birthDateSchema,
  /** Data-processing consent («включая дату рождения»): required while the customer has none. */
  consent: z.boolean().default(false),
});
export type SetBirthDateBody = z.input<typeof setBirthDateBodySchema>;

export const BIRTH_DATE_ERRORS = [
  'unauthorized',
  /** The date is entered by a customer with an account phone (one phone = one account, TZ §3.8). */
  'phone_required',
  /** Entered once; only staff correct it afterwards. */
  'already_set',
  /** Before 1900 or after today in Tashkent. */
  'invalid_birth_date',
  'consent_required',
] as const;
export const birthDateErrorSchema = z.object({ code: z.enum(BIRTH_DATE_ERRORS) });

/** An active birthday coupon: it applies in the cart by itself while it lowers the total. */
export const birthdayCouponSchema = z.object({
  id: z.number().int(),
  percent: z.number().int(),
  /** The most it takes off, so'm. */
  maxAmount: z.number().int().nonnegative(),
  /** The last day it works, Tashkent `YYYY-MM-DD` (through 23:59:59). */
  lastDay: z.string(),
  /** Whole days after today until `lastDay`; 0 on the last day. */
  daysLeft: z.number().int().nonnegative(),
});
export type BirthdayCouponDto = z.infer<typeof birthdayCouponSchema>;

/** Profile «Мои скидки» (#30 creates it; the upgrade rights of #38 join it). */
export const myDiscountsSchema = z.object({
  /** `YYYY-MM-DD`; null until entered. */
  birthDate: z.string().nullable(),
  /** Active coupons, soonest to end first. */
  birthdayCoupons: z.array(birthdayCouponSchema),
  /**
   * While no coupon is active: the first day of the next one (`YYYY-MM-DD`, «появится 11 марта»);
   * null without a date of birth.
   */
  nextBirthdayCoupon: z.object({ opensOn: z.string(), percent: z.number().int() }).nullable(),
  /** The percent a coupon issued now would carry (setting `birthday.percent`), for the invitation. */
  birthdayPercent: z.number().int(),
  /** Days before the birthday the coupon arrives (setting `birthday.daysBefore`). */
  birthdayDaysBefore: z.number().int(),
  /** Consent is asked with the date while the customer has given none (TZ §3.6). */
  needsConsent: z.boolean(),
});
export type MyDiscountsDto = z.infer<typeof myDiscountsSchema>;
