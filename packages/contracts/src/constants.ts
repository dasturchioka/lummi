/**
 * Constants the Mini App needs at runtime. This file and the two modules it re-exports have no
 * other imports, so importing it does not pull zod or the rest of the contracts into the Mini App
 * bundle (ADR 0030). The DB schema reads the order statuses from here too.
 */
export * from './order-status';
export * from './recipient';
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

/** The ceiling of every so'm amount an input may carry (ADR 0016). */
export const MAX_PRICE = 100_000_000;

/**
 * What a cart or order line holds: one volume, the Discovery set, or a builder set (ADR 0009). One
 * list for the cart and the order, so one name per kind everywhere; the DB enums are built from it.
 */
export const LINE_KINDS = ['volume', 'builder_set', 'discovery_set'] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export type SetLineKind = Exclude<LineKind, 'volume'>;

/** Both kinds of set hold exactly this many different fragrances, 10 ml each (ADR 0009). */
export const SET_SIZE = 5;

/**
 * `startapp` parameter -> Mini App route, for the plain navigation links (ADR 0022). `p_<slug>`
 * (a fragrance card) is matched by pattern in the Mini App. An unknown value lands on Home.
 */
export const STARTAPP_ROUTES = {
  home: '/',
  catalog: '/catalog',
  cart: '/cart',
  orders: '/orders',
  profile: '/profile',
  set_discovery: '/sets/discovery',
  builder: '/sets/builder',
} as const satisfies Record<string, string>;
