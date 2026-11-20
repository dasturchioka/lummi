import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { languageSchema } from './auth';
import { CONSUMABLE_UNITS, MAX_OIL_PRICE, STOCK_MOVE_KINDS } from './constants';

/*
 * The warehouse (#76, ADR 0041, ADR 0043): each fragrance's oil balance in grams and its ready
 * concentrate in ml. Oil receipts add to the oil, a mixing turns oil and ethanol into concentrate,
 * bottles are filled from the concentrate when they ship, and every change is a stock move in the
 * history. The API computes every figure; the panel shows them.
 */

/** The low-stock warning's levels: the stock page's own (`STOCK_LEVELS`), none left, running low, fine. */
export const OIL_LEVELS = ['zero', 'low', 'ok'] as const;

/** The most oil one receipt may hold: a tonne. */
export const MAX_OIL_RECEIPT_GRAMS = 1_000_000;
export const STOCK_REASON_MAX = 200;
export const OIL_TEXT_MAX = 120;
/** The newest history lines the fragrance's page shows; the Excel export holds them all. */
export const WAREHOUSE_HISTORY_LIMIT = 200;

const som = z.number().int();
/** Why a count or a receipt changed: required, said in a few words. */
export const stockReasonSchema = z.string().trim().min(1).max(STOCK_REASON_MAX);
/** True when `v` has at most `places` decimals (to a float's noise): the one rule every amount uses. */
export const hasAtMostDecimals = (places: number) => (v: number) => {
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
    .max(MAX_OIL_RECEIPT_GRAMS)
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
  /**
   * A draft from the purchase plan (#78): the planned grams at the fragrance's oil price, holding
   * no oil until the owner confirms it as the invoice reads. Its supplier and invoice may be empty.
   */
  draft: z.boolean(),
  voided: z.boolean(),
  voidReason: z.string().nullable(),
  createdAt: z.string(),
});
export type OilReceipt = z.infer<typeof oilReceiptSchema>;

