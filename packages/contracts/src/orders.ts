import { z } from 'zod';
import { parseBuyNowParam, BUY_NOW_ITEM_MAX } from './buy-now';
import { builderLineSchema, cartSchema, discoveryLineSchema, volumeLineSchema } from './cart';
import { btsPointSchema, deliveryCitySchema, regionSchema } from './delivery';
import { LINE_KINDS } from './constants';
import { discountSchema, quoteSchema, thresholdBaseSchema } from './quote';
import { CANCEL_REASONS } from './order-machine';
import {
  CHECKOUT_CONFLICTS,
  ORDER_INPUT_ERRORS,
  ORDER_STATUSES,
  ORDERS_PAGE_DEFAULT,
  ORDERS_PAGE_MAX,
} from './order-status';
import {
  GIFT_MESSAGE_HARD_MAX,
  ORDER_COMMENT_MAX,
  RECIPIENT_NAME_MAX,
  RECIPIENT_PHONE_INPUT_MAX,
  TYPED_ADDRESS_MAX,
  TYPED_ADDRESS_MIN,
} from './recipient';

const som = z.number().int().nonnegative();
const bilingual = z.object({ ru: z.string(), uz: z.string() });

export const orderStatusSchema = z.enum(ORDER_STATUSES);

/**
 * «Купить сейчас»: the one item a checkout buys instead of the cart, as the `item` text
 * (`volume:<slug>:<ml>`, `discovery_set`, `builder_set:<five slugs>`; `@lummi/contracts/buy-now`).
 * Parsed into the item; anything else is a 400.
 */
export const buyNowItemParamSchema = z
  .string()
  .max(BUY_NOW_ITEM_MAX)
  .transform((text, ctx) => {
    const item = parseBuyNowParam(text);
    if (!item) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not a buy-now item' });
      return z.NEVER;
    }
    return item;
  });

/** The line of a «Купить сейчас» checkout: a cart line's shape without a cart line id. */
export const buyNowLineSchema = z.discriminatedUnion('kind', [
  volumeLineSchema.omit({ id: true }),
  discoveryLineSchema.omit({ id: true }),
  builderLineSchema.omit({ id: true }),
]);
export type BuyNowLineDto = z.infer<typeof buyNowLineSchema>;

/**
 * A Recipient and BTS point pair the customer has ordered to («Мои пункты BTS», spec Changes
 * 2026-11-07 BTS point selection, 2026-11-11). One per recipient phone and point; the last used
 * comes first. Removing one never touches an order: each order keeps its own snapshot.
 */
export const savedPointSchema = z.object({
  id: z.number().int(),
  recipientName: z.string(),
  /** E.164, as the order stored it. */
  recipientPhone: z.string(),
  /** The point as BTS publishes it now (its text may have changed since the order). */
  point: btsPointSchema,
  region: regionSchema,
  /** BTS hid the point since: shown with the reason, never offered as the default. */
  hidden: z.boolean(),
  lastUsedAt: z.string().datetime(),
});
export type SavedPointDto = z.infer<typeof savedPointSchema>;
export const savedPointErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });

/**
 * What checkout shows before the shopper confirms: the cart's Quote with the delivery tariff of
 * the region they picked (a BTS point's region, ADR 0001), and what the screen needs to ask.
 */
export const checkoutSchema = z.object({
  quote: quoteSchema,
  /** Units that will be ordered: sold-out lines stay in the cart and are not counted. */
  itemCount: z.number().int().nonnegative(),
  /** The region whose tariff the quote used; null when none was given (saved city or default tariff). */
  region: regionSchema.nullable(),
  /** The saved delivery city: the point picker opens on it. */
  deliveryCity: deliveryCitySchema.nullable(),
  /** The account phone (ADR 0004); null means the registration step has to run first. */
  phone: z.string().nullable(),
  /** The default Recipient name: the customer's Telegram name. */
  recipientName: z.string(),
  /** Data-processing consent is asked on the first order only (TZ §3.6). */
  needsConsent: z.boolean(),
  /** The greeting card's length limit (setting `orders.giftMessageMaxLength`). */
  giftMessageMax: z.number().int().positive(),
  /** Countries a Recipient phone may be from, digits without `+` (setting `orders.recipientPhoneCountryCodes`). */
  recipientPhoneCountryCodes: z.array(z.string()),
  /** «Купить сейчас»: the one line this checkout buys (the cart is not read); null for the cart's checkout. */
  item: buyNowLineSchema.nullable(),
  /** «Мои пункты BTS», the last used first: offered before the point picker. */
  savedPoints: z.array(savedPointSchema),
  /** The pair checkout starts on: the last used whose point BTS still offers; null when none. */
  defaultSavedPointId: z.number().int().nullable(),
  /** A shop card is set; without one checkout is closed: «Оплата временно недоступна» (#28). */
  paymentAvailable: z.boolean(),
});
export type CheckoutDto = z.infer<typeof checkoutSchema>;

