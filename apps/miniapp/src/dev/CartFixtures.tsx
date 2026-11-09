import type { CartDto } from '@lummi/contracts';
import { useSearch } from '@tanstack/react-router';
import { CartView } from '../screens/Cart';

/** A server cart as the fixtures need it; numbers are written out, as the server would send them. */
const base: CartDto = {
  lines: [
    {
      id: 1,
      slug: 'symphony',
      name: 'Symphony',
      ml: 30,
      photo: null,
      qty: 1,
      available: 20,
      soldOut: false,
      limited: false,
    },
    {
      id: 2,
      slug: 'tygar',
      name: 'Tygar',
      ml: 10,
      photo: null,
      qty: 2,
      available: 2,
      soldOut: false,
      limited: true,
    },
  ],
  count: 3,
  deliveryCity: null,
  suggestions: [],
  promoCode: null,
  freeDeliveryProgress: 100,
  quote: {
    lines: [
      {
        key: '1',
        qty: 1,
        unitPrice: 149_000,
        regularUnitPrice: 149_000,
        markedDown: false,
        lineTotal: 149_000,
        soldOut: false,
      },
      {
        key: '2',
        qty: 2,
        unitPrice: 69_000,
        regularUnitPrice: 69_000,
        markedDown: false,
        lineTotal: 138_000,
        soldOut: false,
      },
    ],
    itemsSubtotal: 287_000,
    discount: { type: 'upgrade_right', id: 1, source: 'set', amount: 29_800, lineKey: '1' },
    thresholdBase: 'before',
    thresholdBaseAmount: 287_000,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 0,
    deliveryFee: 0,
    total: 257_200,
    alternatives: [],
    promoCode: null,
    staleChoice: false,
  },
};

/** The cart screen on fixtures, development only: `?data=discount` (an applied discount, a capped line). */
export function CartFixtures() {
  const { data } = useSearch({ from: '/dev/cart' });
  const cart: CartDto =
    data === 'discount'
      ? base
      : {
          ...base,
          quote: { ...base.quote, discount: null, total: 287_000 },
        };
  return <CartView cart={cart} />;
}
