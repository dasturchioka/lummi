import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

export const DISCOVERY_KEY = ['sets', 'discovery'] as const;

/**
 * The Discovery set: price, own availability, photo, the five fragrances. Money is the server's.
 * Kept apart from the builder and the add-to-cart hooks (`./actions`), so Home's banner carries
 * only this query (ADR 0030 budget).
 */
export function useDiscoverySet() {
  return useQuery({
    queryKey: DISCOVERY_KEY,
    staleTime: 30_000,
    queryFn: async () => unwrap(await api.sets.discovery(), 200),
  });
}
