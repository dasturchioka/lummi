/**
 * Constants the Mini App needs at runtime. This file and the modules it re-exports have no
 * other imports, so importing it does not pull zod or the rest of the contracts into the Mini App
 * bundle (ADR 0030). The DB schema reads the order statuses from here too.
 */
export * from './order-status';
export * from './order-machine';
export * from './recipient';
export * from './promo-code';
export * from './receipt-upload';
export * from './receipt-review';
export * from './birth-date';
export * from './tashkent';
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
 * `startapp` parameter -> Mini App route: the one list of targets. The Mini App routes with it,
 * the admin banner editor validates against it, and later tickets (broadcasts, set links) add
 * their targets here. An unknown or missing value lands on Home; an unknown fragrance slug lands
 * on the card's own not-found state, which leads on to the catalog.
 */
export const STATIC_START_TARGETS = {
  home: '/',
  catalog: '/catalog',
  cart: '/cart',
  orders: '/orders',
  profile: '/profile',
  set_discovery: '/sets/discovery',
  builder: '/sets/builder',
} as const;

/** `p_<slug>` opens that fragrance's card (slugs are ASCII kebab case, ADR 0016). */
export const FRAGRANCE_START_PARAM = /^p_([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Where a campaign link is placed (ticket #35); `blogger` and `other` carry a label; `promo_code` is the automatic link of a promo code, labelled by it. */
export const CAMPAIGN_SOURCES = [
  'instagram',
  'telegram_channel',
  'store_qr',
  'blogger',
  'promo_code',
  'other',
] as const;
export type CampaignSource = (typeof CAMPAIGN_SOURCES)[number];
/**
 * `l_<code>` is a tracked campaign link (ticket #35, ADR 0022): a key into the owner's list, not
 * a screen. The Mini App asks the API to log the open and resolve it to one of the targets above;
 * an unknown code lands on Home. A code is `A-Z a-z 0-9 _ -` (what `startapp` allows), at most 40
 * characters, so `l_<code>` stays far inside Telegram's 64.
 */
const CAMPAIGN_CODE_CHARS = '[A-Za-z0-9_-]{3,40}';
export const CAMPAIGN_CODE_PATTERN = new RegExp(`^${CAMPAIGN_CODE_CHARS}$`);
export const CAMPAIGN_START_PARAM = new RegExp(`^l_(${CAMPAIGN_CODE_CHARS})$`);

/** The `startapp` value of a campaign link. */
export const campaignStartParam = (code: string): string => `l_${code}`;

/** The campaign code of a launch parameter, or null when it is any other kind of target. */
export const campaignCodeOf = (param: string | null | undefined): string | null =>
  (param && CAMPAIGN_START_PARAM.exec(param)?.[1]) || null;

/** The fixed targets in order, for the pickers: the banner editor and the broadcast composer. */
export type StartTarget = keyof typeof STATIC_START_TARGETS;
export const START_TARGETS = Object.keys(STATIC_START_TARGETS) as StartTarget[];

/**
 * A value an owner may link to (a banner, a broadcast button, a campaign link's target): a fixed
 * target or a fragrance. A campaign link is not one: it resolves to one of these, never to another
 * link, and a banner opens its target in-app with no round trip to log an open.
 */
export const isStartTarget = (v: string): boolean =>
  Object.hasOwn(STATIC_START_TARGETS, v) || FRAGRANCE_START_PARAM.test(v);

/** The info pages (ticket #21): fixed slugs in display order. The owner edits them; nobody adds one. */
export const INFO_PAGE_SLUGS = [
  'about',
  'delivery-payment',
  'returns',
  'faq',
  'contacts',
  'offer',
] as const;
export type InfoPageSlug = (typeof INFO_PAGE_SLUGS)[number];

/** The target that stands for the Discovery set in `PUT/DELETE /favourites/:target` (#45). */
export const DISCOVERY_FAVOURITE = 'discovery-set';
