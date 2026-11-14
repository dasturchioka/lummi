import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { languageSchema } from './auth';
import { CAMPAIGN_SOURCES, UPGRADE_RIGHT_SOURCES } from './constants';
import { promoCodeTextSchema } from './promo';

/*
 * Reports (TZ §7 «Отчёты», tickets #42, #43): computed live from order snapshots and Refunds,
 * over Fulfilled orders only. The rules (which day an order counts on, what net is, how a
 * discount is shared over lines, how sets count) are in docs/spec.md → Changes 2026-11-14.
 */

/** The most days one report covers: a year, leap day included. */
export const REPORT_MAX_DAYS = 366;
/** Without a range a report covers the last 30 Tashkent days, today included. */
export const REPORT_DEFAULT_DAYS = 30;

/** First and last Tashkent day, both inclusive; either missing takes the default range. */
export const reportQuerySchema = z.object({
  from: tashkentDaySchema.optional(),
  to: tashkentDaySchema.optional(),
});
export type ReportQuery = z.input<typeof reportQuerySchema>;

/** A report's Excel export takes the same query and the language of its headers. */
export const reportExportQuerySchema = reportQuerySchema.extend({
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

export const reportErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'invalid_range']),
});

export const REPORT_EXPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/*
 * Marketing reports (TZ §7 «Промокоды и источники», «Скидка за набор»; ticket #43, ADR 0022):
 * the same orders as the sales report (Fulfilled, on their delivery day) and the same Refunds
 * (on greatest(the day sent, the delivery day)), split by promo code, by the order's campaign
 * link (its Source), by the customer's first link, and by the upgrade right an order used. The
 * rules are in docs/spec.md → Changes 2026-11-14 (#43).
 */

/** What one row of a marketing report sums: the sales figures, less delivery, plus who bought. */
export const marketingFiguresSchema = z.object({
  /** Fulfilled orders of the row that reached «Доставлен» in the range. */
  orders: count,
  /** Distinct customers of those orders. */
  customers: count,
  /**
   * First-time buyers (GLOSSARY): of them, those for whom one of the row's orders is their first
   * Fulfilled order ever. The TZ promo report's «новые покупатели».
   */
  firstTimeBuyers: count,
  itemsBeforeDiscount: som,
  discount: som,
  /** Refunds of the row's Fulfilled orders counted in the range, by the sales report's rule. */
  refunds: som,
  /** Items − discount − refunds. */
  net: z.number().int(),
  /** (Items − discount) ÷ orders, to the nearest so'm (halves up); null without orders. */
  averageCheck: som.nullable(),
});
export type MarketingFigures = z.infer<typeof marketingFiguresSchema>;

/**
 * Orders ÷ opens as a percentage with one decimal (halves up), worked out by the API; null
 * when there is nothing to divide by.
 */
const percent = z.number().nonnegative().nullable();

/** A campaign link as a report names it. */
export const reportLinkSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  source: z.enum(CAMPAIGN_SOURCES),
  sourceLabel: z.string().nullable(),
  /** The promo code the link prefills, as the code reads now. */
  promoCode: z.string().nullable(),
});
export type ReportLink = z.infer<typeof reportLinkSchema>;

/** «Без ссылки» in the Source filter: orders that took no campaign link. */
export const NO_SOURCE = 'none';
/** «Без промокода» in the code filter: orders that took no promo code. */
export const NO_PROMO_CODE = 'none';
/** What the Source filter takes. */
export const SOURCE_FILTERS = [...CAMPAIGN_SOURCES, NO_SOURCE] as const;

/**
 * The marketing reports' filters (TZ §7 «Фильтры: период, источник, код»), besides the range.
 * Both narrow the orders every table counts (and their Refunds). The Source also narrows the
 * opens and the customers acquired to its own links; with `none`, there are none.
 */
export const marketingReportQuerySchema = reportQuerySchema.extend({
  /** A campaign Source, or `none`: the orders that took no campaign link. */
  source: z.enum(SOURCE_FILTERS).optional(),
  /** A promo code, or `none`: the orders that took no code. */
  code: z.union([z.literal(NO_PROMO_CODE), promoCodeTextSchema]).optional(),
});
export type MarketingReportQuery = z.input<typeof marketingReportQuerySchema>;
export type MarketingFilters = Pick<z.output<typeof marketingReportQuerySchema>, 'source' | 'code'>;

