import { z } from 'zod';
import { tashkentDaySchema } from './admin';

/**
 * Reviews (#41): a customer's rating (1-5) of a delivered order, with an optional comment and up
 * to `reviews.maxPhotos` photos. Private until staff publish it (customer text can carry banned
 * words); a published review shows on every fragrance and set of its order.
 */

export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
export const reviewRatingSchema = z.number().int().min(1).max(5);

/** What the Mini App's reviews block reads for a target: a fragrance slug, `discovery-set` or `builder-set`. */
export const REVIEW_SET_TARGETS = ['discovery-set', 'builder-set'] as const;

/** One published review as a customer sees it: the first name only, never a phone or an order. */
export const publicReviewSchema = z.object({
  id: z.number().int(),
  rating: reviewRatingSchema,
  comment: z.string().nullable(),
  firstName: z.string(),
  /** ISO time it was published. */
  publishedAt: z.string().datetime(),
  /** Public photo keys: the image is `<api>/reviews/photos/<key>.jpg`. */
  photos: z.array(z.string().uuid()),
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

/** The card block: the average and count of every published review, and the latest few. */
export const reviewsBlockSchema = z.object({
  /** One decimal; null while there are none. */
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
  items: z.array(publicReviewSchema),
});
export type ReviewsBlock = z.infer<typeof reviewsBlockSchema>;

export const reviewsErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });

export const ADMIN_REVIEWS_PAGE_SIZE = 20;

/**
 * The admin list's state filter: published, not published, or `waiting`, those the admin Home
 * counts as waiting for a decision (#48): finished by the customer, never published or hidden,
 * within `reviews.homeQueueDays` of being finished.
 */
export const REVIEW_PUBLISHED_FILTERS = ['published', 'hidden', 'waiting'] as const;

/** `GET /admin/reviews` and its Excel export: newest first, every filter optional, dates are Tashkent days. */
export const adminReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_REVIEWS_PAGE_SIZE),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  /** One order's review (the link from the order page). */
  order: z.coerce.number().int().positive().optional(),
  state: z.enum(REVIEW_PUBLISHED_FILTERS).optional(),
  from: tashkentDaySchema.optional(),
  to: tashkentDaySchema.optional(),
});
export type AdminReviewsQuery = z.input<typeof adminReviewsQuerySchema>;

export const adminReviewSchema = z.object({
  id: z.number().int(),
  orderNumber: z.number().int(),
  customerName: z.string(),
  phone: z.string().nullable(),
  rating: reviewRatingSchema,
  comment: z.string().nullable(),
  /** The fragrance and set names of the order (Russian), where the review will show once published. */
  items: z.array(z.string()),
  /** Photo ids, served to staff at `/admin/reviews/photos/<id>`, published or not. */
  photoIds: z.array(z.number().int()),
  /** Still being written in the bot (comment or photos open, or a photo being fetched): it cannot be published yet. */
  finished: z.boolean(),
  published: z.boolean(),
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});
export type AdminReviewDto = z.infer<typeof adminReviewSchema>;

export const adminReviewsPageSchema = z.object({
  items: z.array(adminReviewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Over every review the filters match, not only this page; null when none. */
  average: z.number().nullable(),
  publishedCount: z.number().int(),
});
export type AdminReviewsPageDto = z.infer<typeof adminReviewsPageSchema>;

export const setReviewPublishedBodySchema = z.object({ published: z.boolean() });

export const adminReviewsErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found', 'not_finished']),
});

export const REVIEWS_EXPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