/** «Buy this» on the purchase plan (#78): a draft receipt per fragrance, the plan's grams. */
export const oilReceiptDraftsBodySchema = z.object({
  lines: z
    .array(
      z.object({
        fragranceId: z.number().int().positive(),
        grams: z
          .number()
          .positive()
          .max(MAX_OIL_RECEIPT_GRAMS)
          .refine(hasAtMostDecimals(3), 'at most 3 decimals'),
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (ls) => new Set(ls.map((l) => l.fragranceId)).size === ls.length,
      'one line per fragrance',
    ),
});
export type OilReceiptDraftsBody = z.infer<typeof oilReceiptDraftsBodySchema>;
export const oilReceiptDraftsResultSchema = z.object({ created: z.number().int() });
export const oilReceiptDiscardedSchema = z.object({ discarded: z.literal(true) });

/** Microlitres in a millilitre: the ready concentrate is kept in whole µl (ADR 0043). */
export const UL_PER_ML = 1000;
/** Ml as the API and the panel speak it, from whole µl, and back (rounded to the µl). */
export const mlFromUl = (ul: number) => ul / UL_PER_ML;
export const ulFromMl = (ml: number) => Math.round(ml * UL_PER_ML);
/** Grams and ml go out to three decimals: a milligram, a microlitre. */
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The most concentrate one mixing may make: a thousand litres. */
export const MAX_MIX_ML = 1_000_000;
/** The most a concentrate count may hold, ml: the stock page's, the form's and the import's. */
export const MAX_CONCENTRATE_ML = 100_000_000;
/** A concentrate count, ml to the microlitre (ADR 0043): the stock page, the form and the import. */
export const concentrateMlSchema = z
  .number()
  .min(0)
  .max(MAX_CONCENTRATE_ML)
  .refine(hasAtMostDecimals(3), 'at most 3 decimals');
/** The most boxes of a Discovery set one assembly may pack. */
export const MAX_ASSEMBLY_QUANTITY = 10_000;

/** Ml to the microlitre, positive. */
const mlAmount = (max: number) =>
  z.number().positive().max(max).refine(hasAtMostDecimals(3), 'at most 3 decimals');

/**
 * A mixing (ADR 0043): the ml of ready concentrate made. The oil and the ethanol in it come off
 * their stocks by the cost model's shares, without the filling loss.
 */
export const mixingBodySchema = z.object({ ml: mlAmount(MAX_MIX_ML) });
export type MixingBody = z.infer<typeof mixingBodySchema>;

export const mixingResultSchema = z.object({
  /** The oil it took. */
  oilGrams: z.number(),
  /** The ethanol it took, whole ml. */
  ethanolMl: z.number().int(),
  /** The oil balance after it. */
  oilLeftGrams: z.number(),
  /** The ready concentrate after it. */
  concentrateMl: z.number(),
});
export type MixingResult = z.infer<typeof mixingResultSchema>;

/**
 * A set assembly (ADR 0043): boxes of a Discovery set packed from its five fragrances' ready
 * concentrate, one fill of the set's vial ml from each per box, and a flacon per vial.
 */
export const setAssemblyBodySchema = z.object({
  quantity: z.number().int().min(1).max(MAX_ASSEMBLY_QUANTITY),
});
export type SetAssemblyBody = z.infer<typeof setAssemblyBodySchema>;

export const setAssemblyResultSchema = z.object({
  /** The concentrate it took from each of the five, the filling loss included. */
  concentrateMl: z.number(),
  /** The flacons it took in all. */
  flacons: z.number().int(),
  /** The set's boxes on hand after it. */
  onHand: z.number().int(),
});
export type SetAssemblyResult = z.infer<typeof setAssemblyResultSchema>;

/** A count of a fragrance's ready concentrate (stock page): compare-and-set, with a reason. */
export const concentrateCountBodySchema = z.object({
  ml: concentrateMlSchema,
  /** The ml the editor was looking at: when the stored count moved, 409 `changed` with it. */
  expectedMl: z.number().min(0).optional(),
  reason: stockReasonSchema,
});
export type ConcentrateCountBody = z.infer<typeof concentrateCountBodySchema>;

/** What the bottles of one sold volume can still take of the free concentrate. */
export const volumeBottlesSchema = z.object({
  ml: z.number().int(),
  /** Whole bottles the free concentrate fills. */
  available: z.number().int(),
});

/**
 * A fragrance's stock as the stock page and its warehouse page show it (ADR 0043): the ready
 * concentrate, what orders hold of it and what is free, the bottles that makes per sold volume,
 * and the oil, all in ml (the oil in grams too).
 */
export const fragranceStockSchema = z.object({
  fragranceId: z.number().int(),
  concentrateMl: z.number(),
  /** Held by orders not yet handed to BTS: their bottles' fills. */
  reservedMl: z.number(),
  /** Concentrate less the reserve, never below zero. */
  availableMl: z.number(),
  /** The count is below the reserve (allowed, flagged). */
  belowReserve: z.boolean(),
  /** From `stock.lowConcentrateMl`: none (can't fill a 10 ml bottle), running low, or fine. */
  level: z.enum(OIL_LEVELS),
  /** Per sold volume of the fragrance (10 / 30 / 50 ml). */
  bottles: z.array(volumeBottlesSchema),
  /** The oil balance. */
  oilGrams: z.number(),
  /** The same oil in ml, by the oil density setting. */
  oilMl: z.number(),
  /** From `stock.lowOilMl`. */
  oilLevel: z.enum(OIL_LEVELS),
  /**
   * Stock at cost, whole so'm, for the owner only (null for a manager): the oil at the average
   * landed price of its receipts, the concentrate at the cost model's liquid per ml (null without
   * an oil price).
   */
  value: z.object({ oil: som, concentrate: som.nullable(), total: som.nullable() }).nullable(),
  /** Draft receipts waiting for the owner's confirmation (#78); 0 for a manager. */
  drafts: z.number().int(),
});
export type FragranceStock = z.infer<typeof fragranceStockSchema>;

/** A consumable as a history line names it, with its signed change. */
const consumableChangeSchema = z.object({
  consumableId: z.number().int(),
  nameRu: z.string(),
  nameUz: z.string(),
  unit: z.enum(CONSUMABLE_UNITS),
  change: z.number().int(),
});

/** One line of the warehouse history. Changes are signed. */
export const stockMoveSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  kind: z.enum(STOCK_MOVE_KINDS),
  /** The fragrance it moved; null for a consumable's own receipt or count. */
  fragranceId: z.number().int().nullable(),
  fragranceName: z.string().nullable(),
  oilGrams: z.number(),
  /** The ready concentrate's change. */
  concentrateMl: z.number(),
  /** Bottles filled, handed over or returned (before ADR 0043: bottles on hand), by ml. */
  bottles: z.array(z.object({ ml: z.number().int(), change: z.number().int() })),
  consumables: z.array(consumableChangeSchema),
  /**
   * What the move could not take because the count held less (a handover, an Uzum sale, an
   * assembly never stop for it): the count stopped at zero and wants a recount.
   */
  short: z
    .object({
      concentrateMl: z.number().optional(),
      consumables: z.array(consumableChangeSchema).optional(),
    })
    .nullable(),
  reason: z.string().nullable(),
  /** Who did it: a staff member's name, or null for the shop itself. */
  actorName: z.string().nullable(),
  /** The receipt's invoice and supplier, for its three kinds. */
  invoice: z.string().nullable(),
  supplier: z.string().nullable(),
  /** The order, for `sale` and `returned`. */
  orderNumber: z.number().int().nullable(),
  /** Uzum's order number, for `uzum_sale` and `uzum_sale_voided` (#80). */
  uzumOrder: z.string().nullable(),
  /** A set bottling's or assembly's set (its vial ml) and boxes; null for every other move. */
  set: z.object({ vialMl: z.number().int(), quantity: z.number().int() }).nullable(),
  /**
   * Where a `correction` came from: the stock page, the fragrance form, the Excel import, or the
   * migration that folded the bottles into concentrate (ADR 0043).
   */
  source: z.enum(['stock', 'form', 'import', 'migration']).nullable(),
  /** A consumable receipt's note. */
  note: z.string().nullable(),
});
export type StockMove = z.infer<typeof stockMoveSchema>;

