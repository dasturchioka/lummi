/**
 * `startapp` parameter -> route. Later tickets add targets here (fragrance, set, order, ...).
 * An unknown or missing value lands on Home; an unknown fragrance slug lands on the card's own
 * not-found state, which leads on to the catalog.
 */
const STATIC_TARGETS: Record<string, string> = {
  home: '/',
  catalog: '/catalog',
  cart: '/cart',
  orders: '/orders',
  profile: '/profile',
};

/** `p_<slug>` opens that fragrance's card (slugs are ASCII kebab case, ADR 0016). */
const FRAGRANCE_PARAM = /^p_([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function routeForStartParam(param: string | null | undefined): string {
  if (!param) return '/';
  const fragrance = FRAGRANCE_PARAM.exec(param);
  if (fragrance) return `/p/${fragrance[1]}`;
  return Object.hasOwn(STATIC_TARGETS, param) ? (STATIC_TARGETS[param] as string) : '/';
}
