import { z } from 'zod';
import { deliveryCitySchema } from './delivery';
import { CART_MAX_QTY } from './constants';
import { quoteSchema } from './quote';

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
});
export type CartDto = z.infer<typeof cartSchema>;

export const addCartLineBodySchema = z.object({
  slug: z.string().min(1).max(100),
  ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
  /** How many to add; the total is capped at available. */
  qty: z.number().int().min(1).max(CART_MAX_QTY).default(1),
});
export const setCartLineBodySchema = z.object({ qty: z.number().int().min(1).max(CART_MAX_QTY) });

export const cartErrorSchema = z.object({
  code: z.enum(['unauthorized', 'not_found', 'sold_out']),
});
