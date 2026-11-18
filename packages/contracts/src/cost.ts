import { z } from 'zod';
import { SET_SIZE } from './constants';

/**
 * The cost model (ADR 0040). The API computes; the admin only shows. Every amount is whole so'm,
 * each figure rounded on its own, so the parts may differ from `total` by a so'm or two.
 */
const som = z.number().int();

/** The cost of one bottle or one set, as the customer's calculator breaks it down. */
export const unitCostSchema = z.object({
  /** The oil in the liquid, filling loss included. */
  oil: som,
  /** Ethanol and fixative, filling loss included. */
  ethanol: som,
  bottle: som,
  label: som,
  spray: som,
  /** The filling work. */
  filling: som,
  box: som,
  /** The QR card. */
  insert: som,
  /** Everything above, before the defect percent. */
  base: som,
  /** The defect («брак и бой») percent of the base. */
  defect: som,
  total: som,
});
export type UnitCost = z.infer<typeof unitCostSchema>;

/** One volume of a fragrance on the admin catalog page: its cost against its price. */
export const volumeCostSchema = z.object({
  ml: z.number().int(),
  price: som,
  /** A markdown price while it is active, else null. */
  markdownPrice: som.nullable(),
  /** Null while the fragrance has no oil price. */
  cost: unitCostSchema.nullable(),
  /** Price less the cost total, before any order costs (delivery, ads, tax). */
  profit: som.nullable(),
  /** Profit as a share of the price (0.62 = 62 %). */
  margin: z.number().nullable(),
  markdownProfit: som.nullable(),
  markdownMargin: z.number().nullable(),
});
export type VolumeCost = z.infer<typeof volumeCostSchema>;

export const fragranceCostsSchema = z.object({
  /** So'm per gram on the supplier's invoice, before the discount; null: unknown. */
  oilPrice: som.nullable(),
  /** So'm per gram after the supplier discount and the delivery to Termez. */
  landedOilPrice: som.nullable(),
  volumes: z.array(volumeCostSchema),
});
export type FragranceCosts = z.infer<typeof fragranceCostsSchema>;

/*
 * Order profit (#77, the calculator's `orderCosts`): an order's costs besides its goods, frozen
 * into the order when its payment is confirmed, and the same arithmetic on the owner's
 * «Рентабельность» page. Rules: docs/spec.md → Changes 2026-11-18 (#77).
 */

/** Where a sale happens: the Mini App (mailer, BTS, online payment) or Uzum Market (its commission). */
export const SALES_CHANNELS = ['miniapp', 'uzum'] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

const amount = z.number().int().nonnegative();
const percentValue = z.number().nonnegative();

/**
 * A sale's profit (#77): its revenue, its goods at unit cost, its Order costs part by part (GLOSSARY:
 * what it costs besides the goods), the whole cost and the profit, each whole so'm.
 */
export const orderProfitSchema = z.object({
  channel: z.enum(SALES_CHANNELS),
  /** What the items brought in: items less the discount; delivery is not in it. */
  revenue: amount,
  /** Every line at its unit cost × quantity, a Promo gift's line included. */
  goods: amount,
  /** The BTS mailer bag (Mini App only). */
  mailer: amount,
  /** What BTS charges the shop for the parcel (Mini App only). */
  btsCharge: amount,
  /** What the customer paid for delivery: 0 from the free-delivery threshold, and on Uzum. */
  deliveryPaid: amount,
  /** The online-payment % (Mini App) or the Uzum commission % (Uzum), as set then. */
  commissionPercent: percentValue,
  commission: amount,
  adPerSale: amount,
  taxPercent: percentValue,
  tax: amount,
  /** A gift sample's cost when one went in, else 0. */
  giftSample: amount,
  /**
   * Everything the sale costs the shop: goods + mailer + (BTS charge − delivery paid) + commission
   * + ad + tax + gift sample (the unrounded sum rounded, so the parts may differ by a so'm).
   */
  cost: som,
  /** revenue − cost. */
  profit: som,
  /** profit ÷ revenue (0.42 = 42 %); null without revenue. */
  margin: z.number().nullable(),
});
export type OrderProfit = z.infer<typeof orderProfitSchema>;

