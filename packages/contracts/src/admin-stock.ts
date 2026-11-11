import { z } from 'zod';
import { birthDateSchema } from './birthday';
import { ORDER_STATUSES } from './order-status';

/* ---- stock (#27) ---- */

export const STOCK_PAGE_DEFAULT = 20;
export const STOCK_PAGE_MAX = 50;
export const STOCK_LEVELS = ['zero', 'low', 'ok'] as const;
export type StockLevel = (typeof STOCK_LEVELS)[number];

/** One row of the stock page: a volume of a fragrance, or the Discovery set (its own stock, ADR 0009). */
export const stockRowSchema = z.object({
  kind: z.enum(['volume', 'discovery']),
  /** `v<volume id>` or `discovery`: stable across reloads, for React keys and test ids. */
  key: z.string(),
  /** The volume to edit; null for the Discovery set. */
  volumeId: z.number().int().nullable(),
  /** The fragrance the volume belongs to; null for the Discovery set. A page holds whole fragrances. */
  fragranceId: z.number().int().nullable(),
  /** The fragrance's name; null for the Discovery set. */
  name: z.string().nullable(),
  hidden: z.boolean(),
  ml: z.number().int().nullable(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  /** On hand is below the reserve (ADR 0010): allowed, and shown as a warning. */
  belowReserve: z.boolean(),
  /** Decided by the server from the `stock.lowAvailableThreshold` setting: nothing left, running low, or fine. */
  level: z.enum(STOCK_LEVELS),
});
export type StockRow = z.infer<typeof stockRowSchema>;

export const stockQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** `low`: available at or under the threshold (zero included); `zero`: nothing available. */
  filter: z.enum(['low', 'zero']).optional(),
  /** Fragrances hidden from the catalog; the Discovery set counts as visible. */
  visibility: z.enum(['visible', 'hidden']).optional(),
  /** Pages hold whole fragrances (all their matching volumes), so a card is never split. */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(STOCK_PAGE_MAX).default(STOCK_PAGE_DEFAULT),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

export const stockListSchema = z.object({
  /** The setting `stock.lowAvailableThreshold`. */
  lowThreshold: z.number().int(),
  /** This page's rows: the Discovery set first (page 1 only, when it matches), then whole fragrances in name order. */
  rows: z.array(stockRowSchema),
  /** Fragrances matching the search and filters, over all pages. */
  total: z.number().int(),
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
