/**
 * lummi-ui-gallery (DEV ONLY): the cart screen on fixture data, `/dev/cart?data=…`. The toggle at
 * the top swaps the fixture at the data boundary (the server cart), so the screen is tested
 * exactly as the API would feed it. Numbers are written out, as the server would send them.
 */
import type {
  CartDto,
  CartLineDto,
  Discount,
  DiscountOptionDto,
  PromoCodeInvalid,
  QuoteLine,
  VolumeLineDto,
} from '@lummi/contracts';
import { Link, useSearch } from '@tanstack/react-router';
import { CartView } from '../screens/Cart';

/** Seed photos (the same content hashes the fragrance fixtures use). */
const PHOTO = { 10: '32c0930f6c672207', 30: 'e72fb0b319a12df8', 50: '0583e3c60c88b024' } as const;

const line = (
  id: number,
  name: string,
  ml: 10 | 30 | 50,
  qty: number,
  more: Partial<VolumeLineDto> = {},
): CartLineDto => ({
  kind: 'volume',
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
/** The cart's own extras when there is nothing to choose between (#39). */
const noChoice = {
  discountOptions: [],
  entitlementWaiting: null,
  lapsedDiscount: null,
  promoGift: null,
};

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
  ...noChoice,
  freeDeliveryProgress: 100,
  quote: {
    lines: [priced(1, 1, 149_000, 149_000), priced(2, 2, 69_000, 138_000)],
    itemsSubtotal: 287_000,
    discount: {
      type: 'upgrade_right',
      id: 1,
      source: 'set',
      percent: 20,
      amount: 29_800,
      lineKey: '1',
    },
    thresholdBase: 'before',
    thresholdBaseAmount: 287_000,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 0,
    deliveryFee: 0,
    total: 257_200,
    withoutDiscount: { deliveryFee: 0, total: 287_000 },
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
  ...noChoice,
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
    withoutDiscount: { deliveryFee: 0, total: 9_858_000 },
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
  ...noChoice,
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
    withoutDiscount: { deliveryFee: 25_000, total: 244_000 },
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
  ...noChoice,
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
    withoutDiscount: { deliveryFee: 0, total: 0 },
    ...noQuoteExtras,
  },
};

/** The plain cart with its bottle photos (the `discount` fixture keeps them missing on purpose). */
const PHOTOGRAPHED = plain.lines.map((l) =>
  l.kind === 'volume' ? { ...l, photo: PHOTO[l.ml] } : l,
);

/** The entered code BLOGER10 as the quote judged it: applied (10 %), or refused with its reason. */
const withCode = (invalid: PromoCodeInvalid | null, code = 'BLOGER10'): CartDto => ({
  ...plain,
  lines: PHOTOGRAPHED,
  promoCode: code,
  ...noChoice,
  quote: {
    ...plain.quote,
    ...(invalid
      ? {}
      : {
          discount: { type: 'promo_code', code, amount: 28_700 },
          thresholdBase: 'after',
          thresholdBaseAmount: 258_300,
          total: 258_300,
        }),
    promoCode: { code, invalid },
  },
});

/**
 * A gift code (ADR 0039): its free Rain Tea 10 ml listed under the lines at 0, nothing off the
 * items; or the Discovery set; or its gift gone («Подарок закончился»).
 */
const withGift = (gift: 'volume' | 'discovery_set' | 'sold_out'): CartDto => ({
  ...plain,
  lines: PHOTOGRAPHED,
  promoCode: 'RAINTEA',
  ...noChoice,
  promoGift:
    gift === 'volume'
      ? {
          kind: 'volume',
          photo: PHOTO[10],
          slug: 'rain-tea',
          name: 'Rain Tea',
          brand: 'Bvlgari',
          ml: 10,
        }
      : gift === 'discovery_set'
        ? {
            kind: 'discovery_set',
            photo: null,
            fragrances: ['Symphony', 'Tygar', 'Megamare', 'Erba Pura', 'Oud Wood'].map((name) => ({
              slug: name.toLowerCase().replace(' ', '-'),
              name,
              brand: 'Louis Vuitton',
            })),
          }
        : null,
  quote: {
    ...plain.quote,
    ...(gift === 'sold_out'
      ? {}
      : {
          discount: {
            type: 'promo_code',
            code: 'RAINTEA',
            amount: 0,
            gift: {
              item: gift === 'volume' ? { kind: 'volume', volumeId: 7 } : { kind: 'discovery_set' },
              value: gift === 'volume' ? 69_000 : 299_000,
            },
          },
          thresholdBase: 'after',
        }),
    promoCode: {
      code: 'RAINTEA',
      invalid: gift === 'sold_out' ? { reason: 'gift_sold_out' } : null,
    },
  },
});

/** The longest code the admin allows (32 characters), for the break-ui cases (#29). */
const LONG_CODE = 'BLOGER_MALIKA_NOVOGODNIY_2026_UZ';

/** A seven-digit fixed discount under the 32-character code, delivered to the longest city. */
const promoWorst: CartDto = {
  lines: [line(1, LONG_NAME, 50, 5), line(2, 'Baccarat Rouge 540', 50, 4)],
  count: 9,
  deliveryCity: KARAKALPAKSTAN,
  suggestions: [],
  promoCode: LONG_CODE,
  ...noChoice,
  freeDeliveryProgress: 100,
  quote: {
    lines: [priced(1, 5, 219_000, 1_095_000), priced(2, 4, 219_000, 876_000)],
    itemsSubtotal: 1_971_000,
    discount: { type: 'promo_code', code: LONG_CODE, amount: 1_250_000 },
    thresholdBase: 'after',
    thresholdBaseAmount: 721_000,
    freeDeliveryThreshold: 250_000,
    amountToFreeDelivery: 0,
    deliveryFee: 0,
    total: 721_000,
    withoutDiscount: { deliveryFee: 0, total: 1_971_000 },
    alternatives: [],
    promoCode: { code: LONG_CODE, invalid: null },
    staleChoice: false,
  },
};

/**
 * A 100 % code: the items cost nothing and the delivery is still paid (a discount never touches
 * it; the free-delivery threshold counts after the code, so it is far away again).
 */
const promoFull: CartDto = {
  ...plain,
  lines: PHOTOGRAPHED,
  deliveryCity: KARAKALPAKSTAN,
  promoCode: 'LUMMI100',
  ...noChoice,
  freeDeliveryProgress: 0,
  quote: {
    ...plain.quote,
    discount: { type: 'promo_code', code: 'LUMMI100', amount: 287_000 },
    thresholdBase: 'after',
    thresholdBaseAmount: 0,
    amountToFreeDelivery: 250_000,
    deliveryFee: 25_000,
    total: 25_000,
    promoCode: { code: 'LUMMI100', invalid: null },
  },
};
const PROMO_REASONS = [
  { reason: 'unknown' },
  { reason: 'inactive' },
  { reason: 'expired' },
  { reason: 'exhausted' },
  { reason: 'already_used' },
  { reason: 'not_new_customer' },
  { reason: 'below_minimum', minOrderTotal: 300_000 },
  { reason: 'no_eligible_items' },
] as const satisfies PromoCodeInvalid[];
const promoFixtures = Object.fromEntries(
  PROMO_REASONS.map((r) => [`promo-${r.reason.replaceAll('_', '-')}`, withCode(r)]),
) as Record<`promo-${string}`, CartDto>;

/**
 * The discount switch (#39), as the API answers it: Tygar 30 ml and two 10 ml (287 000). The set
 * right takes 29 800 and keeps delivery free (257 200); the 15 % birthday coupon takes 43 050 but,
 * counted after it, brings delivery back (268 950); the code BLOGER5 takes 14 350 (272 650).
 */
const RIGHT: Discount = {
  type: 'upgrade_right',
  id: 1,
  source: 'set',
  percent: 20,
  amount: 29_800,
  lineKey: '1',
};
const COUPON: Discount = { type: 'birthday_coupon', id: 5, amount: 43_050 };
const CODE: Discount = { type: 'promo_code', code: 'BLOGER5', amount: 14_350 };
const choiceRows = {
  right: {
    discount: RIGHT,
    deliveryFee: 0,
    total: 257_200,
    terms: { percent: 20, lastDay: '2026-12-01' },
  },
  coupon: {
    discount: COUPON,
    deliveryFee: 25_000,
    total: 268_950,
    terms: { percent: 15, lastDay: '2026-11-21' },
  },
  code: { discount: CODE, deliveryFee: 0, total: 272_650, terms: null },
  none: { discount: null, deliveryFee: 0, total: 287_000, terms: null },
};
type ChoiceRow = keyof typeof choiceRows;

/** A cart of the three bottles with `applied` applied, offering `rows` (in the server's order). */
const choosing = (
  applied: ChoiceRow,
  rows: ChoiceRow[],
  more: {
    promoCode?: string;
    lapsed?: CartDto['lapsedDiscount'];
    waiting?: CartDto['entitlementWaiting'];
  } = {},
): CartDto => {
  const a = choiceRows[applied];
  const others = rows
    .filter((r): r is Exclude<ChoiceRow, 'none'> => r !== applied && r !== 'none')
    .map((r) => choiceRows[r]);
  const discountOptions: DiscountOptionDto[] = rows.map((r) => ({
    ...choiceRows[r],
    applied: r === applied,
  }));
  return {
    lines: [line(1, 'Tygar', 30, 1), line(2, 'Symphony', 10, 1), line(3, 'Ink Mark', 10, 1)],
    count: 3,
    deliveryCity: null,
    suggestions: [],
    promoCode: more.promoCode ?? null,
    promoGift: null,
    discountOptions,
    lapsedDiscount: more.lapsed ?? null,
    entitlementWaiting: more.waiting ?? null,
    freeDeliveryProgress: 100,
    quote: {
      lines: [
        priced(1, 1, 149_000, 149_000),
        priced(2, 1, 69_000, 69_000),
        priced(3, 1, 69_000, 69_000),
      ],
      itemsSubtotal: 287_000,
      discount: a.discount,
      thresholdBase: applied === 'right' || applied === 'none' ? 'before' : 'after',
      thresholdBaseAmount:
        287_000 - (applied === 'right' || applied === 'none' ? 0 : a.discount!.amount),
      freeDeliveryThreshold: 250_000,
      // with the coupon: 294 117 of items less its 44 117 reach 250 000
      amountToFreeDelivery: applied === 'coupon' ? 7_117 : 0,
      deliveryFee: a.deliveryFee,
      total: a.total,
      alternatives: [
        ...others.map((o) => ({ ...o, cheaperBy: Math.max(0, a.total - o.total) })),
      ].map(({ terms: _terms, ...o }) => o),
      withoutDiscount: { deliveryFee: 0, total: 287_000 },
      promoCode: more.promoCode ? { code: more.promoCode, invalid: null } : null,
      staleChoice: Boolean(more.lapsed),
    },
  };
};

export const CART_FIXTURES = {
  discount,
  plain,
  worst,
  'worst-nudge': worstNudge,
  unavailable,
  'promo-applied': withCode(null),
  'promo-gift': withGift('volume'),
  'promo-gift-set': withGift('discovery_set'),
  'promo-gift-sold-out': withGift('sold_out'),
  ...promoFixtures,
  'promo-worst': promoWorst,
  'promo-full': promoFull,
  // the longest refusal: the 32-character code under a seven-digit minimum
  'promo-worst-refused': withCode({ reason: 'below_minimum', minOrderTotal: 1_250_000 }, LONG_CODE),
  // the discount switch (#39)
  'choice-auto': choosing('right', ['right', 'coupon', 'none']),
  'choice-promo': choosing('code', ['right', 'coupon', 'code', 'none'], {
    promoCode: 'BLOGER5',
    waiting: {
      type: 'upgrade_right',
      id: 1,
      source: 'set',
      percent: 20,
      lastDay: '2026-12-01',
      cheaperBy: 15_450,
    },
  }),
  'choice-switched': choosing('right', ['right', 'coupon', 'code', 'none'], {
    promoCode: 'BLOGER5',
  }),
  'choice-none': choosing('none', ['right', 'coupon', 'none']),
  // the costlier coupon chosen: its row carries the delivery the right leaves free
  'choice-coupon': choosing('coupon', ['right', 'coupon', 'none']),
  // the chosen coupon lapsed; the server fell back to the right
  'choice-stale': choosing('right', ['right', 'none'], { lapsed: { type: 'birthday_coupon' } }),
} satisfies Record<string, CartDto>;
export type CartFixtureName = keyof typeof CART_FIXTURES;
const NAMES = Object.keys(CART_FIXTURES) as CartFixtureName[];

export function CartFixtures() {
  // The dev routes are outside the typed tree in a build, so the search is read loosely.
  const search: { data?: string } = useSearch({ strict: false });
  const data: CartFixtureName =
    search.data && Object.hasOwn(CART_FIXTURES, search.data)
      ? (search.data as CartFixtureName)
      : 'discount';
  return (
    <>
      <CartView key={data} cart={CART_FIXTURES[data]} />
      <nav
        aria-label="fixture"
        className="fixed top-[calc(var(--safe-t,0px)+8px)] right-2 z-50 flex max-w-[calc(100vw-16px)] flex-wrap justify-end gap-0.5 rounded-[14px] bg-field p-0.5"
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
