import type { CatalogQuery } from '@lummi/contracts';
import type { CatalogSearch } from './filters';

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
