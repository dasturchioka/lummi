import {
  CATALOG_SORTS,
  FRAGRANCE_TYPES,
  SEASONS,
  VOLUMES_ML,
  type CatalogSort,
} from '@lummi/contracts/constants';
import type { CatalogQuery } from '@lummi/contracts';

type FragranceType = (typeof FRAGRANCE_TYPES)[number];
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
  /** Only the owner-flagged new fragrances; set by nothing in the UI yet, Home uses `sort=new`. */
  isNew?: 1;
}

const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== '' && v !== null && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
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
    ...(Number(s.isNew) === 1 ? { isNew: 1 as const } : {}),
  };
  return out;
}

/** The filters the sheets set (not the type chip, not the sort). */
export function activeFilterCount(f: CatalogSearch): number {
  return (
    Number(f.family !== undefined) +
    Number(f.volume !== undefined) +
    Number(f.min !== undefined || f.max !== undefined) +
    Number(f.season !== undefined)
  );
}

export function toQuery(f: CatalogSearch, limit: number, offset: number): CatalogQuery {
  return {
    ...(f.type && f.type !== 'sets' ? { type: f.type } : {}),
    ...(f.family ? { family: f.family } : {}),
    ...(f.volume ? { volume: f.volume } : {}),
    ...(f.min !== undefined ? { priceMin: f.min } : {}),
    ...(f.max !== undefined ? { priceMax: f.max } : {}),
    ...(f.season ? { season: f.season } : {}),
    ...(f.isNew ? { isNew: '1' as const } : {}),
    sort: f.sort ?? 'top',
    limit,
    offset,
  };
}
