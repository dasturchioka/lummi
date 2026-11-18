import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { languageSchema } from './auth';
import { MAX_OIL_PRICE, STOCK_MOVE_KINDS } from './constants';

/*
 * The raw-material warehouse (#76, ADR 0041): each fragrance's oil balance in grams beside its
 * bottles on hand. Oil receipts add to the balance, a bottling turns oil into bottles, and every
 * change is a stock move in the fragrance's history. The API computes every figure; the panel
 * shows them.
 */

/** The low-oil warning's levels: the stock page's own (`STOCK_LEVELS`), none left, running low, fine. */
export const OIL_LEVELS = ['zero', 'low', 'ok'] as const;

/** The most oil one receipt may hold: a tonne. */
export const MAX_RECEIPT_GRAMS = 1_000_000;
/** The most bottles of one volume one bottling may make. */
export const MAX_BOTTLING_QUANTITY = 10_000;
export const STOCK_REASON_MAX = 200;
export const OIL_TEXT_MAX = 120;
/** The newest history lines the fragrance's page shows; the Excel export holds them all. */
export const WAREHOUSE_HISTORY_LIMIT = 200;

const som = z.number().int();
/** Why a count or a receipt changed: required, said in a few words. */
export const stockReasonSchema = z.string().trim().min(1).max(STOCK_REASON_MAX);
const hasAtMostDecimals = (places: number) => (v: number) => {
  const scaled = v * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

/** An oil receipt as the owner types it from the supplier's invoice. */
export const oilReceiptInputSchema = z.object({
  supplier: z.string().trim().min(1).max(OIL_TEXT_MAX),
  invoice: z.string().trim().min(1).max(OIL_TEXT_MAX),
  receivedOn: tashkentDaySchema,
  /** Grams, to the milligram. */
  grams: z
    .number()
    .positive()
    .max(MAX_RECEIPT_GRAMS)
    .refine(hasAtMostDecimals(3), 'at most 3 decimals'),
  /** So'm per gram before the supplier discount, as the invoice reads. */
  pricePerGram: z.number().int().min(1).max(MAX_OIL_PRICE),
  discountPercent: z.number().min(0).max(100).refine(hasAtMostDecimals(2), 'at most 2 decimals'),
  /** The delivery to Termez, percent of the discounted price. */
  importPercent: z.number().min(0).max(100).refine(hasAtMostDecimals(2), 'at most 2 decimals'),
});
export type OilReceiptInput = z.infer<typeof oilReceiptInputSchema>;

export const oilReceiptCorrectionSchema = oilReceiptInputSchema.extend({
  reason: stockReasonSchema,
});
export type OilReceiptCorrection = z.infer<typeof oilReceiptCorrectionSchema>;

export const oilReceiptVoidSchema = z.object({ reason: stockReasonSchema });

export const oilReceiptSchema = oilReceiptInputSchema.extend({
  id: z.number().int(),
  fragranceId: z.number().int(),
  /** Landed so'm per gram: after the discount, with the delivery to Termez. */
  landedPerGram: som,
  /** What the oil of this receipt cost, landed. */
  total: som,
  voided: z.boolean(),
  voidReason: z.string().nullable(),
  createdAt: z.string(),
});
export type OilReceipt = z.infer<typeof oilReceiptSchema>;

/** A bottling: how many bottles of each volume the oil goes into. */
export const bottlingBodySchema = z.object({
  lines: z
    .array(
      z.object({
        ml: z.number().int().positive(),
        quantity: z.number().int().min(0).max(MAX_BOTTLING_QUANTITY),
      }),
    )
    .min(1)
    .max(8)
    .refine((ls) => new Set(ls.map((l) => l.ml)).size === ls.length, 'one line per volume')
    .refine((ls) => ls.some((l) => l.quantity > 0), 'at least one bottle'),
});
export type BottlingBody = z.infer<typeof bottlingBodySchema>;

export const bottlingResultSchema = z.object({
  id: z.number().int(),
  /** The oil it took, filling loss included. */
  oilGrams: z.number(),
  /** The ethanol it took (costed, not stocked). */
  ethanolMl: z.number().int(),
  /** The oil balance after it. */
  oilLeftGrams: z.number(),
});
export type BottlingResult = z.infer<typeof bottlingResultSchema>;

/** A fragrance's oil, as the stock page and the fragrance's warehouse page show it. */
export const fragranceOilSchema = z.object({
  fragranceId: z.number().int(),
  /** The oil balance. */
  oilGrams: z.number(),
  /** Litres of perfume the oil still makes, the filling loss taken off. */
  liquidLitres: z.number(),
  /** From the `stock.lowOilLitres` setting: none left, running low, or fine. */
  level: z.enum(OIL_LEVELS),
  /**
   * Stock at cost, whole so'm, for the owner only (null for a manager): the oil at the average
   * landed price of its receipts, the bottles at their unit cost (null without an oil price).
   */
  value: z.object({ oil: som, bottles: som.nullable(), total: som.nullable() }).nullable(),
});
export type FragranceOil = z.infer<typeof fragranceOilSchema>;

/** One line of a fragrance's warehouse history. Changes are signed. */
export const stockMoveSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  kind: z.enum(STOCK_MOVE_KINDS),
  oilGrams: z.number(),
  bottles: z.array(z.object({ ml: z.number().int(), change: z.number().int() })),
  reason: z.string().nullable(),
  /** Who did it: a staff member's name, or null for the shop itself. */
  actorName: z.string().nullable(),
  /** The receipt's invoice and supplier, for its three kinds. */
  invoice: z.string().nullable(),
  supplier: z.string().nullable(),
  /** The order, for `sale` and `returned`. */
  orderNumber: z.number().int().nullable(),
  /** Where a `correction` came from: the stock page, the fragrance form or the Excel import. */
  source: z.enum(['stock', 'form', 'import']).nullable(),
});
export type StockMove = z.infer<typeof stockMoveSchema>;

