/**
 * lummi-ui-gallery (DEV ONLY): the cart screen on fixture data, `/dev/cart?data=…`. The toggle at
 * the top swaps the fixture at the data boundary (the server cart), so the screen is tested
 * exactly as the API would feed it. Numbers are written out, as the server would send them.
 */
import type { CartDto, CartLineDto, QuoteLine } from '@lummi/contracts';
import { Link, useSearch } from '@tanstack/react-router';
import { CartView } from '../screens/Cart';

/** Seed photos (the same content hashes the fragrance fixtures use). */
const PHOTO = { 10: '32c0930f6c672207', 30: 'e72fb0b319a12df8', 50: '0583e3c60c88b024' } as const;

const line = (
  id: number,
  name: string,
  ml: 10 | 30 | 50,
  qty: number,
  more: Partial<CartLineDto> = {},
): CartLineDto => ({
  id,
  slug: `fixture-${id}`,
  name,
  brand: 'Louis Vuitton',
  ml,
  photo: PHOTO[ml],
  qty,
  available: 20,
  soldOut: false,
  limited: false,
  ...more,
});

const priced = (
  key: number,
  qty: number,
  unitPrice: number,
  lineTotal: number,
  more: Partial<QuoteLine> = {},
): QuoteLine => ({
  key: String(key),
  qty,
  unitPrice,
  regularUnitPrice: unitPrice,
  markedDown: false,
  lineTotal,
  soldOut: false,
  ...more,
});

const noQuoteExtras = { alternatives: [], promoCode: null, staleChoice: false };

/** An applied discount (a set's upgrade right) and a line capped at what is left. */
const discount: CartDto = {
  lines: [
    line(1, 'Symphony', 30, 1, { photo: null }),
    line(2, 'Tygar', 10, 2, { photo: null, available: 2, limited: true }),
  ],
  count: 3,
  deliveryCity: null,
  suggestions: [],
  promoCode: null,
  freeDeliveryProgress: 100,
  quote: {
    lines: [priced(1, 1, 149_000, 149_000), priced(2, 2, 69_000, 138_000)],
    itemsSubtotal: 287_000,
    discount: { type: 'upgrade_right', id: 1, source: 'set', amount: 29_800, lineKey: '1' },
    thresholdBase: 'before',
    thresholdBaseAmount: 287_000,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 0,
    deliveryFee: 0,
    total: 257_200,
    ...noQuoteExtras,
  },
};

const plain: CartDto = {
  ...discount,
  quote: { ...discount.quote, discount: null, total: 287_000 },
};

const KARAKALPAKSTAN = {
  region: {
    id: 14,
    nameRu: 'Республика Каракалпакстан',
    nameUz: 'Qoraqalpogʻiston Respublikasi',
    deliveryTariff: 25_000,
  },
  city: 'Qoraqalpogʻiston Respublikasi',
};
const LONG_NAME = 'Oud Satin Mood Extrait de Parfum Intense'; // 40 characters

/**
 * The realistic worst case: twelve lines (a 40-character name on a marked-down seven-digit price,
 * quantity 99, a capped line, a sold-out line, a two-letter name, a missing and a broken photo),
 * a long promo code, the longest delivery city and a seven-digit total.
 */
const worst: CartDto = {
  lines: [
    line(1, LONG_NAME, 50, 1, { photo: null, available: 4 }),
    line(2, 'Tygar', 10, 99, { available: 140 }),
    line(3, 'Baccarat Rouge 540', 30, 2, { available: 2, limited: true }),
    line(4, 'Power Of You', 10, 1, { available: 0, soldOut: true }),
    line(5, 'Si', 30, 1, { photo: 'ffffffffffffffff' }),
    line(6, 'Elysium Pour Homme Parfum', 50, 3),
    line(7, 'Symphony', 10, 1),
    line(8, 'Ink Mark', 30, 1),
    line(9, 'Moon Tale', 50, 1),
    line(10, 'Rain Tea', 10, 1),
    line(11, 'Ombré Leather Parfum', 30, 1),
    line(12, 'Lost Cherry', 50, 1),
  ],
  count: 112,
  deliveryCity: KARAKALPAKSTAN,
  suggestions: [],
  promoCode: 'BLOGER_MALIKA_2026',
  freeDeliveryProgress: 100,
  quote: {
    lines: [
      priced(1, 1, 1_049_000, 1_049_000, { regularUnitPrice: 1_490_000, markedDown: true }),
      priced(2, 99, 69_000, 6_831_000),
      priced(3, 2, 149_000, 298_000),
      priced(4, 1, 69_000, 69_000, { soldOut: true }),
      priced(5, 1, 149_000, 149_000),
      priced(6, 3, 219_000, 657_000),
      priced(7, 1, 69_000, 69_000),
      priced(8, 1, 149_000, 149_000),
      priced(9, 1, 219_000, 219_000),
      priced(10, 1, 69_000, 69_000),
      priced(11, 1, 149_000, 149_000),
      priced(12, 1, 219_000, 219_000),
    ],
    itemsSubtotal: 9_858_000,
    discount: { type: 'promo_code', code: 'BLOGER_MALIKA_2026', amount: 880_900 },
    thresholdBase: 'after',
    thresholdBaseAmount: 8_977_100,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 0,
    deliveryFee: 0,
    total: 8_977_100,
    ...noQuoteExtras,
  },
};

