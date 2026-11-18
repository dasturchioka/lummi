import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { MAX_PRICE } from './constants';
import { orderCostSnapshotSchema } from './cost';
import { stockReasonSchema } from './warehouse';

/*
 * Uzum sales (#80): what the shop sold on Uzum Market, recorded by the owner or a manager by hand
 * or from an Excel file. A sale takes its bottles off on hand at once (the parcel left our shelf),
 * freezes its profit on the Uzum channel (the commission, no mailer, no delivery) and can be
 * voided with a reason (the bottles come back). Rules: docs/spec.md → Changes 2026-11-19 (#80).
 */

export const UZUM_ORDER_MAX = 60;
export const UZUM_SALE_LINES_MAX = 50;
export const UZUM_SALE_QTY_MAX = 1_000;
/** The sales one page of the list shows, newest first. */
export const UZUM_SALES_PAGE_SIZE = 50;

const qty = z.number().int().min(1).max(UZUM_SALE_QTY_MAX);
/** What the Uzum buyer paid for one unit, whole so'm, before Uzum's commission. */
const price = z.number().int().min(1).max(MAX_PRICE);
const percent = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'at most 2 decimals');

/** A line of a sale: a fragrance's volume, or the Discovery set. */
export const uzumSaleLineInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('volume'), volumeId: z.number().int().positive(), qty, price }),
  z.object({ kind: z.literal('discovery_set'), qty, price }),
]);
export type UzumSaleLineInput = z.infer<typeof uzumSaleLineInputSchema>;

export const uzumSaleInputSchema = z.object({
  /** The day of the sale, a Tashkent date: the reports count it on this day. */
  soldOn: tashkentDaySchema,
  /** Uzum's order number; one standing sale per number. */
  uzumOrder: z.string().trim().min(1).max(UZUM_ORDER_MAX),
  /** Uzum's commission on this sale; left out, the setting `cost.order.uzumCommissionPercent`. */
  commissionPercent: percent.optional(),
  lines: z.array(uzumSaleLineInputSchema).min(1).max(UZUM_SALE_LINES_MAX),
});
export type UzumSaleInput = z.infer<typeof uzumSaleInputSchema>;

export const uzumSaleVoidSchema = z.object({ reason: stockReasonSchema });

export const UZUM_SALE_SOURCES = ['form', 'import'] as const;

export const uzumSaleSchema = z.object({
  id: z.number().int(),
  soldOn: tashkentDaySchema,
  uzumOrder: z.string(),
  commissionPercent: z.number(),
  lines: z.array(
    z.object({
      kind: z.enum(['volume', 'discovery_set']),
      volumeId: z.number().int().nullable(),
      fragranceId: z.number().int().nullable(),
      /** The fragrance's name when the sale was recorded; null for the Discovery set. */
      name: z.string().nullable(),
      ml: z.number().int(),
      qty: z.number().int(),
      price: z.number().int(),
      lineTotal: z.number().int(),
      /** Frozen at recording; the owner's only (null for a manager), null without an oil price. */
      unitCost: z.number().int().nullable(),
    }),
  ),
  /** Bottles and sets. */
  units: z.number().int(),
  /** What the buyers paid: the lines' totals, before the commission. */
  revenue: z.number().int(),
  /**
   * Its profit on the Uzum channel, frozen when it was recorded: the owner's only (null for a
   * manager). `profit` inside is null when a fragrance had no oil price, named in `missing`.
   */
  costs: orderCostSnapshotSchema.nullable(),
  source: z.enum(UZUM_SALE_SOURCES),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  voided: z.boolean(),
  voidReason: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidedByName: z.string().nullable(),
});
export type UzumSale = z.infer<typeof uzumSaleSchema>;

export const uzumSalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** What the form can sell: every volume and the Discovery set, with what is available now. */
export const uzumSaleItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('volume'),
    volumeId: z.number().int(),
    fragranceId: z.number().int(),
    name: z.string(),
    ml: z.number().int(),
    available: z.number().int(),
    hidden: z.boolean(),
  }),
  z.object({ kind: z.literal('discovery_set'), available: z.number().int() }),
]);
export type UzumSaleItem = z.infer<typeof uzumSaleItemSchema>;