/** The fragrance's warehouse page. */
export const warehouseFragranceSchema = z.object({
  fragranceId: z.number().int(),
  name: z.string(),
  hidden: z.boolean(),
  oil: fragranceOilSchema,
  /** The `stock.lowOilLitres` setting. */
  lowOilLitres: z.number(),
  volumes: z.array(
    z.object({
      volumeId: z.number().int(),
      ml: z.number().int(),
      onHand: z.number().int(),
      reserved: z.number().int(),
      available: z.number().int(),
    }),
  ),
  /** What one bottle of each volume takes now (filling loss included), for the bottling form's preview. */
  perBottle: z.array(
    z.object({ ml: z.number().int(), oilGrams: z.number(), ethanolMl: z.number() }),
  ),
  /** The receipts, newest first: the owner's only (null for a manager), voided ones included. */
  receipts: z.array(oilReceiptSchema).nullable(),
  /** The receipt form's starting values (owner only): the discount and import settings, the fragrance's supplier and oil price. */
  receiptDefaults: z
    .object({
      supplier: z.string().nullable(),
      pricePerGram: z.number().int().nullable(),
      discountPercent: z.number(),
      importPercent: z.number(),
    })
    .nullable(),
  /** Newest first, at most `WAREHOUSE_HISTORY_LIMIT`. */
  history: z.array(stockMoveSchema),
});
export type WarehouseFragrance = z.infer<typeof warehouseFragranceSchema>;

export const warehouseErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid',
    'oil_short',
    'voided',
    'try_again',
  ]),
  /** With `invalid`: the paths to fix. */
  fields: z.array(z.string()).optional(),
  /** With `oil_short`: what the operation needs, what the balance holds, and the shortfall, in grams. */
  neededGrams: z.number().optional(),
  balanceGrams: z.number().optional(),
  shortGrams: z.number().optional(),
});
export type WarehouseError = z.infer<typeof warehouseErrorSchema>;

export const warehouseExportQuerySchema = z.object({ lang: languageSchema.default('ru') });
