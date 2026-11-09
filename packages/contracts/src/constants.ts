/**
 * Constants the Mini App needs at runtime. This file has no imports, so importing it does not
 * pull zod or the rest of the contracts into the Mini App bundle (ADR 0030).
 */
export const POINT_SEARCH_MIN = 2;
export const POINT_SEARCH_LIMIT = 50;

/** The longest search text the API reads and the Mini App's field accepts (characters). */
export const SEARCH_QUERY_MAX = 100;

/** The most of one volume a cart line can hold (also the cart bodies' bound). */
export const CART_MAX_QTY = 99;

/**
 * Catalog vocabularies. Zod-free, so the Mini App can import them without pulling the schema
 * runtime (ADR 0030): `@lummi/contracts/constants`.
 */
export const FRAGRANCE_TYPES = ['homme', 'femme', 'unisex'] as const;
export const SILLAGES = ['medium', 'noticeable', 'strong'] as const;
export const SEASONS = ['spring_summer', 'autumn_winter', 'all_year', 'spring_autumn'] as const;
export const TIMES_OF_DAY = ['day', 'evening', 'day_evening', 'everyday'] as const;
export const NOTE_LEVELS = ['top', 'heart', 'base'] as const;
export const VOLUMES_ML = [10, 30, 50] as const;

/** Catalog sorts: top sales (default), new, price low to high, price high to low. */
export const CATALOG_SORTS = ['top', 'new', 'price_asc', 'price_desc'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** How many cards the catalog list loads at a time, and the most one request may ask for. */
export const CATALOG_PAGE_SIZE = 24;
export const CATALOG_PAGE_MAX = 100;
