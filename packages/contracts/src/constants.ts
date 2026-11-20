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
/** The volumes the shop sells (5 ml is stocked but never sold alone: `NOT_SOLD_ALONE_ML`). */
export const VOLUMES_ML = [10, 30, 50] as const;
/**
 * The oil grade a fragrance is bought at, as the supplier's invoice names it (ADR 0040): admin
 * only, shown as «TOP», «PREMIUM», «PREMIUM NEW».
 */
export const FRAGRANCE_TIERS = ['top', 'premium', 'premium_new'] as const;
export type FragranceTier = (typeof FRAGRANCE_TIERS)[number];
/** The highest oil price a fragrance may carry, so'm per gram (about $80 a gram). */
export const MAX_OIL_PRICE = 1_000_000;

/**
 * What changed the warehouse, one row of its history (ADR 0041, 0043): an oil receipt
 * (`oil_receipt`), its correction or void, a bottling (before ADR 0043; old rows only), a mixing of
 * ready concentrate, a Discovery set assembly, bottles filled at BTS handover (`sale`) or coming
 * back (`returned`: a parcel back, a return to stock), a manual count (`correction`), a sale on Uzum
 * Market (`uzum_sale`, #80) or its void (`uzum_sale_voided`), and a consumable received or counted.
 */
export const STOCK_MOVE_KINDS = [
  'oil_receipt',
  'oil_receipt_corrected',
  'oil_receipt_voided',
  'bottling',
  'sale',
  'returned',
  'correction',
  'uzum_sale',
  'uzum_sale_voided',
  'mixing',
  'set_assembly',
  'consumable_received',
  'consumable_corrected',
] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

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

/** Every kind of set holds exactly this many different fragrances (ADR 0009). */
export const SET_SIZE = 5;
/** The ml of a builder set's vials and of the first Discovery set, «Discovery Set 5×10 мл» (ADR 0009). */
export const SET_VIAL_ML = 10;
/**
 * The Discovery sets by the ml of their vials (ADR 0042): «Discovery Set 5×10 мл» and «Discovery
 * Set 5×5 мл». Each is its own product with its own price, photo, composition and stock.
 */
export const DISCOVERY_VIAL_MLS = [10, 5] as const;
export type DiscoveryVialMl = (typeof DISCOVERY_VIAL_MLS)[number];

/**
 * What tells the two Discovery sets apart, in one place for every caller (ADR 0042); their texts
 * are the i18n `sets.discovery[vialMl]`, keyed the same way.
 */
export interface DiscoverySetFacts {
  vialMl: DiscoveryVialMl;
  /**
   * Its key: the stock page's row, the audit target, the photo slot. The 5 × 10 ml set keeps the
   * one it had before the 5 × 5 ml set came (#79).
   */
  key: 'discovery' | 'discovery-5';
  /** Its Mini App screen. */
  route: '/sets/discovery' | '/sets/discovery-5';
  /** Its «Купить сейчас» item text (`@lummi/contracts/buy-now`). */
  buyNow: 'discovery_set' | 'discovery_set:5';
  /** The heart, the share link and the reviews block: the 5 × 10 ml set's only, for now. */
  extras: boolean;
}
export const DISCOVERY_SETS: Readonly<Record<DiscoveryVialMl, DiscoverySetFacts>> = {
  10: {
    vialMl: 10,
    key: 'discovery',
    route: '/sets/discovery',
    buyNow: 'discovery_set',
    extras: true,
  },
  5: {
    vialMl: 5,
    key: 'discovery-5',
    route: '/sets/discovery-5',
    buyNow: 'discovery_set:5',
    extras: false,
  },
};

/** A stored vial ml as the Discovery set it names; the DB allows no other, so anything else throws. */
export function asDiscoveryVialMl(ml: number | null): DiscoveryVialMl {
  const found = DISCOVERY_VIAL_MLS.find((v) => v === ml);
  if (found === undefined) throw new Error(`no Discovery set of ${ml} ml vials`);
  return found;
}
/**
 * The 5 ml bottle (ADR 0042): costed and filled from the ready concentrate, but never sold on its
 * own; it goes into the 5 × 5 ml set and is the gift sample of a first order.
 */
export const NOT_SOLD_ALONE_ML = 5;
/** Every bottle size a fragrance is filled in: the sold ones and the 5 ml. */
export const STOCK_VOLUMES_ML = [NOT_SOLD_ALONE_ML, ...VOLUMES_ML] as const;

/** A consumable's unit (ADR 0043): pieces, or ml for a liquid such as the ethanol. */
export const CONSUMABLE_UNITS = ['pcs', 'ml'] as const;
export type ConsumableUnit = (typeof CONSUMABLE_UNITS)[number];
/**
 * What a consumable is used for (ADR 0043): a flacon or a box of one ml, taken by each bottle filled;
 * the ethanol, taken by a mixing; or `other`, used by nothing (counted by hand).
 */
export const CONSUMABLE_USES = ['flacon', 'box', 'ethanol', 'other'] as const;
export type ConsumableUse = (typeof CONSUMABLE_USES)[number];
/** The ml a flacon may hold, and a box (a 5 ml bottle has none, ADR 0040). */
export const FLACON_MLS = [5, 10, 30, 50] as const;
export const BOX_MLS = [10, 30, 50] as const;

/**
 * What opens an Upgrade right (ADR 0003): a delivered set, or a delivered single bottle of
 * `SINGLE_RIGHT_ML`. The DB enum and the Discount's `source` are built from it.
 */
export const UPGRADE_RIGHT_SOURCES = ['set', 'single_10ml'] as const;
/** The bottle a `single_10ml` right opens from (GLOSSARY: the 10 ml bottle is not Full size). */
export const SINGLE_RIGHT_ML = 10;

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

/** Side lengths (px) of the square WebP renditions of a profile photo (#67); the API renders them, the Mini App and the panel pick by them. */
export const PROFILE_PHOTO_SIZES = [96, 192, 384] as const;
