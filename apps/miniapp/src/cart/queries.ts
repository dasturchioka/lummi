import type { CartDto } from '@lummi/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../lib/api';

export const CART_KEY = ['cart'] as const;

/**
 * The server cart with its fresh quote, never computed here. One shared query: the tab bar and the
 * fragrance card read it as cached (30 s), mutations write their response into it, and the cart
 * screen (`fresh`) re-reads it on every open so prices are re-quoted.
 */
export function useCart({ fresh = false }: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: CART_KEY,
    staleTime: 30_000,
    refetchOnMount: fresh ? 'always' : true,
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

/** A typed code: the cart comes back with the quote saying whether it applies (ticket #29). */
export type ApplyPromoResult = { cart: CartDto } | { tooManyFor: number };

export function useApplyPromoCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<ApplyPromoResult> => {
      const res = await api.cart.applyPromoCode({ body: { code } });
      // codes are guessable: past the limit the server keeps the stored code and says how long to wait
      if (res.status === 429) return { tooManyFor: res.body.retryAfterSeconds };
      return { cart: unwrap(res, 200) };
    },
    onSuccess: (r) => {
      if ('cart' in r) qc.setQueryData(CART_KEY, r.cart);
    },
  });
}

export function useRemovePromoCode() {
  return useCartMutation(async () => unwrap(await api.cart.removePromoCode(), 200));
}
