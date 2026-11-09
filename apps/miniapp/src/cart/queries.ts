import type { CartDto } from '@lummi/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

export const CART_KEY = ['cart'] as const;

/** The server cart with its fresh quote; re-read on every open, never computed here. */
export function useCart() {
  return useQuery({
    queryKey: CART_KEY,
    staleTime: 0,
    queryFn: async () => unwrap(await api.cart.get(), 200),
  });
}

/** The tab-bar badge: units that can be bought. */
export function useCartCount(): number {
  return useCart().data?.count ?? 0;
}

function useCartMutation<V>(run: (v: V) => Promise<CartDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
  });
}

export function useAddToCart() {
  return useCartMutation(async (v: { slug: string; ml: 10 | 30 | 50 }) =>
    unwrap(await api.cart.addLine({ body: { ...v, qty: 1 } }), 200),
  );
}

export function useSetQuantity() {
  return useCartMutation(async (v: { lineId: number; qty: number }) =>
    unwrap(await api.cart.setQuantity({ params: { lineId: v.lineId }, body: { qty: v.qty } }), 200),
  );
}

export function useRemoveLine() {
  return useCartMutation(async (lineId: number) =>
    unwrap(await api.cart.removeLine({ params: { lineId } }), 200),
  );
}