/**
 * The cost snapshot an order keeps (`orders.costs`): frozen when its payment is confirmed, so a
 * later oil price or setting never rewrites its profit. `profit` is null when a line had no unit
 * cost then: `missing` names the fragrances without an oil price (ADR 0040); empty, a line had
 * nothing to cost (no fragrance).
 */
export const orderCostSnapshotSchema = z.object({
  /** When the costs were frozen (ISO). */
  at: z.string(),
  profit: orderProfitSchema.nullable(),
  missing: z.array(z.string()),
});
export type OrderCostSnapshot = z.infer<typeof orderCostSnapshotSchema>;

/** The order page's profit block (owner only). */
export const adminOrderCostsSchema = z.object({
  /** Null until the payment is confirmed, and for an order paid before costs were recorded. */
  snapshot: orderCostSnapshotSchema.nullable(),
  /** Each line's frozen unit cost, in the order of the page's lines; null where it is unknown. */
  lines: z.array(
    z.object({
      position: z.number().int().nonnegative(),
      unitCost: amount.nullable(),
      /** unit cost × quantity. */
      cost: amount.nullable(),
    }),
  ),
});
export type AdminOrderCostsDto = z.infer<typeof adminOrderCostsSchema>;

/** A query toggle: `1` on, `0` (the default) off. */
const toggle = z
  .enum(['0', '1'])
  .default('0')
  .transform((v) => v === '1');

/** The «Рентабельность» table's view: channel and the two toggles of the calculator. */
export const profitabilityQuerySchema = z.object({
  channel: z.enum(SALES_CHANNELS).default('miniapp'),
  /** «Скидка после набора»: the set's upgrade right on each Full size bottle it may discount. */
  afterSetDiscount: toggle,
  /** «С пробником в подарок»: one gift sample in every sale. */
  giftSample: toggle,
});
export type ProfitabilityQuery = z.input<typeof profitabilityQuerySchema>;

export const profitabilityExportQuerySchema = profitabilityQuerySchema.extend({
  lang: z.enum(['ru', 'uz']).default('ru'),
});

/** The order simulator's most lines and most units on a line. */
export const PROFITABILITY_MAX_LINES = 30;
export const PROFITABILITY_MAX_QTY = 99;

/** The table's volume filter: every row, one bottle size, or the set. */
export const PROFITABILITY_VOLUMES = ['all', '10', '30', '50', 'set'] as const;
export type ProfitabilityVolume = (typeof PROFITABILITY_VOLUMES)[number];

/** A filter's figures: how many rows, their average profit, and the rows marked. */
export const profitabilitySummarySchema = z.object({
  volume: z.enum(PROFITABILITY_VOLUMES),
  rows: z.number().int().nonnegative(),
  /** Over the rows with a profit, to the nearest so'm (halves up); null without any. */
  averageProfit: som.nullable(),
  loss: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  noOil: z.number().int().nonnegative(),
});
export type ProfitabilitySummary = z.infer<typeof profitabilitySummarySchema>;

/** How a row reads against the margin floor: a loss, under the floor, or fine. */
export const PROFIT_FLAGS = ['loss', 'low'] as const;
export type ProfitFlag = (typeof PROFIT_FLAGS)[number];

