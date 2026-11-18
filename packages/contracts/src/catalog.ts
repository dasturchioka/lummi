import { z } from 'zod';
import {
  CATALOG_PAGE_MAX,
  CATALOG_PAGE_SIZE,
  CATALOG_SORTS,
  FRAGRANCE_TYPES,
  MAX_PRICE,
  SEARCH_QUERY_MAX,
  SEASONS,
  SILLAGES,
  TIMES_OF_DAY,
  VOLUMES_ML,
} from './constants';
import { upgradeRightSourceSchema } from './quote';

/** A text that exists in both languages; the client picks by the customer's language. */
export const bilingualSchema = z.object({ ru: z.string(), uz: z.string() });
export type Bilingual = z.infer<typeof bilingualSchema>;

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

/**
 * A Step-up (GLOSSARY, #57, #60): from a volume that can be bought, the next larger one that can
 * be bought too, with what the customer saves by taking it («30 ml olsangiz, 58 000 soʻm
 * tejaysiz»): the bigger volume at the chosen volume's price per ml, less its own price, in whole
 * thousands of so'm rounded down. Always above 0.
 */
export const stepUpSchema = z.object({
  fromMl: volumeCardSchema.shape.ml,
  toMl: volumeCardSchema.shape.ml,
  saving: z.number().int().positive(),
});
export type StepUp = z.infer<typeof stepUpSchema>;

/** One full-size volume as the customer's upgrade right prices it (ADR 0003, 0007). */
export const upgradeRightPriceSchema = z.object({
  /** A volume `pricing.fullSizeVolumesMl` calls full size. */
  ml: volumeCardSchema.shape.ml,
  /** The price to pay for one bottle with the right: the volume's price less the right's discount. */
  price: z.number().int().nonnegative(),
  source: upgradeRightSourceSchema,
  percent: z.number().int(),
  /** The right's last day, Tashkent `YYYY-MM-DD` (it works through 23:59:59). */
  lastDay: z.string(),
});
export type UpgradeRightPrice = z.infer<typeof upgradeRightPriceSchema>;

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
  /**
   * The full-size volumes an upgrade right the customer holds would discount (TZ §3.4: «цена со
   * скидкой + Скидка за набор»), each with the price to pay with it, computed by the server's
   * `quote()` (one bottle, rounded down; never a marked-down volume unless the setting allows it,
   * ADR 0008). Empty without a covering right.
   */
  upgradeRightPrices: z.array(upgradeRightPriceSchema),
  /** The volumes a right discounts (setting `pricing.fullSizeVolumesMl`), for «на один флакон 30 или 50 мл». */
  fullSizeMl: z.array(z.number().int()),
  /**
   * The step-ups worth offering under the volume tiles, smallest `fromMl` first, computed by the
   * server (`stepUps`, settings `catalog.stepUp.*`); none onto or from a volume the customer's
   * upgrade right prices (`upgradeRightPrices`). Empty while switched off.
   */
  stepUps: z.array(stepUpSchema),
  /** Setting `catalog.showStockCount`: the status line under the tiles shows the real available count («В наличии: 12 шт.»). */
  showStockCount: z.boolean(),
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
  /** The lowest price to pay over the volumes in stock (a markdown counts while active); null when nothing is in stock. */
  fromPrice: z.number().int().nullable(),
  /** The volume `fromPrice` belongs to (the one from-volume rule); null with it. The list price reads «69 000 сум · 10 мл». */
  fromMl: z.number().int().nullable(),
  /** The from-volume's regular price, set only while that volume is marked down (struck through on the card). */
  fromRegularPrice: z.number().int().nullable(),
  /** Every volume is out of stock. */
  soldOut: z.boolean(),
  /** Content hash of the 50 ml volume's photo set (else the largest volume that has one) (`<media>/<hash>-<width>.webp`). */
  photo: z.string().nullable(),
  /**
   * Every volume in 10 / 30 / 50 order, as the card's tiles show them: the list card's «+» adds
   * the one that is available, or asks which when several are (spec Changes 2026-11-11).
   */
  volumes: z.array(volumeCardSchema),
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

/** The same ceiling the other so'm schemas use. */

const volumeFilter = z.coerce
  .number()
  .pipe(z.union([z.literal(VOLUMES_ML[0]), z.literal(VOLUMES_ML[1]), z.literal(VOLUMES_ML[2])]));

/**
 * The catalog list (spec Changes 2026-11-10): every filter is optional and they combine with AND.
 * `volume` keeps fragrances that have that volume in stock and judges `priceMin`/`priceMax` and the
 * price sorts by that volume; without it the price is the lowest available effective price.
 */
export const catalogQuerySchema = z.object({
  type: z.enum(FRAGRANCE_TYPES).optional(),
  family: z.coerce.number().int().positive().optional(),
  volume: volumeFilter.optional(),
  priceMin: z.coerce.number().int().min(0).max(MAX_PRICE).optional(),
  priceMax: z.coerce.number().int().min(0).max(MAX_PRICE).optional(),
  season: z.enum(SEASONS).optional(),
  /** Only the owner-flagged new fragrances («Новинки»). */
  isNew: z.enum(['1']).optional(),
  sort: z.enum(CATALOG_SORTS).default('top'),
  limit: z.coerce.number().int().min(1).max(CATALOG_PAGE_MAX).default(CATALOG_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
/** What a caller may send (defaults optional) and what the service receives (defaults applied). */
export type CatalogQuery = z.input<typeof catalogQuerySchema>;
export type CatalogParams = z.output<typeof catalogQuerySchema>;

export const catalogResultSchema = z.object({
  items: z.array(fragranceListItemSchema),
  /** Every fragrance the filters keep, not just this page: «Найдено: N». */
  total: z.number().int(),
  /** What the filter sheets offer; the whole visible catalog, whatever is filtered now. */
  facets: z.object({
    families: z.array(z.object({ id: z.number().int(), name: bilingualSchema })),
    /** Lowest and highest from-price over the visible catalog, so'm; null when nothing is priced. */
    price: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
  }),
});
export type CatalogResult = z.infer<typeof catalogResultSchema>;

export const similarResultSchema = z.object({ items: z.array(fragranceListItemSchema) });
export type SimilarResult = z.infer<typeof similarResultSchema>;
