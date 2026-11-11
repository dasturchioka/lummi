import { z } from 'zod';
import { isCalendarDate } from './birth-date';
import { myUpgradeRightSchema } from './upgrade-rights';

/**
 * The date of birth and the birthday coupon as the Mini App sees them (TZ §3.8, ticket #30). The
 * coupon itself applies through the cart's quote like any discount; these are Profile's
 * «Мои скидки» and the one-time date entry.
 */

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
  /** Open upgrade rights (#38), soonest to end first. */
  upgradeRights: z.array(myUpgradeRightSchema),
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
