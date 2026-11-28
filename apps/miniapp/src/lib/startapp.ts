import { FRAGRANCE_START_PARAM, STATIC_START_TARGETS } from '@lummi/contracts/constants';

/**
 * `startapp` parameter -> route. The target list is one source of truth, shared with the admin's
 * banner editor and the broadcasts: `@lummi/contracts/constants`. An unknown or missing value
 * lands on Home.
 */

/** `o_<number>` opens that order (the customer's own; another's says «Заказ не найден»). */
const ORDER_PARAM = /^o_([1-9]\d{0,9})$/;

export function routeForStartParam(param: string | null | undefined): string {
  if (!param) return '/';
  const fragrance = FRAGRANCE_START_PARAM.exec(param);
  if (fragrance) return `/p/${fragrance[1]}`;
  const order = ORDER_PARAM.exec(param);
  if (order) return `/orders/${order[1]}`;
  return Object.hasOwn(STATIC_START_TARGETS, param)
    ? STATIC_START_TARGETS[param as keyof typeof STATIC_START_TARGETS]
    : '/';
}