export const checkoutQuerySchema = z.object({
  /** The region of the chosen BTS point (or of the typed address): its tariff prices delivery. */
  regionId: z.coerce.number().int().positive().optional(),
  /** «Купить сейчас»: quote this one item instead of the cart. */
  item: buyNowItemParamSchema.optional(),
});

/** A BTS point from our list, or the customer's own text when the point is missing (flagged on the order). */
export const orderDeliveryInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point'), pointId: z.number().int().positive() }),
  z.object({
    kind: z.literal('typed'),
    regionId: z.number().int().positive(),
    text: z.string().trim().min(TYPED_ADDRESS_MIN).max(TYPED_ADDRESS_MAX),
  }),
]);

export const createOrderBodySchema = z.object({
  recipientName: z.string().trim().min(1).max(RECIPIENT_NAME_MAX),
  /**
   * As typed; the server reads it with `normalizeRecipientPhone` against the allowed countries
   * (a setting) and stores E.164, or answers 422 `invalid_recipient_phone`.
   */
  recipientPhone: z.string().trim().min(1).max(RECIPIENT_PHONE_INPUT_MAX),
  delivery: orderDeliveryInputSchema,
  comment: z.string().trim().max(ORDER_COMMENT_MAX).optional(),
  /** «Это подарок»: gift packaging, a greeting card, no receipt in the parcel; free of charge. */
  gift: z.boolean().default(false),
  /** The greeting card text; kept only for a gift. Its limit is a setting, checked by the server. */
  giftMessage: z.string().trim().max(GIFT_MESSAGE_HARD_MAX).optional(),
  /** Data-processing consent; required while `needsConsent`. */
  consent: z.boolean().default(false),
  /** The «Итого» the shopper saw and confirmed: they will transfer exactly this (ADR 0001). */
  confirmedTotal: som,
  /**
   * One per checkout attempt, made by the Mini App and kept until an order comes back: a repeat
   * (a lost 201, a double tap) returns the order this key already made instead of a second one.
   */
  idempotencyKey: z.string().uuid(),
  /**
   * «Купить сейчас»: order this one item (quantity 1) instead of the cart, which is neither read
   * nor changed; the cart's promo code and discount choice do not apply (spec Changes 2026-11-11).
   */
  item: buyNowItemParamSchema.optional(),
});
export type CreateOrderBody = z.input<typeof createOrderBodySchema>;
/** The body after validation: the phone is E.164, defaults are filled. */
export type CreateOrderInput = z.output<typeof createOrderBodySchema>;

/** One line of the order as it was bought: names RU/UZ, volume, price and quantity, frozen. */
export const orderLineSchema = z.object({
  kind: z.enum(LINE_KINDS),
  /** The fragrance's slug for a link back to its card; null for a set. */
  slug: z.string().nullable(),
  name: bilingual,
  /** The original the fragrance is inspired by («по мотивам …»); null for a set. */
  brand: z.string().nullable(),
  ml: z.number().int(),
  photo: z.string().nullable(),
  unitPrice: som,
  regularUnitPrice: som,
  markedDown: z.boolean(),
  qty: z.number().int().positive(),
  lineTotal: som,
  /** A set's five fragrances (ADR 0009); null for a single volume. */
  setComposition: z.array(z.object({ name: z.string(), brand: z.string() })).nullable(),
});
export type OrderLineDto = z.infer<typeof orderLineSchema>;

export const orderPointSchema = z.object({
  code: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  landmark: z.string().nullable(),
  hours: z.string().nullable(),
});

