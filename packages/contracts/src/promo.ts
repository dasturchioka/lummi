import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { normalizePromoCode, PROMO_CODE_PATTERN } from './promo-code';

export { normalizePromoCode, PROMO_CODE_PATTERN } from './promo-code';

/**
 * Promo codes (ticket #29; ADR 0002, 0005, 0007, 0008; spec Changes 2026-11-07 promo counting).
 * Every amount is whole so'm (ADR 0016). The owner edits them in admin; a shopper types one in
 * the cart, where `quote()` makes it the order's one discount or says why it is not applied.
 */
const som = (min: number) => z.number().int().min(min).max(100_000_000);

export const PROMO_KINDS = ['percent', 'fixed', 'gift'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

/**
 * A gift code's free item as the owner picks it (ADR 0039): one volume of a fragrance, or the
 * Discovery set. Quantity is always 1.
 */
export const promoGiftInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('volume'),
    fragranceId: z.number().int().positive(),
    ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
  }),
  z.object({ kind: z.literal('discovery_set') }),
]);
export type PromoGiftInput = z.infer<typeof promoGiftInputSchema>;

/** A code as stored: `normalizePromoCode`'s form, then Latin letters, digits, `-` and `_` only. */
export const promoCodeTextSchema = z
  .string()
  .max(64)
  .transform(normalizePromoCode)
  .pipe(z.string().regex(PROMO_CODE_PATTERN, 'code_format'));

/**
 * What the owner saves. A percent code has a whole percent (1-100) and an optional cap; a fixed
 * code has an amount and no cap; a gift code has its gift and neither (ADR 0039). `expiresOn` is a Tashkent calendar day: the code works until
 * 23:59:59 that day. Limits and the minimum are optional (null: none).
 */
export const promoCodeInputSchema = z
  .object({
    code: promoCodeTextSchema,
    kind: z.enum(PROMO_KINDS),
    percent: z.number().int().min(1).max(100).nullable(),
    amount: som(1).nullable(),
    maxDiscount: som(1).nullable(),
    /** A gift code's Promo gift; null for the other kinds. */
    promoGift: promoGiftInputSchema.nullable().default(null),
    expiresOn: tashkentDaySchema.nullable(),
    minOrderTotal: som(1).nullable(),
    totalLimit: z.number().int().min(1).max(1_000_000).nullable(),
    perCustomerLimit: z.number().int().min(1).max(1_000).nullable(),
    newCustomersOnly: z.boolean(),
    appliesToMarkedDown: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.kind !== 'gift' && v.promoGift !== null)
      issue('promoGift', 'only_a_gift_code_has_a_promo_gift');
    if (v.kind === 'percent') {
      if (v.percent === null) issue('percent', 'required');
      if (v.amount !== null) issue('amount', 'percent_code_has_no_amount');
    } else if (v.kind === 'fixed') {
      if (v.amount === null) issue('amount', 'required');
      if (v.percent !== null) issue('percent', 'fixed_code_has_no_percent');
      if (v.maxDiscount !== null) issue('maxDiscount', 'fixed_code_has_no_cap');
    } else {
      if (v.promoGift === null) issue('promoGift', 'required');
      if (v.percent !== null) issue('percent', 'gift_code_has_no_percent');
      if (v.amount !== null) issue('amount', 'gift_code_has_no_amount');
      if (v.maxDiscount !== null) issue('maxDiscount', 'gift_code_has_no_cap');
    }
  });
export type PromoCodeInput = z.infer<typeof promoCodeInputSchema>;

/** The list badge: switched off, past its last day, every use taken, or working. */
export const PROMO_CODE_STATES = ['active', 'inactive', 'expired', 'exhausted'] as const;
export type PromoCodeState = (typeof PROMO_CODE_STATES)[number];

export const adminPromoCodeSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  kind: z.enum(PROMO_KINDS),
  percent: z.number().int().nullable(),
  amount: z.number().int().nullable(),
  maxDiscount: z.number().int().nullable(),
  /** A gift code's Promo gift, named for the list row («Rain Tea 10 мл»); null for the other kinds. */
  promoGift: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('volume'),
        fragranceId: z.number().int(),
        ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
        name: z.string(),
        brand: z.string(),
      }),
      z.object({ kind: z.literal('discovery_set') }),
    ])
    .nullable(),
  /** The last day it works, Tashkent (`YYYY-MM-DD`). */
  expiresOn: z.string().nullable(),
  minOrderTotal: z.number().int().nullable(),
  totalLimit: z.number().int().nullable(),
  perCustomerLimit: z.number().int().nullable(),
  newCustomersOnly: z.boolean(),
  appliesToMarkedDown: z.boolean(),
  active: z.boolean(),
  /** Uses held by orders that were not cancelled or returned: what the limits count. */
  uses: z.number().int().nonnegative(),
  /** Whether any order ever took it (a used code can be switched off, not deleted). */
  everUsed: z.boolean(),
  state: z.enum(PROMO_CODE_STATES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminPromoCode = z.infer<typeof adminPromoCodeSchema>;

/**
 * What a code brought over its whole life (#65), by the marketing report's own rules (Fulfilled
 * orders on their delivery day, refunds off the net). `statsFrom`..`statsTo` are the Tashkent
 * days it was counted over (its creation day to today); `reportFrom` is where the report link
 * starts: `statsFrom`, or the latest start the report page allows for a longer life.
 */
export const promoCodeStatsSchema = z.object({
  promoCodeId: z.number().int(),
  fulfilledOrders: z.number().int().nonnegative(),
  netSales: z.number().int(),
  statsFrom: tashkentDaySchema,
  statsTo: tashkentDaySchema,
  reportFrom: tashkentDaySchema,
});
export type PromoCodeStats = z.infer<typeof promoCodeStatsSchema>;
/** A list row with its stats, as the promo page joins the two answers. */
export type AdminPromoCodeRow = AdminPromoCode & PromoCodeStats;

export const promoErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid', 'code_taken', 'in_use']),
  fields: z.array(z.string()).optional(),
});

// ---- the cart ----

/** A typed code: anything up to 64 characters is judged (an odd one is just unknown). */
export const applyPromoCodeBodySchema = z.object({ code: z.string().trim().min(1).max(64) });

/** Too many codes typed in the window (codes are guessable); the stored code is unchanged. */
export const promoAttemptsErrorSchema = z.object({
  code: z.literal('too_many_attempts'),
  retryAfterSeconds: z.number().int().positive(),
});
