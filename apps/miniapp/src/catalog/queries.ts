import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';
import { toQuery } from './request';
import type { CatalogSearch } from './filters';

/** One page of the catalog list (Home's sections); the previous list stays, dimmed, while a chip loads. */
export function useCatalogPage(filters: CatalogSearch, limit: number) {
  return useQuery({
    queryKey: ['catalog', 'page', filters, limit],
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.catalog.list({ query: toQuery(filters, limit, 0) }), 200),
    staleTime: 60_000,
  });
}
