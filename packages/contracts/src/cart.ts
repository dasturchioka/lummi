import { z } from 'zod';
import { deliveryCitySchema } from './delivery';
import { CART_MAX_QTY } from './constants';
import { discountSchema, quoteSchema, upgradeRightSourceSchema } from './quote';

/**
 * The server-side cart (spec Changes 2026-11-10, cart). Every response carries a fresh Quote; the
 * Mini App displays its numbers and never adds, multiplies or formats a total itself (ADR 0001).
 */
const lineBase = {
  /** The cart line id; the quote's line `key` is this id as a string. */
  id: z.number().int(),
  photo: z.string().nullable(),
  /** What the quote counts: the stored quantity, never above `available` (a sold-out line keeps its own). */
  qty: z.number().int().positive(),
  /** On hand minus reserve: the most the stepper can reach. 0 = «Нет в наличии». */
  available: z.number().int().nonnegative(),
  soldOut: z.boolean(),
  /** The customer asked for more than is available; `qty` is what is left («Осталось N»). */
  limited: z.boolean(),
};

export const volumeLineSchema = z.object({
  ...lineBase,
  kind: z.literal('volume'),
  slug: z.string(),
  name: z.string(),
  /** The original the fragrance is inspired by: every row names it («по мотивам …»). */
  brand: z.string(),
  ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
});

/** The five fragrances a set line holds, named on the row (spec Changes 2026-11-10, sets). */
const setFragrances = z.array(z.object({ slug: z.string(), name: z.string(), brand: z.string() }));
export const discoveryLineSchema = z.object({
  ...lineBase,
  kind: z.literal('discovery_set'),
  fragrances: setFragrances,
});
export const builderLineSchema = z.object({
  ...lineBase,
  kind: z.literal('builder_set'),
  fragrances: setFragrances,
  /**
   * The picks whose 10 ml cannot fill this line (empty unless it is sold out). `inCart` marks one
   * that is short only because an earlier line of this cart already holds it (spec Changes 2026-11-10).
   */
  short: z.array(z.object({ slug: z.string(), name: z.string(), inCart: z.boolean() })),
});

/**
 * A gift code's free item (ADR 0039), shown under the lines at 0 («Подарок по промокоду») while
 * the quote applies the code. It is not a cart line: no quantity, no stepper, no removal.
 */
export const promoGiftLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('volume'),
    photo: z.string().nullable(),
    slug: z.string(),
    name: z.string(),
    brand: z.string(),
    ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
    /** What the shopper pays for it: always 0, said by the server (ADR 0001). */
    lineTotal: z.literal(0),
  }),
  z.object({
    kind: z.literal('discovery_set'),
    photo: z.string().nullable(),
    fragrances: setFragrances,
    lineTotal: z.literal(0),
  }),
]);
export type PromoGiftLineDto = z.infer<typeof promoGiftLineSchema>;

export const cartLineSchema = z.discriminatedUnion('kind', [
  volumeLineSchema,
  discoveryLineSchema,
  builderLineSchema,
]);
export type CartLineDto = z.infer<typeof cartLineSchema>;
export type VolumeLineDto = z.infer<typeof volumeLineSchema>;
export type SetLineDto = z.infer<typeof discoveryLineSchema> | z.infer<typeof builderLineSchema>;

/** A 10 ml bottle that alone would close the gap to free delivery. */
export const cartSuggestionSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  ml: z.literal(10),
  photo: z.string().nullable(),
  /** The price to pay now (the markdown while it is active). */
  price: z.number().int().nonnegative(),
});
export type CartSuggestionDto = z.infer<typeof cartSuggestionSchema>;

const som = z.number().int().nonnegative();

/**
 * One row of the cart's discount switch (#39, ADR 0002): a discount the shopper can pick, or none
 * («Не применять», `discount` null), with the delivery and total it gives, as the server priced it.
 */
