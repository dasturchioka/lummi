import { z } from 'zod';
import { SEARCH_QUERY_MAX } from './constants';

/** A text that exists in both languages; the client picks by the customer's language. */
export const bilingualSchema = z.object({ ru: z.string(), uz: z.string() });
export type Bilingual = z.infer<typeof bilingualSchema>;

export const FRAGRANCE_TYPES = ['homme', 'femme', 'unisex'] as const;
export const SILLAGES = ['medium', 'noticeable', 'strong'] as const;
export const SEASONS = ['spring_summer', 'autumn_winter', 'all_year', 'spring_autumn'] as const;
export const TIMES_OF_DAY = ['day', 'evening', 'day_evening', 'everyday'] as const;
export const NOTE_LEVELS = ['top', 'heart', 'base'] as const;

export const volumeCardSchema = z.object({
  ml: z.union([z.literal(10), z.literal(30), z.literal(50)]),
  /** Regular price, integer so'm. */
  price: z.number().int(),
  /** The markdown while it is active (server-evaluated at request time), else null. */
  salePrice: z.number().int().nullable(),
  /** Percent off the regular price, rounded; null without a markdown. */
  salePercent: z.number().int().nullable(),
  saleEndsAt: z.string().datetime().nullable(),
  /** The price to pay: the sale price while a markdown is active, otherwise the regular one. */
  effectivePrice: z.number().int(),
  /** On hand minus reserve. 0 means the volume is sold out. */
  available: z.number().int(),
  /** Content hash of the photo set; URLs are `<media>/<hash>-<400|800|1200>.webp`. */
  photo: z.string().nullable(),
});
export type VolumeCard = z.infer<typeof volumeCardSchema>;

export const fragranceCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  type: z.enum(FRAGRANCE_TYPES),
  family: bilingualSchema.nullable(),
  season: z.enum(SEASONS),
  timeOfDay: z.enum(TIMES_OF_DAY),
  sillage: z.enum(SILLAGES),
  longevity: bilingualSchema,
  description: bilingualSchema,
  whenToWear: bilingualSchema,
  keyNotes: z.object({ ru: z.array(z.string()), uz: z.array(z.string()) }),
  notes: z.object({
    top: z.array(bilingualSchema),
    heart: z.array(bilingualSchema),
    base: z.array(bilingualSchema),
  }),
  uzumUrl: z.string().nullable(),
  isHit: z.boolean(),
  isNew: z.boolean(),
  /** Always in 10 / 30 / 50 order; a volume that does not exist is simply absent. */
  volumes: z.array(volumeCardSchema),
});
export type FragranceCard = z.infer<typeof fragranceCardSchema>;

export const catalogErrorSchema = z.object({ code: z.literal('not_found') });

/**
 * One fragrance as a list card shows it (search results now, the catalog list next): the lockup
 * fields, the three key notes and the price to start from. Customer-safe only: no code, no remark.
 */
export const fragranceListItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  type: z.enum(FRAGRANCE_TYPES),
  family: bilingualSchema.nullable(),
  keyNotes: z.object({ ru: z.array(z.string()), uz: z.array(z.string()) }),
  isHit: z.boolean(),
  isNew: z.boolean(),
  /** The lowest price to pay over the volumes (a markdown counts while active); null without volumes. */
  fromPrice: z.number().int().nullable(),
  /** Every volume is out of stock. */
  soldOut: z.boolean(),
  /** Content hash of the smallest volume's photo set (`<media>/<hash>-<width>.webp`). */
  photo: z.string().nullable(),
});
export type FragranceListItem = z.infer<typeof fragranceListItemSchema>;

export const searchQuerySchema = z.object({ q: z.string().max(SEARCH_QUERY_MAX) });
export const searchResultSchema = z.object({
  items: z.array(fragranceListItemSchema),
  /**
   * The text is shorter than `search.minQueryLength` once reduced to its skeleton (`'a` is one
   * letter): the client shows its hint, not «nothing found». The minimum is a setting, so the
   * server says it.
   */
  tooShort: z.boolean(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
