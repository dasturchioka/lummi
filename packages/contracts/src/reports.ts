import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { languageSchema } from './auth';

/*
 * Sales reports (TZ §7 «Отчёты», ticket #42): computed live from order snapshots and Refunds,
 * over Fulfilled orders only. The rules (which day an order counts on, what net is, how a
 * discount is shared over lines, how sets count) are in docs/spec.md → Changes 2026-11-14.
 */

/** The most days one report covers: a year, leap day included. */
export const SALES_REPORT_MAX_DAYS = 366;
/** Without a range the report covers the last 30 Tashkent days, today included. */
export const SALES_REPORT_DEFAULT_DAYS = 30;

/** First and last Tashkent day, both inclusive; either missing takes the default range. */
export const salesReportQuerySchema = z.object({
  from: tashkentDaySchema.optional(),
  to: tashkentDaySchema.optional(),
});
export type SalesReportQuery = z.input<typeof salesReportQuerySchema>;

/** The Excel export takes the same range and the language of its headers. */
export const salesReportExportQuerySchema = salesReportQuerySchema.extend({
  lang: languageSchema.default('ru'),
});

const count = z.number().int().nonnegative();
const som = z.number().int().nonnegative();

/** One day's figures, or the whole range's; integer so'm. */
export const salesFiguresSchema = z.object({
  /** Fulfilled orders that reached «Доставлен» on the day. */
  orders: count,
  /** Their items before the discount, no delivery (the snapshot's items subtotal). */
  itemsBeforeDiscount: som,
  /** Their one discount each, summed. */
  discount: som,
  /** Their delivery fees: shown, never part of net. */
  delivery: som,
  /**
   * Refunds of orders that are Fulfilled, on the day they were sent (`refunded_on`), or on the
   * order's delivery day when the money went back before it.
   */
  refunds: som,
  /** Items − discount − refunds; below zero on a day whose refunds pass its sales. */
  net: z.number().int(),
  /**
   * (Items − discount) ÷ orders, the TZ's «Чистые продажи / выданные заказы» before refunds, to
   * the nearest so'm (halves up); null on a day without orders.
   */
  averageCheck: som.nullable(),
});
export type SalesFigures = z.infer<typeof salesFiguresSchema>;

export const salesDaySchema = salesFiguresSchema.extend({ day: tashkentDaySchema });
export type SalesDay = z.infer<typeof salesDaySchema>;

const name = z.object({ ru: z.string(), uz: z.string() });

/** A fragrance's bottles sold (volume lines only; sets are their own rows). */
export const fragranceSalesSchema = z.object({
  fragranceId: z.number().int(),
  /** As the latest order in the range named it (the snapshot). */
  name,
  brand: z.string().nullable(),
  units: count,
  /** Line totals less each line's share of its order's discount; refunds are not split over lines. */
  net: z.number().int(),
});
export type FragranceSales = z.infer<typeof fragranceSalesSchema>;

/** One Volume (a fragrance's bottle size) sold. */
export const volumeSalesSchema = fragranceSalesSchema.extend({
  volumeId: z.number().int(),
  ml: z.number().int(),
});
export type VolumeSales = z.infer<typeof volumeSalesSchema>;

/** A set counts per set: one unit per set bought, never split into its five fragrances. */
export const SET_SALES_KINDS = ['discovery_set', 'builder_set'] as const;
export const setSalesSchema = z.object({
  kind: z.enum(SET_SALES_KINDS),
  units: count,
  net: z.number().int(),
});
export type SetSales = z.infer<typeof setSalesSchema>;

export const salesReportSchema = z.object({
  from: tashkentDaySchema,
  to: tashkentDaySchema,
  /** Every day of the range, oldest first, days without sales included. */
  days: z.array(salesDaySchema),
  /** The whole range (its average check over the range's orders). */
  totals: salesFiguresSchema,
  /** Most units first, then most net. Every fragrance sold in the range. */
  fragrances: z.array(fragranceSalesSchema),
  /** Most units first, then most net. Every Volume sold in the range. */
  volumes: z.array(volumeSalesSchema),
  /** The Discovery set, then the builder set, zeros included. */
  sets: z.array(setSalesSchema),
});
export type SalesReport = z.infer<typeof salesReportSchema>;

export const salesReportErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'invalid_range']),
});

export const SALES_REPORT_EXPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
