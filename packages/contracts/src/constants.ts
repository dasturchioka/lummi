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