export const marketingReportExportQuerySchema = marketingReportQuerySchema.extend({
  lang: languageSchema.default('ru'),
});

/** One promo code (TZ §7 promo report), keyed on the code the order took. */
export const promoCodeReportRowSchema = marketingFiguresSchema.extend({
  promoCodeId: z.number().int(),
  code: z.string(),
  /** The campaign links that prefill it now: its automatic one and any the owner made. */
  links: z.array(reportLinkSchema),
  /** Customers who opened one of its links in the range; null when it has no link. */
  opens: count.nullable(),
  /** Its orders that came through one of its links (the order's campaign link is one of them). */
  linkOrders: count,
  /** Link orders ÷ opens; null without a link or without opens. */
  conversion: percent,
});
export type PromoCodeReportRow = z.infer<typeof promoCodeReportRowSchema>;

/** One link under its Source, by the orders that took it as their campaign link. */
export const sourceLinkRowSchema = marketingFiguresSchema.extend({
  link: reportLinkSchema,
  /** Customers who opened it in the range. */
  opens: count,
  /** Orders ÷ opens. */
  conversion: percent,
});
export type SourceLinkRow = z.infer<typeof sourceLinkRowSchema>;

/** One Source (Instagram, the channel, ...): its links together, a customer counted once. */
export const sourceRowSchema = marketingFiguresSchema.extend({
  source: z.enum(CAMPAIGN_SOURCES),
  opens: count,
  conversion: percent,
  /** Its links with anything in the range, most orders first. */
  links: z.array(sourceLinkRowSchema),
});
export type SourceRow = z.infer<typeof sourceRowSchema>;

/** One link under its Source, by the customers whose first link it is. */
export const acquisitionLinkRowSchema = marketingFiguresSchema.extend({
  link: reportLinkSchema,
  /**
   * Customers it acquired in the range: their first campaign link, first opened in the range,
   * while they were still a New customer (no order that was not cancelled).
   */
  acquired: count,
});
export type AcquisitionLinkRow = z.infer<typeof acquisitionLinkRowSchema>;

export const acquisitionRowSchema = marketingFiguresSchema.extend({
  source: z.enum(CAMPAIGN_SOURCES),
  acquired: count,
  links: z.array(acquisitionLinkRowSchema),
});
export type AcquisitionRow = z.infer<typeof acquisitionRowSchema>;

/** The set discount (TZ §7): Upgrade rights by what opened them. */
export const upgradeRightReportRowSchema = marketingFiguresSchema.extend({
  source: z.enum(UPGRADE_RIGHT_SOURCES),
  /** Rights opened in the range by orders still Fulfilled (a returned set's rights drop out). */
  issued: count,
  // `orders` are the rights used: one right per order, by Fulfilled orders delivered in the range
});
export type UpgradeRightReportRow = z.infer<typeof upgradeRightReportRowSchema>;

export const marketingReportSchema = z.object({
  from: tashkentDaySchema,
  to: tashkentDaySchema,
  /** The filters the figures are narrowed by, as the API read them; null for «Все». */
  filters: z.object({
    source: z.enum(SOURCE_FILTERS).nullable(),
    code: z.string().nullable(),
  }),
  /** Codes with an order, a refund or an open in the range; most orders first. */
  promoCodes: z.array(promoCodeReportRowSchema),
  /**
   * By the order's campaign link (ADR 0022: the last one opened within N days): every Source,
   * or only the one the Source filter names (none for `none`).
   */
  sources: z.array(sourceRowSchema),
  /** Orders that took no campaign link. */
  withoutLink: marketingFiguresSchema,
  /**
   * By the link that acquired the customer: their first campaign link, when they opened it as a
   * New customer. Every Source.
   */
  acquisition: z.array(acquisitionRowSchema),
  /** Orders of customers who had an order (not cancelled) before they first opened a link. */
  earlierCustomers: marketingFiguresSchema,
  /** Orders of customers who never opened a campaign link. */
  withoutFirstLink: marketingFiguresSchema,
  /** The set first, then the single 10 ml bottle. */
  upgradeRights: z.array(upgradeRightReportRowSchema),
});
export type MarketingReport = z.infer<typeof marketingReportSchema>;
