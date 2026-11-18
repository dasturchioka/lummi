import { z } from 'zod';
import { UPGRADE_RIGHT_SOURCES } from './constants';

/**
 * The Quote: the server-computed price breakdown of a cart (ADR 0001). Clients get only this
 * shape; the rules that produce it live in the API's pricing module, so no client computes money.
 * Every amount is whole so'm (ADR 0016).
 */
const som = z.number().int().nonnegative();
const id = z.number().int();

/** Whether the free-delivery threshold is compared with items before or after the discount. */
export const thresholdBaseSchema = z.enum(['before', 'after']);
export type ThresholdBase = z.infer<typeof thresholdBaseSchema>;

/** What opened an upgrade right: a delivered set, or a delivered single 10 ml bottle (ADR 0003). */
export const upgradeRightSourceSchema = z.enum(UPGRADE_RIGHT_SOURCES);
export type UpgradeRightSource = z.infer<typeof upgradeRightSourceSchema>;

/**
 * What a gift promo code gives (ADR 0039): one Volume, or the Discovery set, quantity 1, free.
 * `value` is its regular price: the customer pays 0 for it, the reports count it as the discount.
 */
export const promoGiftItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('volume'), volumeId: id }),
  z.object({ kind: z.literal('discovery_set') }),
]);
export type PromoGiftItem = z.infer<typeof promoGiftItemSchema>;
export const promoGiftSchema = z.object({ item: promoGiftItemSchema, value: som });
export type PromoGift = z.infer<typeof promoGiftSchema>;

/** The one Discount on an order and the discount source it comes from. */
export const discountSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('upgrade_right'),
    id,
    source: upgradeRightSourceSchema,
    /** The right's own percent, for «Скидка за набор −20%» on the line it discounts. */
    percent: z.number().int(),
    amount: som,
    /** The line holding the single full-size unit the right discounts (ADR 0007). */
    lineKey: z.string(),
  }),
  z.object({ type: z.literal('birthday_coupon'), id, amount: som }),
  z.object({
    type: z.literal('promo_code'),
    code: z.string(),
    /** So'm off the paid items; 0 for a gift code, whose gift is a free line instead. */
    amount: som,
    /** A gift code's Promo gift (ADR 0039); absent for a percent or fixed code. */
    promoGift: promoGiftSchema.optional(),
  }),
]);
export type Discount = z.infer<typeof discountSchema>;

/** The one test for «is a Promo gift»: a gift code's gift when the discount is one (ADR 0039), else null. */
export function promoGiftOf(d: Discount | null | undefined): PromoGift | null {
  return d?.type === 'promo_code' && d.promoGift ? d.promoGift : null;
}

/** The same Promo gift item: the Discovery set, or the same volume. */
export function samePromoGiftItem(a: PromoGiftItem | null, b: PromoGiftItem | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'discovery_set' || b.kind === 'discovery_set') return a.kind === b.kind;
  return a.volumeId === b.volumeId;
}

/** The same Promo gift: the same item at the same value (none and none are the same). */
export function samePromoGift(a: PromoGift | null, b: PromoGift | null): boolean {
  if (a === null || b === null) return a === b;
  return a.value === b.value && samePromoGiftItem(a.item, b.item);
}

/** The gift's regular price when the discount is a gift code, else 0: what reports add to both «Сумма до скидки» and «Скидка» (ADR 0039). */
export function promoGiftValue(d: Discount | null | undefined): number {
  return promoGiftOf(d)?.value ?? 0;
}

export const quoteLineSchema = z.object({
  /** The caller's line key (cart line id), echoed back. */
  key: z.string(),
  qty: z.number().int().positive(),
  /** The effective unit price: the markdown price while it is active (ADR 0008). */
  unitPrice: som,
  regularUnitPrice: som,
  markedDown: z.boolean(),
  lineTotal: som,
  /** «Нет в наличии»: shown, but left out of every sum. */
  soldOut: z.boolean(),
});
export type QuoteLine = z.infer<typeof quoteLineSchema>;

/** Another discount the customer could switch to, with the delivery and total it would give. */
export const discountAlternativeSchema = z.object({
  discount: discountSchema,
  deliveryFee: som,
  total: som,
  /** How much lower this total is than the quote's total; 0 when it is not lower. */
  cheaperBy: som,
});
export type DiscountAlternative = z.infer<typeof discountAlternativeSchema>;

/**
 * Why the shop refuses an entered code before pricing it (the checks needing the DB, ticket #29):
 * no such code, switched off by the owner, past its last day, every use taken, this customer's
 * uses taken, or a new-customers-only code for a customer with an order.
 */
export const PROMO_CODE_REFUSALS = [
  'unknown',
  'inactive',
  'expired',
  'exhausted',
  'already_used',
  'not_new_customer',
] as const;
export const promoCodeRefusalSchema = z.enum(PROMO_CODE_REFUSALS);
export type PromoCodeRefusal = z.infer<typeof promoCodeRefusalSchema>;

/** Why an entered promo code is not applied; the order is never blocked by it. */
export const promoCodeInvalidSchema = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('below_minimum'), minOrderTotal: som }),
  z.object({ reason: z.literal('no_eligible_items') }),
  /** A gift code whose gift has none left after the cart's own lines (ADR 0039): «Подарок закончился». */
  z.object({ reason: z.literal('gift_sold_out') }),
  /** A gift code with nothing paid for (every line sold out): the gift comes only with an order. */
  z.object({ reason: z.literal('gift_needs_items') }),
  z.object({ reason: promoCodeRefusalSchema }),
]);
export type PromoCodeInvalid = z.infer<typeof promoCodeInvalidSchema>;

export const quoteSchema = z.object({
  lines: z.array(quoteLineSchema),
  /** Items before discount, sold-out lines excluded, no delivery. */
  itemsSubtotal: som,
  discount: discountSchema.nullable(),
  /** The applied discount's threshold base; `before` when there is no discount (same amount). */
  thresholdBase: thresholdBaseSchema,
  /** The amount compared with the free-delivery threshold. */
  thresholdBaseAmount: som,
  freeDeliveryThreshold: som,
  /** The "add N so'm more for free delivery" nudge; 0 once the threshold is reached. */
  amountToFreeDelivery: som,
  deliveryFee: som,
  /** «Итого»: items − discount + delivery. */
  total: som,
  alternatives: z.array(discountAlternativeSchema),
  /** What the cart costs with no discount at all: the «Не применять» choice (#39). */
  withoutDiscount: z.object({ deliveryFee: som, total: som }),
  /** The entered promo code and, when it is not applied for a pricing reason, why. */
  promoCode: z.object({ code: z.string(), invalid: promoCodeInvalidSchema.nullable() }).nullable(),
  /** The customer's chosen discount no longer applies, so the automatic choice was used. */
  staleChoice: z.boolean(),
});
export type Quote = z.infer<typeof quoteSchema>;
