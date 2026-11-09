import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';
import { toQuery } from './request';
import type { CatalogSearch } from './filters';

/**
 * One page of the catalog list (Home's sections); the previous list stays, dimmed, while a chip
 * loads. `enabled: false` waits (the catalog asks for one row only when it needs the facets).
 */
export function useCatalogPage(filters: CatalogSearch, limit: number, enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'page', filters, limit],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.catalog.list({ query: toQuery(filters, limit, 0) }), 200),
    staleTime: 60_000,
  });
}