/** One sale on the table: one bottle of a fragrance's volume, or one Discovery set. */
export const profitabilityRowSchema = z.object({
  kind: z.enum(['volume', 'discovery_set']),
  /** Null for the set. */
  fragranceId: z.number().int().nullable(),
  /** The fragrance's name; for the set, empty (the page names it). */
  name: z.string(),
  brand: z.string().nullable(),
  ml: z.number().int(),
  /** The fragrance is hidden from the shop. */
  hidden: z.boolean(),
  /** The price the customer pays before the after-set discount: an active markdown (Mini App) or the regular price. */
  price: amount,
  markedDown: z.boolean(),
  /** The after-set discount on this sale; 0 when none applies. */
  discount: amount,
  /** Null without an oil price (or a set without its five fragrances). */
  unitCost: amount.nullable(),
  /** The sale's costs besides the goods (mailer, delivery, commission, ad, tax, gift sample). */
  orderCosts: som.nullable(),
  profit: som.nullable(),
  margin: z.number().nullable(),
  flag: z.enum(PROFIT_FLAGS).nullable(),
});
export type ProfitabilityRow = z.infer<typeof profitabilityRowSchema>;

export const profitabilityTableSchema = z.object({
  channel: z.enum(SALES_CHANNELS),
  afterSetDiscount: z.boolean(),
  giftSample: z.boolean(),
  /** The set's upgrade-right percent the after-set discount takes. */
  afterSetDiscountPercent: z.number().int(),
  /** The margin floor: a row under it is flagged `low`. */
  lowMarginPercent: z.number(),
  /** One gift sample's cost; null when no fragrance has an oil price. */
  giftSampleCost: amount.nullable(),
  /** Every fragrance's volumes, by name then ml, then the Discovery set. */
  rows: z.array(profitabilityRowSchema),
  /** One per volume filter, in `PROFITABILITY_VOLUMES` order. */
  summaries: z.array(profitabilitySummarySchema),
  /** The set's vials: how many and their ml, for its label. */
  set: z.object({ size: z.literal(SET_SIZE), vialMl: z.number().int() }),
});
export type ProfitabilityTable = z.infer<typeof profitabilityTableSchema>;

/** What a calculator or order-simulator line sells. */
export const profitabilityItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('volume'),
    fragranceId: z.number().int().positive(),
    ml: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('discovery_set') }),
]);
export type ProfitabilityItem = z.infer<typeof profitabilityItemSchema>;

/** The calculator (one line) and the order simulator (several). */
export const profitabilityQuoteBodySchema = z.object({
  channel: z.enum(SALES_CHANNELS),
  afterSetDiscount: z.boolean(),
  giftSample: z.boolean(),
  lines: z
    .array(
      z.object({
        item: profitabilityItemSchema,
        qty: z.number().int().min(1).max(PROFITABILITY_MAX_QTY),
      }),
    )
    .min(1)
    .max(PROFITABILITY_MAX_LINES),
});
export type ProfitabilityQuoteBody = z.infer<typeof profitabilityQuoteBodySchema>;

export const profitabilityQuoteSchema = z.object({
  lines: z.array(
    z.object({
      item: profitabilityItemSchema,
      name: z.string(),
      brand: z.string().nullable(),
      ml: z.number().int(),
      qty: z.number().int(),
      unitPrice: amount,
      regularUnitPrice: amount,
      markedDown: z.boolean(),
      lineTotal: amount,
      /** The unit cost part by part; null without an oil price. */
      unitCost: unitCostSchema.nullable(),
    }),
  ),
  itemsSubtotal: amount,
  /** The after-set discount taken (one Full size bottle, as the shop prices it); 0 when none. */
  discount: amount,
  afterSetDiscountPercent: z.number().int(),
  /** What the customer pays for delivery (Mini App), from the default tariff and the threshold. */
  deliveryFee: amount,
  freeDeliveryThreshold: amount,
  /** So'm more of items for free delivery; 0 once free (Mini App). */
  amountToFreeDelivery: amount,
  /** Null when a line has no unit cost; `missing` names the fragrances without an oil price. */
  profit: orderProfitSchema.nullable(),
  missing: z.array(z.string()),
});
export type ProfitabilityQuote = z.infer<typeof profitabilityQuoteSchema>;

export const profitabilityErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid']),
});
