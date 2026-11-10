import type { CartDto } from '@lummi/contracts';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import { fill } from '@lummi/i18n';
import type { miniappMessages } from '@lummi/i18n/miniapp';

/*
 * What an add says, for the card dock and the list «+». Apart from `queries`, which the tab bar
 * loads with the first screen, so Home does not carry it.
 */

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
