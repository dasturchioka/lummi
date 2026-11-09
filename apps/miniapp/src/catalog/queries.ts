import { CATALOG_PAGE_SIZE } from '@lummi/contracts/constants';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';
import { toQuery, type CatalogSearch } from './filters';

/**
 * The catalog list, a page at a time. The key carries the filters, so a change shows the previous
 * list (dimmed by the caller) until the next one arrives instead of flashing skeletons.
 */
export function useCatalogList(
  filters: CatalogSearch,
  pageSize = CATALOG_PAGE_SIZE,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ['catalog', 'list', filters, pageSize],
    enabled,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.catalog.list({ query: toQuery(filters, pageSize, pageParam) }), 200),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    staleTime: 60_000,
  });
}
