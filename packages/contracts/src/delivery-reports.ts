import { z } from 'zod';
import { tashkentDaySchema } from './admin';

/**
 * Staff views of what the bot could not deliver (#55, TZ §5 L341 and §3.8 L195): the review
 * requests («не доставлено» when the customer had blocked the bot) and the birthday coupons
 * (their message's `outbox_id` is null when the customer could not be messaged). Read-only.
 */

export const ADMIN_REVIEW_REQUESTS_PAGE_SIZE = 20;

/**
 * A review request's state: `sent` (asked, no review yet), `answered` (the customer rated), or
 * `not_delivered` (the customer had blocked the bot; nothing was sent, and never later).
 */
export const REVIEW_REQUEST_STATES = ['not_delivered', 'sent', 'answered'] as const;
export type ReviewRequestState = (typeof REVIEW_REQUEST_STATES)[number];

/** `GET /admin/reviews/requests`: newest request first; the days are Tashkent days of the request. */
export const adminReviewRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_REVIEW_REQUESTS_PAGE_SIZE),
  state: z.enum(REVIEW_REQUEST_STATES).optional(),
  from: tashkentDaySchema.optional(),
  to: tashkentDaySchema.optional(),
});
export type AdminReviewRequestsQuery = z.input<typeof adminReviewRequestsQuerySchema>;

export const adminReviewRequestSchema = z.object({
  orderNumber: z.number().int(),
  customerName: z.string(),
  phone: z.string().nullable(),
  state: z.enum(REVIEW_REQUEST_STATES),
  requestedAt: z.string().datetime(),
  /** The rating, once answered. */
  rating: z.number().int().nullable(),
});
export type AdminReviewRequestDto = z.infer<typeof adminReviewRequestSchema>;

export const adminReviewRequestsPageSchema = z.object({
  items: z.array(adminReviewRequestSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Over the days filter only (not the state filter), so the tabs read the whole picture. */
  counts: z.object({
    not_delivered: z.number().int(),
    sent: z.number().int(),
    answered: z.number().int(),
  }),
});
export type AdminReviewRequestsPageDto = z.infer<typeof adminReviewRequestsPageSchema>;

export const BIRTHDAY_DELIVERY_FILTERS = ['delivered', 'not_delivered'] as const;
export const BIRTHDAY_USED_FILTERS = ['used', 'unused'] as const;
export const ADMIN_BIRTHDAY_PAGE_SIZE = 25;

/** `GET /admin/birthday-coupons`: newest issue first; `year` is the birthday year the coupon celebrates. */
export const adminBirthdayCouponsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_BIRTHDAY_PAGE_SIZE),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  delivery: z.enum(BIRTHDAY_DELIVERY_FILTERS).optional(),
  used: z.enum(BIRTHDAY_USED_FILTERS).optional(),
});
export type AdminBirthdayCouponsQuery = z.input<typeof adminBirthdayCouponsQuerySchema>;

export const adminBirthdayCouponSchema = z.object({
  id: z.number().int(),
  customerId: z.number().int(),
  customerName: z.string(),
  phone: z.string().nullable(),
  birthdayYear: z.number().int(),
  percent: z.number().int(),
  /** The most it takes off, so'm. */
  maxAmount: z.number().int(),
  issuedAt: z.string().datetime(),
  /** False when the customer could not be messaged: «не доставлено» (the coupon stays in the profile). */
  delivered: z.boolean(),
  /** The order that holds it; null while none does. */
  usedOrderNumber: z.number().int().nullable(),
  expiresAt: z.string().datetime(),
  /** Derived like the customer sees it: used, expired (no order took it) or active. */
  state: z.enum(['used', 'expired', 'active']),
});
export type AdminBirthdayCouponDto = z.infer<typeof adminBirthdayCouponSchema>;

export const adminBirthdayCouponsPageSchema = z.object({
  items: z.array(adminBirthdayCouponSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Of every coupon the filters match: how many are «не доставлено». */
  notDelivered: z.number().int(),
  /** Every year that has a coupon, newest first, for the year filter. */
  years: z.array(z.number().int()),
});
export type AdminBirthdayCouponsPageDto = z.infer<typeof adminBirthdayCouponsPageSchema>;

export const deliveryReportsErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden']),
});
