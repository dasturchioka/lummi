import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setsMessages } from '@lummi/i18n/sets';
import { CART_KEY } from '../cart/queries';
import { api, unwrap } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { DISCOVERY_KEY } from './queries';

export const BUILDER_KEY = ['sets', 'builder'] as const;

/** The set strings: their own namespace, so only the screens that show sets carry them. */
export function useSetsText() {
  const { language } = usePrefs();
  return setsMessages[language].sets;
}

/** The builder's price and the fragrances that have a 10 ml bottle available. */
export function useBuilder() {
  return useQuery({
    queryKey: BUILDER_KEY,
    staleTime: 15_000,
    queryFn: async () => unwrap(await api.sets.builder(), 200),
  });
}

export function useAddDiscovery(vialMl: 10 | 5 = 10) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.cart.addDiscovery({ body: { qty: 1, vialMl } }), 200),
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
    // stock moved under the customer (409): show what is true now
    onError: () => void qc.invalidateQueries({ queryKey: DISCOVERY_KEY }),
  });
}

/** The builder's 409: these chosen fragrances have no 10 ml left (the server names them by slug). */
export class SetUnavailableError extends Error {
  constructor(readonly slugs: string[]) {
    super('HTTP 409');
  }
}

export function useAddBuilder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]) => {
      const res = await api.cart.addBuilder({ body: { slugs, qty: 1 } });
      if (res.status === 409) throw new SetUnavailableError(res.body.slugs ?? []);
      return unwrap(res, 200);
    },
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
    onError: () => void qc.invalidateQueries({ queryKey: BUILDER_KEY }),
  });
}