export const uzumSalesPageSchema = z.object({
  sales: z.array(uzumSaleSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** The setting `cost.order.uzumCommissionPercent`: the form's starting commission. */
  commissionPercent: z.number(),
  items: z.array(uzumSaleItemSchema),
});
export type UzumSalesPage = z.infer<typeof uzumSalesPageSchema>;

/** A line the stock can't cover: what the sale wants of it and what is available. */
export const uzumShortLineSchema = z.object({
  kind: z.enum(['volume', 'discovery_set']),
  volumeId: z.number().int().nullable(),
  name: z.string().nullable(),
  ml: z.number().int().nullable(),
  wanted: z.number().int(),
  available: z.number().int(),
});
export type UzumShortLine = z.infer<typeof uzumShortLineSchema>;

export const uzumErrorSchema = z.object({
  code: z.enum([
    'unauthorized',
    'forbidden',
    'not_found',
    'invalid',
    /** On hand less what open orders reserve can't cover a line: nothing is written. */
    'stock_short',
    /** A standing sale already has this Uzum order number. */
    'duplicate_order',
    'voided',
    'try_again',
  ]),
  /** With `invalid`: the paths to fix. */
  fields: z.array(z.string()).optional(),
  /** With `stock_short`. */
  short: z.array(uzumShortLineSchema).optional(),
});
export type UzumError = z.infer<typeof uzumErrorSchema>;

// ---- the Excel import (outside the ts-rest contract: raw xlsx bodies) ----

/** The template's sheets: the sales, and the names and volumes to pick from. */
export const UZUM_SHEETS = { sales: 'Продажи Uzum', items: 'Ароматы' } as const;

export const UZUM_IMPORT_ISSUE_CODES = [
  'not_xlsx',
  'too_big',
  'too_unpacked',
  'too_many_rows',
  'missing_sheet',
  'missing_column',
  'formula_cell',
  'error_cell',
  'required',
  'too_long',
  'bad_date',
  'future_date',
  'bad_number',
  'bad_percent',
  'unknown_item',
  'bad_ml',
  /** Rows of one Uzum order disagree on its date or commission. */
  'mixed_order',
  'too_many_lines',
  /** A standing sale has this order number: its rows are skipped (a warning). */
  'already_recorded',
  'stock_short',
] as const;
export type UzumImportIssueCode = (typeof UZUM_IMPORT_ISSUE_CODES)[number];

/** A problem in the file. `row` is the Excel row, `column` the header as the template writes it. */
export interface UzumImportIssue {
  row: number | null;
  column: string | null;
  code: UzumImportIssueCode;
  params?: Record<string, string | number>;
}

/** One sale the file holds: its rows grouped by the Uzum order number. */
export interface UzumImportSale {
  uzumOrder: string;
  soldOn: string;
  commissionPercent: number;
  /** The Excel rows it came from. */
  rows: number[];
  units: number;
  revenue: number;
}

export interface UzumImportReport {
  /** Cut at `UZUM_IMPORT_SALE_CAP`; `saleTotal`, `units`, `revenue` are over all of them. */
  sales: UzumImportSale[];
  saleTotal: number;
  units: number;
  revenue: number;
  /** Orders the file holds that are already recorded: skipped. */
  skipped: number;
  errors: UzumImportIssue[];
  errorTotal: number;
  warnings: UzumImportIssue[];
  warningTotal: number;
  /** Present only when there are no errors and something to record; «Записать» sends it back with the same file. */
  token: string | null;
}

export interface UzumImportApplied {
  recorded: number;
  units: number;
  revenue: number;
  skipped: number;
}

export const UZUM_IMPORT_SALE_CAP = 500;
export const UZUM_IMPORT_ISSUE_CAP = 200;
