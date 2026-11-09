/**
 * `startapp` parameter -> route. Later tickets add targets here (fragrance, set, order, ...).
 * An unknown or missing value lands on Home.
 */
const STATIC_TARGETS: Record<string, string> = {
  home: '/',
  catalog: '/catalog',
  cart: '/cart',
  orders: '/orders',
  profile: '/profile',
};

export function routeForStartParam(param: string | null | undefined): string {
  if (!param) return '/';
  return Object.hasOwn(STATIC_TARGETS, param) ? (STATIC_TARGETS[param] as string) : '/';
}
