import {
  CATALOG_SORTS,
  FRAGRANCE_TYPES,
  SEASONS,
  VOLUMES_ML,
  type CatalogSort,
} from '@lummi/contracts/constants';

export type FragranceType = (typeof FRAGRANCE_TYPES)[number];
type Season = (typeof SEASONS)[number];
type Volume = (typeof VOLUMES_ML)[number];

/** The catalog's state, kept in the URL so a way back from a fragrance card keeps the filters. */
export interface CatalogSearch {
  /** `sets` is the «Наборы» chip: a placeholder until the sets ticket. */
  type?: FragranceType | 'sets';
  family?: number;
  volume?: Volume;
  min?: number;
  max?: number;
  season?: Season;
  sort?: CatalogSort;
  /** Only the owner-flagged new fragrances: Home's «Новинки» row asks for it; never part of the URL. */
  isNew?: 1;
}

/** A whole number written in digits only (no sign, no decimals, no exponent). */
const int = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  return typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v))
    ? Number(v)
    : undefined;
};
const oneOf = <T extends string | number>(list: readonly T[], v: unknown): T | undefined =>
  list.find((x) => String(x) === String(v));

/** Whatever the URL carries becomes a valid state; anything else is dropped. */
export function parseCatalogSearch(s: Record<string, unknown>): CatalogSearch {
  const type = s.type === 'sets' ? 'sets' : oneOf(FRAGRANCE_TYPES, s.type);
  const family = int(s.family);
  const out: CatalogSearch = {
    ...(type ? { type } : {}),
    ...(family ? { family } : {}),
    ...(oneOf(VOLUMES_ML, s.volume) ? { volume: oneOf(VOLUMES_ML, s.volume) } : {}),
    ...(int(s.min) !== undefined ? { min: int(s.min) } : {}),
    ...(int(s.max) !== undefined ? { max: int(s.max) } : {}),
    ...(oneOf(SEASONS, s.season) ? { season: oneOf(SEASONS, s.season) } : {}),
    ...(oneOf(CATALOG_SORTS, s.sort) && s.sort !== 'top'
      ? { sort: oneOf(CATALOG_SORTS, s.sort) }
      : {}),
  };
  return out;
}
