import { z } from 'zod';
import { fragranceListItemSchema } from './catalog';

/**
 * Favourites (#45): a fragrance or the Discovery set a customer keeps with the heart. They live on
 * the server, so a phone and Telegram Desktop agree. The target of PUT/DELETE is a fragrance slug
 * or `discovery-set`.
 */

/** The ids the hearts read: small, so every card can ask once and share the answer. */
export const favouriteIdsSchema = z.object({
  slugs: z.array(z.string()),
  discoverySet: z.boolean(),
});
export type FavouriteIds = z.infer<typeof favouriteIdsSchema>;

/** The «Избранное» page: today's cards, newest saved first, hidden fragrances left out. */
export const favouriteListSchema = z.object({
  items: z.array(fragranceListItemSchema),
  /** Present while the Discovery set is a favourite: today's price and stock. */
  discoverySet: z
    .object({
      price: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
      soldOut: z.boolean(),
      photo: z.string().nullable(),
    })
    .nullable(),
});
export type FavouriteList = z.infer<typeof favouriteListSchema>;

export const favouriteErrorSchema = z.object({ code: z.enum(['unauthorized', 'not_found']) });
