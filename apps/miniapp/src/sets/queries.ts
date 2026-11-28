import { MAIN_SET_KEY } from '@lummi/contracts/constants';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

/** Every Discovery set query starts with it, so one invalidation reaches them all. */
export const DISCOVERY_KEY = ['sets', 'discovery'] as const;

/**
 * A Discovery set by its key (ADR 0042, 0044; the main one by default): name, price, own
 * availability, photo, the five fragrances. Money is the server's. Kept apart from the builder and
 * the add-to-cart hooks (`./actions`), so Home's banner carries only this query (ADR 0030 budget).
 */
export function useDiscoverySet(key: string = MAIN_SET_KEY) {
  return useQuery({
    queryKey: [...DISCOVERY_KEY, key],
    staleTime: 30_000,
    queryFn: async () => unwrap(await api.sets.discovery({ query: { key } }), 200),
  });
}

/**
 * The sets on sale, in the owner's order (ADR 0044). Each one also fills its own query, so a card
 * or a set's screen opened from the list reads it without asking again.
 */
export function useDiscoverySets() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [...DISCOVERY_KEY, '*list'],
    staleTime: 30_000,
    queryFn: async () => {
      const sets = unwrap(await api.sets.list(), 200);
      for (const set of sets) qc.setQueryData([...DISCOVERY_KEY, set.key], set);
      return sets;
    },
  });
}
