import { STARTAPP_ROUTES } from '@lummi/contracts/constants';

/**
 * `startapp` parameter -> route. The plain targets live in `@lummi/contracts/constants`
 * (`STARTAPP_ROUTES`: the one list the bot and the admin's link builder share, ADR 0022).
 * An unknown or missing value lands on Home; an unknown fragrance slug lands on the card's own
 * not-found state, which leads on to the catalog.
 */

/** `p_<slug>` opens that fragrance's card (slugs are ASCII kebab case, ADR 0016). */
const FRAGRANCE_PARAM = /^p_([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function routeForStartParam(param: string | null | undefined): string {
  if (!param) return '/';
  const fragrance = FRAGRANCE_PARAM.exec(param);
  if (fragrance) return `/p/${fragrance[1]}`;
  return Object.hasOwn(STARTAPP_ROUTES, param)
    ? STARTAPP_ROUTES[param as keyof typeof STARTAPP_ROUTES]
    : '/';
}
