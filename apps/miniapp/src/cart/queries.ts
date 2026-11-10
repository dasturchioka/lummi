import type { CartDto } from '@lummi/contracts';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import type { miniappMessages } from '@lummi/i18n/miniapp';
import { fill } from '@lummi/i18n';
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

/** Units of a volume in the cart (0 when none). */
export const lineQty = (cart: CartDto | undefined, slug: string, ml: number) =>
  cart?.lines.find((l) => l.kind === 'volume' && l.slug === slug && l.ml === ml)?.qty ?? 0;

/**
 * What a «В корзину» or list «+» tap says (spec Changes 2026-11-10, cart 13): «Добавлено в
 * корзину» when the line grew, else why the server capped it, the 99 limit while stock is above
 * it, otherwise «Осталось N». `added` is false when nothing went in.
 */
export function addNote(
  t: (typeof miniappMessages)['ru'],
  before: number,
  next: CartDto,
  slug: string,
  ml: number,
): { text: string; added: boolean } {
  const after = next.lines.find((l) => l.kind === 'volume' && l.slug === slug && l.ml === ml);
  if (!after || after.qty > before) return { text: t.cart.added, added: true };
  return {
    added: false,
    text:
      after.qty >= CART_MAX_QTY && after.available > CART_MAX_QTY
        ? fill(t.cart.maxQty, { n: String(CART_MAX_QTY) })
        : fill(t.cart.onlyLeft, { n: String(after.available) }),
  };
}