export const discountOptionSchema = z.object({
  discount: discountSchema.nullable(),
  deliveryFee: som,
  total: som,
  /** The one the quote applied. */
  applied: z.boolean(),
  /** An Entitlement's own terms: its percent and last day (Tashkent `YYYY-MM-DD`). */
  terms: z.object({ percent: z.number().int(), lastDay: z.string() }).nullable(),
});
export type DiscountOptionDto = z.infer<typeof discountOptionSchema>;

export const cartSchema = z.object({
  lines: z.array(cartLineSchema),
  quote: quoteSchema,
  /** The tab-bar badge: units that can be bought (sold-out lines are not counted). */
  count: z.number().int().nonnegative(),
  /** The customer's saved delivery city, which names the delivery line and sets the tariff. */
  deliveryCity: deliveryCitySchema.nullable(),
  /** The Sage thread's fill, an integer 0-100 worked out by the server (100 when reached or the threshold is 0; 0 for an empty cart). */
  freeDeliveryProgress: z.number().int().min(0).max(100),
  /** Available 10 ml volumes not in the cart whose price covers the gap (up to `cart.suggestionsLimit`); empty when none does or the threshold is reached. */
  suggestions: z.array(cartSuggestionSchema),
  /** The link-prefilled or entered promo code (the promo ticket reads and clears it). */
  promoCode: z.string().nullable(),
  /** The applied gift code's free item (ADR 0039); null when the quote applies no gift. */
  promoGift: promoGiftLineSchema.nullable(),
  /**
   * The discount switch (#39): every choice, cheapest total first and «Не применять» last, in an
   * order that does not move when the shopper switches. Empty when there is nothing to choose
   * between (no discount at all, or only an applied code, which its own field removes).
   */
  discountOptions: z.array(discountOptionSchema),
  /**
   * The chosen discount `quote.staleChoice` reports as lapsed (#39), by its source, so the cart can
   * name it: «Купон ко дню рождения больше не действует — …». Null otherwise.
   */
  lapsedDiscount: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('birthday_coupon') }),
      z.object({ type: z.literal('upgrade_right'), source: upgradeRightSourceSchema }),
    ])
    .nullable(),
  /**
   * An entered promo code is applied while one of the customer's Entitlements (a birthday coupon,
   * #30; an upgrade right, #38) would also discount this cart (ADR 0002: the code wins): the one the
   * server would pick without the code, as it judged it, and how much lower its total is
   * («Скидка за набор выгоднее на … сум», #39; 0 when it is not). Null otherwise.
   */
  entitlementWaiting: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('birthday_coupon'),
        id: z.number().int(),
        percent: z.number().int(),
        /** Its last day, Tashkent `YYYY-MM-DD`. */
        lastDay: z.string(),
        cheaperBy: som,
      }),
      z.object({
        type: z.literal('upgrade_right'),
        id: z.number().int(),
        source: upgradeRightSourceSchema,
        percent: z.number().int(),
        lastDay: z.string(),
        cheaperBy: som,
      }),
    ])
    .nullable(),
});
export type CartDto = z.infer<typeof cartSchema>;

export const addCartLineBodySchema = z.object({
  slug: z.string().min(1).max(100),
  ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
  /** How many to add; the total is capped at available. */
  qty: z.number().int().min(1).max(CART_MAX_QTY).default(1),
});
export const setCartLineBodySchema = z.object({ qty: z.number().int().min(1).max(CART_MAX_QTY) });

/**
 * The shopper's tap on the discount switch (#39, ADR 0002): an entitlement, the entered code, or
 * `none` («Не применять»: no discount, the entitlements keep for a later order).
 */
export const discountChoiceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['upgrade_right', 'birthday_coupon']), id: z.number().int().positive() }),
  z.object({ type: z.literal('promo_code') }),
  z.object({ type: z.literal('none') }),
]);
export type DiscountChoiceDto = z.infer<typeof discountChoiceSchema>;

/** The choice is not one the cart offers now (taken meanwhile, never held): here is the cart as it is. */
export const discountUnavailableSchema = z.object({
  code: z.literal('discount_unavailable'),
  cart: cartSchema,
});

export const cartErrorSchema = z.object({
  code: z.enum(['unauthorized', 'not_found', 'sold_out']),
});
