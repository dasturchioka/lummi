import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CART_KEY } from '../cart/queries';
import { api, unwrap } from '../lib/api';

export const DISCOVERY_KEY = ['sets', 'discovery'] as const;
export const BUILDER_KEY = ['sets', 'builder'] as const;

/** The Discovery set: price, own availability, photo, the five fragrances. Money is the server's. */
export function useDiscoverySet() {
  return useQuery({
    queryKey: DISCOVERY_KEY,
    staleTime: 30_000,
    queryFn: async () => unwrap(await api.sets.discovery(), 200),
  });
}

/** The builder's price and the fragrances that have a 10 ml bottle available. */
export function useBuilder() {
  return useQuery({
    queryKey: BUILDER_KEY,
    staleTime: 15_000,
    queryFn: async () => unwrap(await api.sets.builder(), 200),
  });
}

export function useAddDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.cart.addDiscovery({ body: { qty: 1 } }), 200),
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
    // stock moved under the customer (409): show what is true now
    onError: () => void qc.invalidateQueries({ queryKey: DISCOVERY_KEY }),
  });
}

export function useAddBuilder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]) =>
      unwrap(await api.cart.addBuilder({ body: { slugs, qty: 1 } }), 200),
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
    onError: () => void qc.invalidateQueries({ queryKey: BUILDER_KEY }),
  });
}
