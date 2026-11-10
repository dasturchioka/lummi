import { FRAGRANCE_START_PARAM, STATIC_START_TARGETS } from '@lummi/contracts/constants';

/**
 * `startapp` parameter -> route. The target list is one source of truth, shared with the admin's
 * banner editor and the broadcasts: `@lummi/contracts/constants`. An unknown or missing value
 * lands on Home.
 */
export function routeForStartParam(param: string | null | undefined): string {
  if (!param) return '/';
  const fragrance = FRAGRANCE_START_PARAM.exec(param);
  if (fragrance) return `/p/${fragrance[1]}`;
  return Object.hasOwn(STATIC_START_TARGETS, param)
    ? STATIC_START_TARGETS[param as keyof typeof STATIC_START_TARGETS]
    : '/';
}