/** The fragrance's warehouse page. */
export const warehouseFragranceSchema = z.object({
  fragranceId: z.number().int(),
  name: z.string(),
  hidden: z.boolean(),
  stock: fragranceStockSchema,
  /** The settings `stock.lowConcentrateMl` and `stock.lowOilMl`. */
  lowConcentrateMl: z.number(),
  lowOilMl: z.number(),
  /** What one ml of concentrate takes now (no filling loss), for the mixing form's preview. */
  perMl: z.object({ oilGrams: z.number(), ethanolMl: z.number() }),
  /** One bottle's fill now (the filling loss included), per volume the fragrance has. */
  fills: z.array(z.object({ ml: z.number().int(), fillMl: z.number() })),
  /** The active ethanol consumable mixing takes from; null when there is none. */
  ethanol: z.object({ id: z.number().int(), onHandMl: z.number().int() }).nullable(),
  /** The receipts, newest first: the owner's only (null for a manager), voided ones included. */
  oilReceipts: z.array(oilReceiptSchema).nullable(),
  /** The receipt form's starting values (owner only): the discount and import settings, the fragrance's supplier and oil price. */
  oilReceiptDefaults: z
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
    /** A mixing needs more ethanol than the ethanol consumable holds (none active: 0). */
    'ethanol_short',
    /** A set assembly needs more of a fragrance's free concentrate than there is. */
    'concentrate_short',
    /** A count compared against one that moved meanwhile: nothing written. */
    'changed',
    'voided',
    /** A draft is confirmed or discarded, never corrected or voided. */
    'draft',
    /** Only a draft is confirmed or discarded. */
    'not_draft',
    'try_again',
  ]),
  /** With `invalid`: the paths to fix. */
  fields: z.array(z.string()).optional(),
  /** With `oil_short`: what the operation needs, what the balance holds, and the shortfall, in grams. */
  neededGrams: z.number().optional(),
  /** With `concentrate_short`: the fragrance whose concentrate is short. */
  fragrance: z.string().optional(),
  balanceGrams: z.number().optional(),
  shortGrams: z.number().optional(),
  /** With `ethanol_short` and `concentrate_short`: what it needs, what there is, the shortfall, in ml. */
  neededMl: z.number().optional(),
  balanceMl: z.number().optional(),
  shortMl: z.number().optional(),
  /** With `changed`: the count as it is now, ml. */
  currentMl: z.number().optional(),
});
export type WarehouseError = z.infer<typeof warehouseErrorSchema>;

export const warehouseExportQuerySchema = z.object({ lang: languageSchema.default('ru') });
