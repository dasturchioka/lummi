import { z } from 'zod';
import { birthDateSchema } from './birthday';
import { ORDER_STATUSES } from './order-status';
import { fragranceStockSchema } from './warehouse';

/* ---- stock (#27) ---- */

export const STOCK_PAGE_DEFAULT = 20;
export const STOCK_PAGE_MAX = 50;
export const STOCK_LEVELS = ['zero', 'low', 'ok'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

/**
 * A fragrance on the stock page (ADR 0043): its ready concentrate and oil in ml, the bottles each
 * sold volume still makes, its tags (hidden, below the reserve) and the owner's value.
 */
export const stockFragranceRowSchema = fragranceStockSchema.extend({
  name: z.string(),
  hidden: z.boolean(),
});
export type StockFragranceRow = z.infer<typeof stockFragranceRowSchema>;

/** A Discovery set on the stock page: its own boxes (ADR 0009, 0042). */
export const stockSetRowSchema = z.object({
  vialMl: z.number().int(),
  /** `discovery` or `discovery-5` (`DISCOVERY_SETS`): stable, for React keys and test ids. */
  key: z.string(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  /** On hand is below the reserve (ADR 0010): allowed, and shown as a warning. */
  belowReserve: z.boolean(),
  /** From the `stock.lowAvailableThreshold` setting: nothing left, running low, or fine. */
  level: z.enum(STOCK_LEVELS),
});
export type StockSetRow = z.infer<typeof stockSetRowSchema>;

export const stockQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /**
   * `low`: concentrate (or a set's boxes) at or under its threshold, none included; `zero`: none;
   * `oilLow`: fragrances whose oil is running low or gone (the Discovery sets never match).
   */
  filter: z.enum(['low', 'zero', 'oilLow']).optional(),
  /** Fragrances hidden from the catalog; the Discovery sets count as visible. */
  visibility: z.enum(['visible', 'hidden']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(STOCK_PAGE_MAX).default(STOCK_PAGE_DEFAULT),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

/**
 * The gift sample's 5 ml stock (#79, ADR 0042, 0043) while samples are on: the 5 ml fills the chosen
 * fragrance's free concentrate makes, or every visible fragrance's together when the most-stocked
 * one is picked; `level` against the setting `giftSample.lowStock`. `missing`: the chosen fragrance
 * is gone or hidden, so no sample goes out until another is chosen.
 */
export const giftSampleStockSchema = z.object({
  /** The chosen fragrance's name; null when the most-stocked one is picked (or the chosen one is gone). */
  fragrance: z.string().nullable(),
  missing: z.boolean(),
  available: z.number().int(),
  threshold: z.number().int(),
  level: z.enum(STOCK_LEVELS),
});
export type GiftSampleStock = z.infer<typeof giftSampleStockSchema>;

export const stockListSchema = z.object({
  /** The setting `stock.lowAvailableThreshold` (the Discovery sets' boxes). */
  lowThreshold: z.number().int(),
  /** The settings `stock.lowConcentrateMl` and `stock.lowOilMl` (ADR 0043). */
  lowConcentrateMl: z.number(),
  lowOilMl: z.number(),
  /** This page's fragrances in name order. */
  fragrances: z.array(stockFragranceRowSchema),
  /** The Discovery sets: page 1 only, when they match. */
  sets: z.array(stockSetRowSchema),
  /** Fragrances matching the search and filters, over all pages. */
  total: z.number().int(),
  /** The gift sample's 5 ml stock; null while samples are off. */
  giftSample: giftSampleStockSchema.nullable(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type StockList = z.infer<typeof stockListSchema>;

/* ---- customers (#27) ---- */

export const CUSTOMER_SORTS = ['newest', 'spent', 'orders'] as const;
export const CUSTOMERS_PAGE_DEFAULT = 25;
export const CUSTOMERS_PAGE_MAX = 50;

export const customersQuerySchema = z.object({
  /** Name, @username or phone digits. */
  q: z.string().trim().max(100).optional(),
  sort: z.enum(CUSTOMER_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(CUSTOMERS_PAGE_MAX).default(CUSTOMERS_PAGE_DEFAULT),
});
export type CustomersQuery = z.infer<typeof customersQuerySchema>;

export const adminCustomerSchema = z.object({
  id: z.number().int(),
  telegramId: z.number().int(),
  name: z.string(),
  /** Content hash of the customer's profile photo (#67); null = the initial letter. */
  photo: z.string().nullable(),
  username: z.string().nullable(),
  /** The account phone (E.164), from Telegram's shared contact; null until shared. */
  phone: z.string().nullable(),
  language: z.enum(['ru', 'uz']),
  botBlocked: z.boolean(),
  /** `YYYY-MM-DD`, entered once by the customer; staff correct it (TZ §3.8, #30). Null until entered. */
  birthDate: z.string().nullable(),
  /** Every order the customer placed, whatever its status. */
  ordersCount: z.number().int(),
  /** Total of the Fulfilled orders only (GLOSSARY): delivered and not returned. */
  totalSpent: z.number().int(),
  createdAt: z.string(),
});
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;

export const adminCustomersPageSchema = z.object({
  items: z.array(adminCustomerSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminCustomersPage = z.infer<typeof adminCustomersPageSchema>;

export const adminCustomerOrderSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  status: z.enum(ORDER_STATUSES),
  total: z.number().int(),
  createdAt: z.string(),
});

export const adminCustomerDetailSchema = adminCustomerSchema.extend({
  /** All statuses, newest first. */
  orders: z.array(adminCustomerOrderSchema),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;

export const adminStockErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found']),
});

export const adminCustomersErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'invalid_birth_date', 'phone_required']),
});

/** Staff correct a customer's date of birth (TZ §3.8: «только админ может изменить»). */
export const adminSetBirthDateBodySchema = z.object({ birthDate: birthDateSchema });