/** The thread with three long-named suggestions, a sold-out line and a paid delivery to a long city. */
const worstNudge: CartDto = {
  lines: [
    line(1, LONG_NAME, 50, 1),
    line(2, 'Power Of You', 10, 1, { available: 0, soldOut: true }),
  ],
  count: 1,
  deliveryCity: KARAKALPAKSTAN,
  suggestions: [
    {
      slug: 's1',
      name: 'Velvet Orchid Absolu Extrait de Parfum',
      brand: 'Maison Francis Kurkdjian',
      ml: 10,
      photo: PHOTO[10],
      price: 69_000,
    },
    {
      slug: 's2',
      name: 'Ombré Leather Parfum',
      brand: 'Tom Ford',
      ml: 10,
      photo: PHOTO[10],
      price: 55_200,
    },
    { slug: 's3', name: 'Si', brand: 'Giorgio Armani', ml: 10, photo: null, price: 69_000 },
  ],
  promoCode: null,
  freeDeliveryProgress: 88,
  quote: {
    lines: [priced(1, 1, 219_000, 219_000), priced(2, 1, 69_000, 69_000, { soldOut: true })],
    itemsSubtotal: 219_000,
    discount: null,
    thresholdBase: 'before',
    thresholdBaseAmount: 219_000,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 31_000,
    deliveryFee: 25_000,
    total: 244_000,
    ...noQuoteExtras,
  },
};

/** Every line sold out: nothing to pay, the thread hidden, the checkout disabled with the reason. */
const unavailable: CartDto = {
  lines: [
    line(1, 'Power Of You', 10, 1, { available: 0, soldOut: true }),
    line(2, 'Tygar', 30, 2, { available: 0, soldOut: true }),
  ],
  count: 0,
  deliveryCity: null,
  suggestions: [],
  promoCode: null,
  freeDeliveryProgress: 0,
  quote: {
    lines: [
      priced(1, 1, 69_000, 69_000, { soldOut: true }),
      priced(2, 2, 149_000, 298_000, { soldOut: true }),
    ],
    itemsSubtotal: 0,
    discount: null,
    thresholdBase: 'before',
    thresholdBaseAmount: 0,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 250_000,
    deliveryFee: 0,
    total: 0,
    ...noQuoteExtras,
  },
};

export const CART_FIXTURES = {
  discount,
  plain,
  worst,
  'worst-nudge': worstNudge,
  unavailable,
} satisfies Record<string, CartDto>;
export type CartFixtureName = keyof typeof CART_FIXTURES;
const NAMES = Object.keys(CART_FIXTURES) as CartFixtureName[];

export function CartFixtures() {
  // The dev routes are outside the typed tree in a build, so the search is read loosely.
  const search: { data?: CartFixtureName } = useSearch({ strict: false });
  const data = search.data ?? 'discount';
  return (
    <>
      <CartView key={data} cart={CART_FIXTURES[data]} />
      <nav
        aria-label="fixture"
        className="fixed top-[calc(var(--safe-t,0px)+8px)] right-2 z-50 flex gap-0.5 rounded-pill bg-field p-0.5"
      >
        {NAMES.map((n) => (
          <Link
            key={n}
            to="/dev/cart"
            search={{ data: n }}
            replace
            className={`type-caption rounded-pill px-2 py-1 ${n === data ? 'bg-card text-ink' : 'text-muted'}`}
          >
            {n}
          </Link>
        ))}
      </nav>
    </>
  );
}