/** An order as its snapshot froze it (ADR 0001): later price or point edits never change it. */
export const orderSchema = z.object({
  number: z.number().int(),
  status: orderStatusSchema,
  createdAt: z.string().datetime(),
  /** The reserve lasts until then without a receipt (setting `orders.reserveTtlSeconds`, ADR 0012). */
  reserveUntil: z.string().datetime(),
  recipient: z.object({ name: z.string(), phone: z.string() }),
  delivery: z.object({
    region: bilingual,
    /** The chosen BTS point; null when the customer typed the address instead. */
    point: orderPointSchema.nullable(),
    /** The typed address (flagged: a manager picks the point); null when a point was chosen. */
    typed: z.string().nullable(),
  }),
  comment: z.string().nullable(),
  gift: z.object({ isGift: z.boolean(), message: z.string().nullable() }),
  lines: z.array(orderLineSchema),
  itemsSubtotal: som,
  /** The one Discount; its line key is the order line's position. */
  discount: discountSchema.nullable(),
  deliveryFee: som,
  thresholdBase: thresholdBaseSchema,
  thresholdBaseAmount: som,
  total: som,
  /** What the customer transfers to the shop card; equals the total in stage 1 (ADR 0012). */
  amountDue: som,
  /** Why and when the order was cancelled; null unless it is «Отменён». */
  cancellation: z
    .object({
      reason: z.enum(CANCEL_REASONS),
      at: z.string().datetime(),
      /** It had been paid: the money goes back as a Refund, the manager gets in touch (ADR 0006). */
      afterPayment: z.boolean(),
    })
    .nullable(),
});
export type OrderDto = z.infer<typeof orderSchema>;

/** A row of the «Заказы» list. */
export const orderSummarySchema = z.object({
  number: z.number().int(),
  status: orderStatusSchema,
  createdAt: z.string().datetime(),
  total: som,
  itemCount: z.number().int().nonnegative(),
  /** Up to three line photos for the row's thumbnails. */
  photos: z.array(z.string()),
  isGift: z.boolean(),
});
export type OrderSummaryDto = z.infer<typeof orderSummarySchema>;

export const ordersQuerySchema = z.object({
  /** The cursor: orders numbered below this one (the previous page's `next`). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(ORDERS_PAGE_MAX).default(ORDERS_PAGE_DEFAULT),
});
export const ordersPageSchema = z.object({
  orders: z.array(orderSummarySchema),
  /** Pass as `before` for the next page; null on the last one. */
  next: z.number().int().nullable(),
});
export type OrdersPageDto = z.infer<typeof ordersPageSchema>;

export const orderErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });

/**
 * «Повторить заказ»: what became of each of the order's lines, in its order. `added` is what went
 * into the cart now (0: skipped, not available or no longer sold; below `ordered`: capped at what
 * is available or at the per-line ceiling). Prices are today's: the cart re-quotes them.
 */
export const repeatResultSchema = z.object({
  lines: z.array(
    z.object({
      kind: z.enum(LINE_KINDS),
      name: bilingual,
      /** The original («по мотивам …»); null for a set. */
      brand: z.string().nullable(),
      ml: z.number().int(),
      ordered: z.number().int().positive(),
      added: z.number().int().nonnegative(),
    }),
  ),
  /** Lines that went into the cart, at least one unit each: «2 из 3 товаров добавлены». */
  added: z.number().int().nonnegative(),
  /** The order's lines. */
  of: z.number().int().positive(),
});
export type RepeatResultDto = z.infer<typeof repeatResultSchema>;
export const repeatOrderResponseSchema = z.object({
  result: repeatResultSchema,
  /** The cart after, freshly quoted. */
  cart: cartSchema,
});
export const phoneRequiredSchema = z.object({ code: z.literal('phone_required') });
/**
 * 409: the total changed since the shopper saw it, or nothing is left to order (the new checkout
 * comes along); or the database gave up twice on a deadlock or serialization failure.
 */
export const checkoutConflictSchema = z.union([
  z.object({ code: z.enum(CHECKOUT_CONFLICTS), checkout: checkoutSchema }),
  z.object({ code: z.literal('try_again') }),
]);
export type CheckoutConflict = z.infer<typeof checkoutConflictSchema>;
export const orderInputErrorSchema = z.object({ code: z.enum(ORDER_INPUT_ERRORS) });

/** «Отменить заказ»: the status the shopper saw, so a second press (or a stale screen) is caught. */
export const cancelOrderBodySchema = z.object({ expectedStatus: orderStatusSchema });
/**
 * 409: the order is no longer in the status the shopper saw (cancelled already, a receipt went in,
 * the reserve expired); the order as it is now comes along. Or the database gave up twice.
 */
export const orderStatusConflictSchema = z.union([
  z.object({ code: z.literal('status_changed'), order: orderSchema }),
  z.object({ code: z.literal('try_again') }),
]);
/** 403: this order cannot be cancelled by the shopper from that status (ADR 0011). */
export const cancelRefusedSchema = z.object({ code: z.enum(['not_allowed', 'forbidden']) });
