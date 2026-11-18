import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

/** Both Discovery sets' queries start with it, so one invalidation reaches both. */
export const DISCOVERY_KEY = ['sets', 'discovery'] as const;

/**
 * A Discovery set (`vialMl` 10, or 5 for the 5 × 5 ml one, ADR 0042): price, own availability,
 * photo, the five fragrances. Money is the server's. Kept apart from the builder and the
 * add-to-cart hooks (`./actions`), so Home's banner carries only this query (ADR 0030 budget).
 */
export function useDiscoverySet(vialMl: 10 | 5 = 10) {
  return useQuery({
    queryKey: [...DISCOVERY_KEY, vialMl],
    staleTime: 30_000,
    queryFn: async () => unwrap(await api.sets.discovery({ query: { vialMl } }), 200),
  });
}
