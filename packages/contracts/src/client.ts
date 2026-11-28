import type { contract } from './contract';

/**
 * The Mini App's view of the API contract, WITHOUT zod at runtime.
 *
 * The server contract (`./contract`) carries zod schemas, which would add ~15 KB gzip to the
 * Mini App's initial JS. The ts-rest client needs only each route's method, path and response
 * statuses at runtime, so this file lists exactly those, and every type (bodies, responses,
 * params) still comes from `typeof contract`. When the server contract changes, a route added,
 * moved or given another status fails typecheck here (`ClientMatchesServer`) and in
 * `client.test.ts`, so there is no second place to keep in sync by hand beyond this table.
 */
function route<M extends string, P extends string, S extends number>(
  method: M,
  path: P,
  statuses: readonly S[],
) {
  const responses = Object.fromEntries(statuses.map((s) => [s, undefined])) as {
    [K in S]: undefined;
  };
  return { method, path, responses };
}

export const clientRoutes = {
  auth: {
    telegram: route('POST', '/auth/telegram', [200, 401]),
    refresh: route('POST', '/auth/refresh', [200, 401]),
  },
  me: {
    get: route('GET', '/me', [200, 401]),
    updatePreferences: route('PATCH', '/me/preferences', [200, 401]),
    shareContact: route('POST', '/me/contact', [200, 400, 401, 403, 409]),
    writeAccess: route('POST', '/me/write-access', [200, 401]),
    getDeliveryCity: route('GET', '/me/delivery-city', [200, 401]),
    setDeliveryCity: route('PUT', '/me/delivery-city', [200, 401, 404, 422]),
    clearDeliveryCity: route('DELETE', '/me/delivery-city', [200, 401]),
    savedPoints: route('GET', '/me/points', [200, 401]),
    removeSavedPoint: route('DELETE', '/me/points/:id', [200, 401, 404]),
    discounts: route('GET', '/me/discounts', [200, 401]),
    setBirthDate: route('PUT', '/me/birth-date', [200, 401, 403, 409, 422]),
  },
  delivery: {
    regions: route('GET', '/delivery/regions', [200, 401]),
    cities: route('GET', '/delivery/regions/:regionId/cities', [200, 401, 404]),
    points: route('GET', '/delivery/points', [200, 401]),
  },
  cart: {
    get: route('GET', '/cart', [200, 401]),
    addLine: route('POST', '/cart/lines', [200, 401, 404, 409]),
    addDiscovery: route('POST', '/cart/sets/discovery', [200, 401, 404, 409]),
    addBuilder: route('POST', '/cart/sets/builder', [200, 401, 404, 409, 422]),
    setQuantity: route('PATCH', '/cart/lines/:lineId', [200, 401, 404]),
    removeLine: route('DELETE', '/cart/lines/:lineId', [200, 401]),
    applyPromoCode: route('PUT', '/cart/promo-code', [200, 401, 429]),
    removePromoCode: route('DELETE', '/cart/promo-code', [200, 401]),
    chooseDiscount: route('PUT', '/cart/discount-choice', [200, 401, 409]),
  },
  sets: {
    list: route('GET', '/sets', [200, 401]),
    discovery: route('GET', '/sets/discovery', [200, 401, 404]),
    builder: route('GET', '/sets/builder', [200, 401]),
  },
  favourites: {
    ids: route('GET', '/favourites', [200, 401]),
    list: route('GET', '/favourites/list', [200, 401]),
    add: route('PUT', '/favourites/:target', [200, 401, 404]),
    remove: route('DELETE', '/favourites/:target', [200, 401]),
  },
  reviews: {
    forTarget: route('GET', '/reviews/:target', [200, 401, 404]),
  },
  content: {
    home: route('GET', '/content/home', [200, 401]),
    pages: route('GET', '/content/pages', [200, 401]),
    page: route('GET', '/content/pages/:slug', [200, 401, 404]),
  },
  campaigns: {
    open: route('POST', '/campaigns/open', [200, 401, 404, 429]),
  },
  checkout: {
    get: route('GET', '/checkout', [200, 401, 404]),
  },
  orders: {
    create: route('POST', '/orders', [201, 401, 403, 409, 422, 503]),
    list: route('GET', '/orders', [200, 401]),
    get: route('GET', '/orders/:number', [200, 401, 404]),
    payment: route('GET', '/orders/:number/payment', [200, 401, 404]),
    cancel: route('POST', '/orders/:number/cancel', [200, 401, 403, 404, 409]),
    repeat: route('POST', '/orders/:number/repeat', [200, 401, 404, 409]),
  },
  catalog: {
    list: route('GET', '/catalog/fragrances', [200, 401]),
    fragrance: route('GET', '/catalog/fragrances/:slug', [200, 401, 404]),
    similar: route('GET', '/catalog/fragrances/:slug/similar', [200, 401, 404]),
    suggest: route('GET', '/catalog/suggest', [200, 401]),
    search: route('GET', '/catalog/search', [200, 401]),
  },
};

type Meta<T> = {
  [K in keyof T]: T[K] extends { method: infer M; path: infer P; responses: infer R }
    ? { method: M; path: P; statuses: keyof R }
    : Meta<T[K]>;
};
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** Compile-time check: fails typecheck if the table above drifts from the server contract. */
export type ClientMatchesServer = Assert<Equal<Meta<typeof contract>, Meta<typeof clientRoutes>>>;

/** Typed exactly like the server contract; only the zod runtime is missing. */
export const clientContract = clientRoutes as unknown as typeof contract;
