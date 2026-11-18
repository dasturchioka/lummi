import { quoteSchema, settingDefinitions, type Quote } from '@lummi/contracts';
import { describe, expect, it } from 'vitest';
import {
  quote,
  type Entitlement,
  type PricingSettings,
  type PromoCode,
  type QuoteInput,
  type QuoteLineInput,
} from '../src/pricing/quote';

/**
 * Seam 2 (ADR 0028): one row = one rule case. Expected figures are worked out by hand from
 * ADRs 0002, 0003, 0007, 0008, 0009 and the threshold-base rule (spec Changes 2026-11-07),
 * never recomputed the way quote() does it.
 */

const NOW = new Date('2026-11-10T07:00:00Z');
const TOMORROW = new Date('2026-11-11T07:00:00Z');
const YESTERDAY = new Date('2026-11-09T07:00:00Z');
const IN_10_DAYS = new Date('2026-11-20T07:00:00Z');
const IN_20_DAYS = new Date('2026-11-30T07:00:00Z');
/** «до 10.11.2026»: the end of that day in Asia/Tashkent, as admin stores it (spec Changes 2026-11-09). */
const MARKDOWN_UNTIL_10_NOV = new Date('2026-11-10T23:59:59+05:00');

const GUIDANCE = 1;
const TYGAR = 2;
const BLUE_SAPPHIRE = 3;

/** The setting defaults, so the table also pins them: 250 000, before/before/after/after, off/off, 30+50. */
const DEFAULTS: PricingSettings = {
  freeDeliveryThreshold: settingDefinitions['pricing.freeDeliveryThreshold'].default,
  thresholdBase: settingDefinitions['pricing.thresholdBase'].default,
  discountsApplyToMarkedDown: settingDefinitions['pricing.discountsApplyToMarkedDown'].default,
  fullSizeVolumesMl: settingDefinitions['pricing.fullSizeVolumesMl'].default,
};
const TARIFF = 25_000;

interface LineOpts {
  qty?: number;
  markdown?: { price: number; endsAt: Date | null };
  soldOut?: boolean;
}
function volume(
  key: string,
  fragranceId: number,
  volumeMl: number,
  regular: number,
  o: LineOpts = {},
): QuoteLineInput {
  return {
    key,
    item: { kind: 'volume', fragranceId, volumeMl },
    qty: o.qty ?? 1,
    price: { regular, markdown: o.markdown ?? null },
    soldOut: o.soldOut ?? false,
  };
}
function set(key: string, regular: number, o: LineOpts = {}): QuoteLineInput {
  return {
    key,
    item: { kind: 'set' },
    qty: o.qty ?? 1,
    price: { regular, markdown: o.markdown ?? null },
    soldOut: o.soldOut ?? false,
  };
}
function setRight(
  id: number,
  fragranceIds: number[],
  o: { percent?: number; expiresAt?: Date } = {},
): Entitlement {
  return {
    type: 'upgrade_right',
    id,
    source: 'set',
    percent: o.percent ?? 20,
    fragranceIds,
    expiresAt: o.expiresAt ?? IN_20_DAYS,
  };
}
function tenMlRight(id: number, fragranceId: number, percent = 20): Entitlement {
  return {
    type: 'upgrade_right',
    id,
    source: 'single_10ml',
    percent,
    fragranceIds: [fragranceId],
    expiresAt: IN_20_DAYS,
  };
}
function birthday(
  id: number,
  percent: number,
  maxAmount: number,
  expiresAt = IN_10_DAYS,
): Entitlement {
  return { type: 'birthday_coupon', id, percent, maxAmount, expiresAt };
}
type PromoOpts = { minOrderTotal?: number; appliesToMarkedDown?: boolean };
function percentPromo(
  code: string,
  percent: number,
  o: PromoOpts & { maxDiscount?: number } = {},
): PromoCode {
  return {
    code,
    kind: 'percent',
    percent,
    maxDiscount: o.maxDiscount ?? null,
    minOrderTotal: o.minOrderTotal ?? null,
    appliesToMarkedDown: o.appliesToMarkedDown ?? false,
  };
}
function fixedPromo(code: string, amount: number, o: PromoOpts = {}): PromoCode {
  return {
    code,
    kind: 'fixed',
    amount,
    minOrderTotal: o.minOrderTotal ?? null,
    appliesToMarkedDown: o.appliesToMarkedDown ?? false,
  };
}

/** A gift code (ADR 0039): Rain Tea 10 ml (regular 69 000) unless told otherwise. */
const RAIN_TEA_10 = { kind: 'volume', volumeId: 70 } as const;
function giftPromo(
  code: string,
  o: {
    item?: GiftItem;
    regular?: number;
    soldOut?: boolean;
    minOrderTotal?: number;
  } = {},
): PromoCode {
  return {
    code,
    kind: 'gift',
    promoGift: {
      item: o.item ?? RAIN_TEA_10,
      regular: o.regular ?? 69_000,
      soldOut: o.soldOut ?? false,
    },
    minOrderTotal: o.minOrderTotal ?? null,
    appliesToMarkedDown: false,
  };
}
type GiftItem = Extract<PromoCode, { kind: 'gift' }>['promoGift']['item'];

type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

interface Row {
  name: string;
  given: Partial<QuoteInput>;
  expected: DeepPartial<Quote>;
}

function input(given: Partial<QuoteInput>): QuoteInput {
  return {
    lines: [],
    entitlements: [],
    promoCode: null,
    choice: null,
    deliveryTariff: TARIFF,
    settings: DEFAULTS,
    now: NOW,
    ...given,
  };
}

function runTable(rows: Row[]) {
  it.each(rows)('$name', ({ given, expected }) => {
    const q = quote(input(given));
    expect(q).toMatchObject(expected);
    // Every quote is whole non-negative so'm by its schema (ADR 0016): no floats anywhere.
    expect(quoteSchema.parse(q)).toEqual(q);
  });
}

describe('quote(): lines, items subtotal and delivery', () => {
  runTable([
    {
      name: 'one 50 ml below the threshold pays the delivery tariff',
      given: { lines: [volume('g50', GUIDANCE, 50, 219_000)] },
      expected: {
        lines: [
          {
            key: 'g50',
            qty: 1,
            unitPrice: 219_000,
            regularUnitPrice: 219_000,
            markedDown: false,
            lineTotal: 219_000,
            soldOut: false,
          },
        ],
        itemsSubtotal: 219_000,
        discount: null,
        thresholdBase: 'before',
        thresholdBaseAmount: 219_000,
        freeDeliveryThreshold: 250_000,
        amountToFreeDelivery: 31_000,
        deliveryFee: 25_000,
        total: 244_000,
        alternatives: [],
        promoCode: null,
        staleChoice: false,
      },
    },
    {
      name: 'quantity multiplies the unit price',
      given: { lines: [volume('t10', TYGAR, 10, 69_000, { qty: 3 })] },
      expected: {
        lines: [{ key: 't10', qty: 3, unitPrice: 69_000, lineTotal: 207_000 }],
        itemsSubtotal: 207_000,
        amountToFreeDelivery: 43_000,
        deliveryFee: 25_000,
        total: 232_000,
      },
    },
    {
      name: 'items exactly at the threshold ship free',
      given: { lines: [volume('g30', GUIDANCE, 30, 125_000, { qty: 2 })] },
      expected: { itemsSubtotal: 250_000, amountToFreeDelivery: 0, deliveryFee: 0, total: 250_000 },
    },
    {
      name: 'one so’m below the threshold pays delivery',
      given: { lines: [volume('g50', GUIDANCE, 50, 249_999)] },
      expected: { amountToFreeDelivery: 1, deliveryFee: 25_000, total: 274_999 },
    },
    {
      name: 'a sold-out line is flagged and left out of every sum',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { soldOut: true }),
          volume('t10', TYGAR, 10, 69_000),
        ],
      },
      expected: {
        lines: [
          { key: 'g50', soldOut: true },
          { key: 't10', soldOut: false },
        ],
        itemsSubtotal: 69_000,
        amountToFreeDelivery: 181_000,
        deliveryFee: 25_000,
        total: 94_000,
      },
    },
    {
      name: 'a cart whose lines are all sold out costs nothing, delivery included',
      given: { lines: [volume('g50', GUIDANCE, 50, 219_000, { soldOut: true })] },
      expected: { itemsSubtotal: 0, deliveryFee: 0, total: 0 },
    },
    {
      name: 'an empty cart costs nothing',
      given: { lines: [] },
      expected: {
        lines: [],
        itemsSubtotal: 0,
        deliveryFee: 0,
        total: 0,
        amountToFreeDelivery: 250_000,
      },
    },
    {
      name: 'the delivery tariff is an input (per-region tariffs can return)',
      given: { lines: [volume('t10', TYGAR, 10, 69_000)], deliveryTariff: 30_000 },
      expected: { deliveryFee: 30_000, total: 99_000 },
    },
    {
      name: 'the free-delivery threshold is a setting',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })],
        settings: { ...DEFAULTS, freeDeliveryThreshold: 300_000 },
      },
      expected: {
        freeDeliveryThreshold: 300_000,
        amountToFreeDelivery: 40_000,
        deliveryFee: 25_000,
        total: 285_000,
      },
    },
  ]);
});

describe('quote(): markdown is the effective price (ADR 0008)', () => {
  runTable([
    {
      name: 'an active markdown is the unit price, the regular price stays for display',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
        ],
      },
      expected: {
        lines: [
          { unitPrice: 175_000, regularUnitPrice: 219_000, markedDown: true, lineTotal: 175_000 },
        ],
        itemsSubtotal: 175_000,
        total: 200_000,
      },
    },
    {
      name: 'a markdown without an end date stays active',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, {
            qty: 2,
            markdown: { price: 175_000, endsAt: null },
          }),
        ],
      },
      expected: {
        lines: [{ unitPrice: 175_000, markedDown: true, lineTotal: 350_000 }],
        itemsSubtotal: 350_000,
        deliveryFee: 0,
        total: 350_000,
      },
    },
    {
      name: 'a markdown past its end reverts to the regular price on its own',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: YESTERDAY } }),
        ],
      },
      expected: {
        lines: [{ unitPrice: 219_000, markedDown: false }],
        itemsSubtotal: 219_000,
      },
    },
    {
      name: 'a markdown «до 10.11» is still active at 23:59:59 Tashkent that day',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, {
            markdown: { price: 175_000, endsAt: MARKDOWN_UNTIL_10_NOV },
          }),
        ],
        now: new Date('2026-11-10T23:59:59+05:00'),
      },
      expected: { lines: [{ unitPrice: 175_000, markedDown: true }] },
    },
    {
      name: 'a markdown «до 10.11» is over at 00:00 Tashkent the next day',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, {
            markdown: { price: 175_000, endsAt: MARKDOWN_UNTIL_10_NOV },
          }),
        ],
        now: new Date('2026-11-11T00:00:00+05:00'),
      },
      expected: { lines: [{ unitPrice: 219_000, markedDown: false }] },
    },
    {
      name: 'a markdown price not below the regular price is no markdown',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 219_000, endsAt: null } }),
        ],
      },
      expected: { lines: [{ unitPrice: 219_000, markedDown: false }] },
    },
    {
      name: 'a set can be marked down like a volume',
      given: {
        lines: [set('discovery', 299_000, { markdown: { price: 249_000, endsAt: TOMORROW } })],
      },
      expected: {
        lines: [{ unitPrice: 249_000, regularUnitPrice: 299_000, markedDown: true }],
        itemsSubtotal: 249_000,
        deliveryFee: 25_000,
        total: 274_000,
      },
    },
  ]);
});

describe('quote(): upgrade right (ADR 0003, 0007, 0009)', () => {
  runTable([
    {
      name: 'takes its % off the single most expensive covered full-size unit',
      given: {
        lines: [
          volume('g30', GUIDANCE, 30, 149_000),
          volume('g50', GUIDANCE, 50, 219_000, { qty: 2 }),
        ],
        entitlements: [setRight(1, [GUIDANCE, BLUE_SAPPHIRE])],
      },
      expected: {
        itemsSubtotal: 587_000,
        discount: { type: 'upgrade_right', id: 1, source: 'set', amount: 43_800, lineKey: 'g50' },
        thresholdBase: 'before',
        thresholdBaseAmount: 587_000,
        deliveryFee: 0,
        total: 543_200,
      },
    },
    {
      name: 'never discounts a 10 ml bottle, which is not full size',
      given: {
        lines: [volume('g10', GUIDANCE, 10, 69_000, { qty: 2 })],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: { discount: null, alternatives: [], deliveryFee: 25_000, total: 163_000 },
    },
    {
      name: 'never discounts a set',
      given: {
        lines: [set('discovery', 299_000)],
        entitlements: [setRight(1, [GUIDANCE, TYGAR, BLUE_SAPPHIRE])],
      },
      expected: { discount: null, alternatives: [], total: 299_000 },
    },
    {
      name: 'covers only its own fragrances',
      given: {
        lines: [volume('t50', TYGAR, 50, 219_000)],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: { discount: null, total: 244_000 },
    },
    {
      name: 'is rounded down to a whole so’m',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 149_999)],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: { discount: { amount: 29_999 }, deliveryFee: 25_000, total: 145_000 },
    },
    {
      name: 'skips a marked-down bottle by default and takes the next covered unit',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('g30', GUIDANCE, 30, 149_000),
        ],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: {
        itemsSubtotal: 324_000,
        discount: { amount: 29_800, lineKey: 'g30' },
        total: 294_200,
      },
    },
    {
      name: 'discounts the markdown price when the upgrade-right marked-down setting is on',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('g30', GUIDANCE, 30, 149_000),
        ],
        entitlements: [setRight(1, [GUIDANCE])],
        settings: {
          ...DEFAULTS,
          discountsApplyToMarkedDown: { upgradeRight: true, birthdayCoupon: false },
        },
      },
      expected: { discount: { amount: 35_000, lineKey: 'g50' }, total: 289_000 },
    },
    {
      name: 'does not apply when its only covered bottle is marked down',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
        ],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: { discount: null, alternatives: [], total: 200_000 },
    },
    {
      name: 'ignores a sold-out covered bottle',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { soldOut: true }),
          volume('g30', GUIDANCE, 30, 149_000),
        ],
        entitlements: [setRight(1, [GUIDANCE])],
      },
      expected: { discount: { amount: 29_800, lineKey: 'g30' }, total: 144_200 },
    },
    {
      name: 'full size is a setting',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 149_000)],
        entitlements: [setRight(1, [GUIDANCE])],
        settings: { ...DEFAULTS, fullSizeVolumesMl: [50] },
      },
      expected: { discount: null, total: 174_000 },
    },
    {
      name: 'between equally priced covered units, the first line in the cart is discounted',
      given: {
        lines: [volume('bs50', BLUE_SAPPHIRE, 50, 219_000), volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [setRight(1, [GUIDANCE, BLUE_SAPPHIRE])],
      },
      expected: { discount: { amount: 43_800, lineKey: 'bs50' }, total: 394_200 },
    },
    {
      name: 'a right opened by a single 10 ml bottle discounts the same way',
      given: {
        lines: [volume('t50', TYGAR, 50, 219_000)],
        entitlements: [tenMlRight(7, TYGAR)],
      },
      expected: {
        discount: {
          type: 'upgrade_right',
          id: 7,
          source: 'single_10ml',
          amount: 43_800,
          lineKey: 't50',
        },
        thresholdBaseAmount: 219_000,
        amountToFreeDelivery: 31_000,
        deliveryFee: 25_000,
        total: 200_200,
      },
    },
  ]);
});

describe('quote(): free-delivery threshold base per discount source', () => {
  // The grilling-session example: 260 000 of items and a discount whose "after" base falls below 250 000.
  const lines260k = [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })];
  runTable([
    {
      name: '260 000 example: an upgrade right under the default "before" base ships free',
      given: { lines: lines260k, entitlements: [setRight(1, [GUIDANCE])] },
      expected: {
        itemsSubtotal: 260_000,
        discount: { type: 'upgrade_right', amount: 26_000 },
        thresholdBase: 'before',
        thresholdBaseAmount: 260_000,
        amountToFreeDelivery: 0,
        deliveryFee: 0,
        total: 234_000,
      },
    },
    {
      name: '260 000 example: the same right under an "after" base pays delivery, and the nudge follows that base',
      given: {
        lines: lines260k,
        entitlements: [setRight(1, [GUIDANCE])],
        settings: {
          ...DEFAULTS,
          thresholdBase: {
            ...DEFAULTS.thresholdBase,
            upgradeRight: { ...DEFAULTS.thresholdBase.upgradeRight, set: 'after' },
          },
        },
      },
      expected: {
        discount: { type: 'upgrade_right', amount: 26_000 },
        thresholdBase: 'after',
        thresholdBaseAmount: 234_000,
        amountToFreeDelivery: 16_000,
        deliveryFee: 25_000,
        total: 259_000,
      },
    },
    {
      name: 'the single 10 ml source has its own base setting',
      given: {
        lines: lines260k,
        entitlements: [tenMlRight(7, GUIDANCE)],
        settings: {
          ...DEFAULTS,
          thresholdBase: {
            ...DEFAULTS.thresholdBase,
            upgradeRight: { ...DEFAULTS.thresholdBase.upgradeRight, single_10ml: 'after' },
          },
        },
      },
      expected: {
        discount: { source: 'single_10ml', amount: 26_000 },
        thresholdBase: 'after',
        deliveryFee: 25_000,
        total: 259_000,
      },
    },
  ]);
});

describe('quote(): the free-delivery nudge is the smallest addition that reaches the threshold', () => {
  // Worst case for the customer: whatever is added is discountable, so a growing discount is counted.
  runTable([
    {
      name: '"after" base, % uncapped: the code grows with what is added, so the nudge exceeds threshold − base',
      given: {
        lines: [
          volume('g10', GUIDANCE, 10, 69_000, { markdown: { price: 60_000, endsAt: null } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        promoCode: percentPromo('BLOGGER10', 10),
      },
      expected: {
        itemsSubtotal: 209_000,
        discount: { amount: 14_900 },
        thresholdBaseAmount: 194_100,
        // +62 111: items 271 111, of which 211 111 eligible → 21 111 off → base 250 000.
        // +62 110 gives 249 999.
        amountToFreeDelivery: 62_111,
        deliveryFee: 25_000,
        total: 219_100,
      },
    },
    {
      name: '"after" base, % reaching its cap on the way: the nudge stops growing at the cap',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 100_000, { qty: 2 })],
        entitlements: [birthday(5, 20, 45_000)],
      },
      expected: {
        discount: { amount: 40_000 },
        thresholdBaseAmount: 160_000,
        // +95 000: items 295 000, 20% = 59 000 capped at 45 000 → base 250 000.
        amountToFreeDelivery: 95_000,
        deliveryFee: 25_000,
        total: 185_000,
      },
    },
    {
      name: '"after" base, % already at its cap: the discount stays put',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 100_000, { qty: 2 })],
        entitlements: [birthday(5, 20, 30_000)],
      },
      expected: {
        discount: { amount: 30_000 },
        thresholdBaseAmount: 170_000,
        amountToFreeDelivery: 80_000,
        total: 195_000,
      },
    },
    {
      name: '"after" base, fixed code within the items: the discount stays put',
      given: {
        lines: [volume('t10', TYGAR, 10, 69_000, { qty: 2 })],
        promoCode: fixedPromo('MINUS50', 50_000),
      },
      expected: {
        discount: { amount: 50_000 },
        thresholdBaseAmount: 88_000,
        amountToFreeDelivery: 162_000,
      },
    },
    {
      name: '"after" base, upgrade right: one unit\u2019s discount does not grow',
      given: {
        lines: [volume('t50', TYGAR, 50, 219_000)],
        entitlements: [setRight(1, [TYGAR])],
        settings: {
          ...DEFAULTS,
          thresholdBase: {
            ...DEFAULTS.thresholdBase,
            upgradeRight: { ...DEFAULTS.thresholdBase.upgradeRight, set: 'after' },
          },
        },
      },
      expected: {
        discount: { amount: 43_800 },
        thresholdBaseAmount: 175_200,
        amountToFreeDelivery: 74_800,
        total: 200_200,
      },
    },
    {
      name: '"before" base: the nudge ignores the discount',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 100_000, { qty: 2 })],
        entitlements: [birthday(5, 20, 100_000)],
        settings: {
          ...DEFAULTS,
          thresholdBase: { ...DEFAULTS.thresholdBase, birthdayCoupon: 'before' },
        },
      },
      expected: {
        discount: { amount: 40_000 },
        thresholdBase: 'before',
        thresholdBaseAmount: 200_000,
        amountToFreeDelivery: 50_000,
        total: 185_000,
      },
    },
  ]);
});

describe('quote(): birthday coupon (ADR 0007, 0008, 0009)', () => {
  runTable([
    {
      name: 'is items × %, sets included',
      given: {
        lines: [set('discovery', 299_000), volume('g10', GUIDANCE, 10, 69_000)],
        entitlements: [birthday(5, 20, 100_000)],
      },
      expected: {
        itemsSubtotal: 368_000,
        discount: { type: 'birthday_coupon', id: 5, amount: 73_600 },
        thresholdBase: 'after',
        thresholdBaseAmount: 294_400,
        deliveryFee: 0,
        total: 294_400,
      },
    },
    {
      name: 'is capped by its max amount',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 3 })],
        entitlements: [birthday(5, 20, 100_000)],
      },
      expected: { itemsSubtotal: 657_000, discount: { amount: 100_000 }, total: 557_000 },
    },
    {
      name: 'skips marked-down items by default',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        entitlements: [birthday(5, 20, 100_000)],
      },
      expected: {
        itemsSubtotal: 324_000,
        discount: { amount: 29_800 },
        thresholdBaseAmount: 294_200,
        deliveryFee: 0,
        total: 294_200,
      },
    },
    {
      name: 'covers marked-down items when the birthday marked-down setting is on',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        entitlements: [birthday(5, 20, 100_000)],
        settings: {
          ...DEFAULTS,
          discountsApplyToMarkedDown: { upgradeRight: false, birthdayCoupon: true },
        },
      },
      expected: { discount: { amount: 64_800 }, deliveryFee: 0, total: 259_200 },
    },
    {
      name: 'does not apply when every item is marked down',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
        ],
        entitlements: [birthday(5, 20, 100_000)],
      },
      expected: { discount: null, alternatives: [], total: 200_000 },
    },
    {
      name: 'is rounded down to a whole so’m',
      given: {
        lines: [volume('t30', TYGAR, 30, 149_999)],
        entitlements: [birthday(5, 15, 100_000)],
      },
      expected: { discount: { amount: 22_499 }, deliveryFee: 25_000, total: 152_500 },
    },
    {
      name: '260 000 example: a coupon under the default "after" base pays delivery',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })],
        entitlements: [birthday(5, 10, 100_000)],
      },
      expected: {
        discount: { type: 'birthday_coupon', amount: 26_000 },
        thresholdBase: 'after',
        thresholdBaseAmount: 234_000,
        // Not 16 000: the coupon grows with what is added. 277 777 − 27 777 = 250 000.
        amountToFreeDelivery: 17_777,
        deliveryFee: 25_000,
        total: 259_000,
      },
    },
    {
      name: '260 000 example: the coupon’s base is a setting, and "before" ships free',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })],
        entitlements: [birthday(5, 10, 100_000)],
        settings: {
          ...DEFAULTS,
          thresholdBase: { ...DEFAULTS.thresholdBase, birthdayCoupon: 'before' },
        },
      },
      expected: {
        thresholdBase: 'before',
        thresholdBaseAmount: 260_000,
        deliveryFee: 0,
        total: 234_000,
      },
    },
  ]);
});

describe('quote(): promo code (ADR 0007, 0008, 0009)', () => {
  runTable([
    {
      name: 'a % code is eligible × %, capped by the code’s max discount',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 2 })],
        promoCode: percentPromo('BLOGGER10', 10, { maxDiscount: 30_000 }),
      },
      expected: {
        itemsSubtotal: 438_000,
        discount: { type: 'promo_code', code: 'BLOGGER10', amount: 30_000 },
        thresholdBase: 'after',
        thresholdBaseAmount: 408_000,
        deliveryFee: 0,
        total: 408_000,
        promoCode: { code: 'BLOGGER10', invalid: null },
      },
    },
    {
      name: 'a % code without a max discount',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 2 })],
        promoCode: percentPromo('BLOGGER10', 10),
      },
      expected: { discount: { amount: 43_800 }, total: 394_200 },
    },
    {
      name: 'a % code is rounded down to a whole so’m',
      given: {
        lines: [volume('t30', TYGAR, 30, 149_999)],
        promoCode: percentPromo('LUMMI15', 15),
      },
      expected: { discount: { amount: 22_499 }, deliveryFee: 25_000, total: 152_500 },
    },
    {
      name: 'a fixed code is min(fixed, eligible)',
      given: {
        lines: [volume('t10', TYGAR, 10, 69_000, { qty: 2 })],
        promoCode: fixedPromo('MINUS50', 50_000),
      },
      expected: {
        discount: { type: 'promo_code', amount: 50_000 },
        thresholdBaseAmount: 88_000,
        deliveryFee: 25_000,
        total: 113_000,
      },
    },
    {
      name: 'a fixed code above the items stops at them; the total never goes negative and delivery stays',
      given: {
        lines: [volume('t10', TYGAR, 10, 69_000)],
        promoCode: fixedPromo('MINUS100', 100_000),
      },
      expected: {
        discount: { amount: 69_000 },
        thresholdBaseAmount: 0,
        // The code grows up to its 100 000 as items are added: 350 000 − 100 000 = 250 000.
        amountToFreeDelivery: 281_000,
        deliveryFee: 25_000,
        total: 25_000,
      },
    },
    {
      name: 'a fixed code stops at the eligible items, leaving marked-down items alone',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t10', TYGAR, 10, 69_000),
        ],
        promoCode: fixedPromo('MINUS100', 100_000),
      },
      expected: { itemsSubtotal: 244_000, discount: { amount: 69_000 }, total: 200_000 },
    },
    {
      name: 'a % code skips marked-down items unless the code allows them',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        promoCode: percentPromo('BLOGGER10', 10),
      },
      expected: { discount: { amount: 14_900 }, deliveryFee: 0, total: 309_100 },
    },
    {
      name: 'a code flagged "applies to marked-down" covers them',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        promoCode: percentPromo('BLOGGER10', 10, { appliesToMarkedDown: true }),
      },
      expected: { discount: { amount: 32_400 }, deliveryFee: 0, total: 291_600 },
    },
    {
      name: 'a code applies to a set',
      given: { lines: [set('discovery', 299_000)], promoCode: percentPromo('BLOGGER10', 10) },
      expected: { discount: { amount: 29_900 }, deliveryFee: 0, total: 269_100 },
    },
    {
      name: 'a marked-down set takes no code without "applies to marked-down"',
      given: {
        lines: [set('discovery', 299_000, { markdown: { price: 249_000, endsAt: TOMORROW } })],
        promoCode: percentPromo('BLOGGER10', 10),
      },
      expected: {
        discount: null,
        deliveryFee: 25_000,
        total: 274_000,
        promoCode: { invalid: { reason: 'no_eligible_items' } },
      },
    },
    {
      name: 'a marked-down set takes a code flagged "applies to marked-down", on its markdown price',
      given: {
        lines: [set('discovery', 299_000, { markdown: { price: 249_000, endsAt: TOMORROW } })],
        promoCode: percentPromo('BLOGGER10', 10, { appliesToMarkedDown: true }),
      },
      expected: {
        discount: { type: 'promo_code', amount: 24_900 },
        thresholdBaseAmount: 224_100,
        deliveryFee: 25_000,
        total: 249_100,
        promoCode: { invalid: null },
      },
    },
    {
      name: 'marked-down items count toward the minimum even when the code skips them',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        promoCode: percentPromo('MIN300', 10, { minOrderTotal: 300_000 }),
      },
      expected: {
        itemsSubtotal: 324_000,
        discount: { type: 'promo_code', amount: 14_900 },
        total: 309_100,
        promoCode: { code: 'MIN300', invalid: null },
      },
    },
    {
      name: 'the minimum is checked on items before discount, so reaching it exactly applies the code',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 125_000, { qty: 2 })],
        promoCode: percentPromo('MIN250', 10, { minOrderTotal: 250_000 }),
      },
      expected: {
        discount: { amount: 25_000 },
        thresholdBaseAmount: 225_000,
        deliveryFee: 25_000,
        total: 250_000,
        promoCode: { code: 'MIN250', invalid: null },
      },
    },
    {
      name: 'below the minimum the code is not applied and says why; delivery does not count toward it',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 249_999)],
        promoCode: percentPromo('MIN250', 10, { minOrderTotal: 250_000 }),
      },
      expected: {
        discount: null,
        deliveryFee: 25_000,
        total: 274_999,
        promoCode: { code: 'MIN250', invalid: { reason: 'below_minimum', minOrderTotal: 250_000 } },
      },
    },
    {
      name: 'a sold-out line does not count toward the minimum',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { soldOut: true }),
          volume('t30', TYGAR, 30, 149_000),
        ],
        promoCode: percentPromo('MIN200', 10, { minOrderTotal: 200_000 }),
      },
      expected: {
        discount: null,
        promoCode: { invalid: { reason: 'below_minimum', minOrderTotal: 200_000 } },
      },
    },
    {
      name: 'with no eligible items the code is not applied and says why',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: TOMORROW } }),
        ],
        promoCode: percentPromo('BLOGGER10', 10),
      },
      expected: {
        discount: null,
        total: 200_000,
        promoCode: { code: 'BLOGGER10', invalid: { reason: 'no_eligible_items' } },
      },
    },
    {
      name: '260 000 example: a code under its default "after" base pays delivery',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })],
        promoCode: fixedPromo('MINUS26', 26_000),
      },
      expected: {
        discount: { amount: 26_000 },
        thresholdBase: 'after',
        thresholdBaseAmount: 234_000,
        amountToFreeDelivery: 16_000,
        deliveryFee: 25_000,
        total: 259_000,
      },
    },
    {
      name: '260 000 example: the code’s base is a setting, and "before" ships free',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })],
        promoCode: fixedPromo('MINUS26', 26_000),
        settings: {
          ...DEFAULTS,
          thresholdBase: { ...DEFAULTS.thresholdBase, promoCode: 'before' },
        },
      },
      expected: { thresholdBase: 'before', deliveryFee: 0, total: 234_000 },
    },
    {
      name: 'a 100% code without a max takes every eligible item but never delivery',
      given: {
        lines: [volume('t10', TYGAR, 10, 69_000)],
        promoCode: percentPromo('GIFT100', 100),
      },
      expected: {
        discount: { type: 'promo_code', amount: 69_000 },
        thresholdBaseAmount: 0,
        deliveryFee: 25_000,
        total: 25_000,
      },
    },
    {
      name: 'a code on marked-down items only, flagged for them, discounts the markdown price and ships by its base',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, {
            qty: 2,
            markdown: { price: 150_000, endsAt: TOMORROW },
          }),
        ],
        promoCode: percentPromo('SALE5', 5, { appliesToMarkedDown: true }),
      },
      // 300 000 of markdown prices, 5% = 15 000; 285 000 after it still reaches 250 000
      expected: {
        itemsSubtotal: 300_000,
        discount: { amount: 15_000 },
        thresholdBaseAmount: 285_000,
        deliveryFee: 0,
        total: 285_000,
      },
    },
  ]);
});

describe('quote(): a code the shop refused before pricing it (ticket #29)', () => {
  const refusals = [
    'unknown',
    'inactive',
    'expired',
    'exhausted',
    'already_used',
    'not_new_customer',
  ] as const;
  it.each(refusals)(
    'a %s code is not applied, says why, and the order is priced as without it',
    (reason) => {
      const q = quote(
        input({
          lines: [volume('t30', TYGAR, 30, 149_000)],
          promoCode: { code: 'BLOGGER10', refused: reason },
        }),
      );
      expect(q).toMatchObject({
        discount: null,
        thresholdBase: 'before',
        deliveryFee: 25_000,
        total: 174_000,
        promoCode: { code: 'BLOGGER10', invalid: { reason } },
        alternatives: [],
        staleChoice: false,
      });
      expect(quoteSchema.parse(q)).toEqual(q);
    },
  );

  runTable([
    {
      name: 'a refused code leaves the automatic choice to the entitlements',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000), volume('t30', TYGAR, 30, 149_000)],
        entitlements: [setRight(7, [GUIDANCE])],
        promoCode: { code: 'GONE', refused: 'expired' },
      },
      expected: {
        discount: { type: 'upgrade_right', id: 7, amount: 43_800 },
        total: 324_200,
        promoCode: { code: 'GONE', invalid: { reason: 'expired' } },
      },
    },
    {
      name: 'a stored switch to the code falls back once the code is refused',
      given: {
        lines: [volume('t30', TYGAR, 30, 149_000)],
        promoCode: { code: 'GONE', refused: 'exhausted' },
        choice: { type: 'promo_code' },
      },
      expected: { discount: null, total: 174_000, staleChoice: true },
    },
  ]);
});

describe('quote(): one discount per order, chosen by ADR 0002', () => {
  // 368 000 of items: a 5% code gives 18 400, the set right 20% of the 50 ml gives 43 800.
  const lines368k = [volume('g50', GUIDANCE, 50, 219_000), volume('g30', GUIDANCE, 30, 149_000)];
  const lines260k = [volume('g30', GUIDANCE, 30, 130_000, { qty: 2 })];
  runTable([
    {
      name: 'an entered code stays applied even when an entitlement is cheaper, which is offered with its total',
      given: {
        lines: lines368k,
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
      },
      expected: {
        discount: { type: 'promo_code', code: 'BLOGGER5', amount: 18_400 },
        deliveryFee: 0,
        total: 349_600,
        alternatives: [
          {
            discount: { type: 'upgrade_right', id: 1, amount: 43_800, lineKey: 'g50' },
            deliveryFee: 0,
            total: 324_200,
            cheaperBy: 25_400,
          },
        ],
        promoCode: { code: 'BLOGGER5', invalid: null },
        staleChoice: false,
      },
    },
    {
      name: 'an entered code wins over a cheaper birthday coupon, which is offered with its total (#30)',
      given: {
        lines: lines368k,
        entitlements: [birthday(5, 20, 100_000)],
        promoCode: percentPromo('BLOGGER5', 5),
      },
      expected: {
        discount: { type: 'promo_code', code: 'BLOGGER5', amount: 18_400 },
        deliveryFee: 0,
        total: 349_600,
        alternatives: [
          {
            discount: { type: 'birthday_coupon', id: 5, amount: 73_600 },
            deliveryFee: 0,
            total: 294_400,
            cheaperBy: 55_200,
          },
        ],
      },
    },
    {
      name: 'without a code the birthday coupon is picked by itself when it lowers the total (#30)',
      given: { lines: lines368k, entitlements: [birthday(5, 20, 100_000)] },
      expected: {
        discount: { type: 'birthday_coupon', id: 5, amount: 73_600 },
        deliveryFee: 0,
        total: 294_400,
        alternatives: [],
        staleChoice: false,
      },
    },
    {
      name: 'an entered valid code stays applied even when it costs more than no discount',
      given: { lines: lines260k, promoCode: fixedPromo('MINUS13', 13_000) },
      expected: {
        discount: { type: 'promo_code', code: 'MINUS13', amount: 13_000 },
        thresholdBaseAmount: 247_000,
        deliveryFee: 25_000,
        total: 272_000,
        alternatives: [],
        promoCode: { code: 'MINUS13', invalid: null },
      },
    },
    {
      name: 'alternatives are listed cheapest first',
      given: {
        lines: lines368k,
        entitlements: [birthday(5, 10, 100_000), setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
      },
      expected: {
        discount: { type: 'promo_code' },
        total: 349_600,
        alternatives: [
          { discount: { type: 'upgrade_right', id: 1 }, total: 324_200, cheaperBy: 25_400 },
          {
            discount: { type: 'birthday_coupon', id: 5, amount: 36_800 },
            total: 331_200,
            cheaperBy: 18_400,
          },
        ],
      },
    },
    {
      name: 'without a code, the lowest total including delivery wins, even with the smaller discount',
      given: {
        lines: lines260k,
        entitlements: [birthday(5, 15, 100_000), setRight(1, [GUIDANCE])],
      },
      expected: {
        discount: { type: 'upgrade_right', id: 1, amount: 26_000 },
        deliveryFee: 0,
        total: 234_000,
        alternatives: [
          {
            discount: { type: 'birthday_coupon', id: 5, amount: 39_000 },
            deliveryFee: 25_000,
            total: 246_000,
            cheaperBy: 0,
          },
        ],
      },
    },
    {
      name: 'when delivery is free either way, the larger discount wins',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 3 })],
        entitlements: [setRight(1, [GUIDANCE]), birthday(5, 20, 100_000)],
      },
      expected: {
        discount: { type: 'birthday_coupon', id: 5, amount: 100_000 },
        total: 557_000,
        alternatives: [
          { discount: { type: 'upgrade_right', id: 1 }, total: 613_200, cheaperBy: 0 },
        ],
      },
    },
    {
      name: 'of several upgrade rights, the one giving the lowest total wins',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 149_000), volume('t50', TYGAR, 50, 219_000)],
        entitlements: [setRight(1, [GUIDANCE]), setRight(2, [TYGAR])],
      },
      expected: {
        discount: { type: 'upgrade_right', id: 2, amount: 43_800, lineKey: 't50' },
        total: 324_200,
        alternatives: [{ discount: { id: 1, amount: 29_800 }, total: 338_200 }],
      },
    },
    {
      name: 'equal totals go to the entitlement that expires first',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [
          setRight(1, [GUIDANCE], { expiresAt: IN_20_DAYS }),
          setRight(2, [GUIDANCE], { expiresAt: IN_10_DAYS }),
        ],
      },
      expected: {
        discount: { type: 'upgrade_right', id: 2 },
        total: 200_200,
        alternatives: [{ discount: { id: 1 }, total: 200_200, cheaperBy: 0 }],
      },
    },
    {
      name: 'equal totals and expiries go to the lowest id, whatever the input order (shuffled)',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [
          setRight(3, [GUIDANCE], { expiresAt: IN_10_DAYS }),
          setRight(1, [GUIDANCE], { expiresAt: IN_20_DAYS }),
          setRight(2, [GUIDANCE], { expiresAt: IN_10_DAYS }),
        ],
      },
      expected: {
        discount: { type: 'upgrade_right', id: 2 },
        alternatives: [{ discount: { id: 3 } }, { discount: { id: 1 } }],
      },
    },
    {
      name: 'equal totals and expiries go to the lowest id, whatever the input order (in another order)',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [
          setRight(2, [GUIDANCE], { expiresAt: IN_10_DAYS }),
          setRight(3, [GUIDANCE], { expiresAt: IN_10_DAYS }),
          setRight(1, [GUIDANCE], { expiresAt: IN_20_DAYS }),
        ],
      },
      expected: {
        discount: { type: 'upgrade_right', id: 2 },
        alternatives: [{ discount: { id: 3 } }, { discount: { id: 1 } }],
      },
    },
    {
      name: 'an entitlement that would raise the total (delivery comes back) is left unused and offered',
      given: { lines: lines260k, entitlements: [birthday(5, 5, 100_000)] },
      expected: {
        discount: null,
        deliveryFee: 0,
        total: 260_000,
        alternatives: [
          {
            discount: { type: 'birthday_coupon', id: 5, amount: 13_000 },
            deliveryFee: 25_000,
            total: 272_000,
            cheaperBy: 0,
          },
        ],
      },
    },
    {
      name: 'an entitlement that only matches the total without a discount is left unused',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 125_000, { qty: 2 })],
        entitlements: [birthday(5, 10, 100_000)],
      },
      expected: {
        discount: null,
        total: 250_000,
        alternatives: [{ discount: { amount: 25_000 }, total: 250_000 }],
      },
    },
    {
      name: 'an invalid code never blocks: the automatic choice applies an entitlement',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 249_999)],
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('MIN250', 10, { minOrderTotal: 250_000 }),
      },
      expected: {
        discount: { type: 'upgrade_right', amount: 49_999 },
        deliveryFee: 25_000,
        total: 225_000,
        alternatives: [],
        promoCode: { code: 'MIN250', invalid: { reason: 'below_minimum' } },
      },
    },
    {
      name: 'the customer’s chosen entitlement replaces an entered code, which stays offered',
      given: {
        lines: lines368k,
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
        choice: { type: 'upgrade_right', id: 1 },
      },
      expected: {
        discount: { type: 'upgrade_right', id: 1, amount: 43_800 },
        total: 324_200,
        alternatives: [
          {
            discount: { type: 'promo_code', code: 'BLOGGER5', amount: 18_400 },
            deliveryFee: 0,
            total: 349_600,
            cheaperBy: 0,
          },
        ],
        promoCode: { code: 'BLOGGER5', invalid: null },
        staleChoice: false,
      },
    },
    {
      name: 'the customer can switch back to the entered code',
      given: {
        lines: lines368k,
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
        choice: { type: 'promo_code' },
      },
      expected: {
        discount: { type: 'promo_code', amount: 18_400 },
        total: 349_600,
        alternatives: [{ discount: { type: 'upgrade_right' }, cheaperBy: 25_400 }],
        staleChoice: false,
      },
    },
    {
      name: 'the customer can choose a costlier entitlement',
      given: {
        lines: lines260k,
        entitlements: [birthday(5, 15, 100_000), setRight(1, [GUIDANCE])],
        choice: { type: 'birthday_coupon', id: 5 },
      },
      expected: {
        discount: { type: 'birthday_coupon', id: 5, amount: 39_000 },
        deliveryFee: 25_000,
        total: 246_000,
        alternatives: [
          { discount: { type: 'upgrade_right', id: 1 }, total: 234_000, cheaperBy: 12_000 },
        ],
        staleChoice: false,
      },
    },
    {
      name: 'a chosen entitlement the customer no longer holds falls back to the automatic choice and says so',
      given: {
        lines: lines260k,
        entitlements: [birthday(5, 15, 100_000), setRight(1, [GUIDANCE])],
        choice: { type: 'upgrade_right', id: 99 },
      },
      expected: { discount: { type: 'upgrade_right', id: 1 }, total: 234_000, staleChoice: true },
    },
    {
      name: 'a chosen entitlement that no longer discounts this cart falls back and says so',
      given: {
        lines: [volume('t50', TYGAR, 50, 219_000)],
        entitlements: [setRight(1, [GUIDANCE]), birthday(5, 20, 100_000)],
        choice: { type: 'upgrade_right', id: 1 },
      },
      expected: {
        discount: { type: 'birthday_coupon', id: 5, amount: 43_800 },
        total: 200_200,
        alternatives: [],
        staleChoice: true,
      },
    },
    {
      name: 'choosing the code when none is entered falls back and says so',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [setRight(1, [GUIDANCE])],
        choice: { type: 'promo_code' },
      },
      expected: { discount: { type: 'upgrade_right', id: 1 }, promoCode: null, staleChoice: true },
    },
    {
      name: '«не применять» (#39): no discount, every option offered with its total, the entitlement kept',
      given: {
        lines: lines260k,
        entitlements: [birthday(5, 15, 100_000), setRight(1, [GUIDANCE])],
        choice: { type: 'none' },
      },
      expected: {
        discount: null,
        thresholdBase: 'before',
        deliveryFee: 0,
        total: 260_000,
        alternatives: [
          { discount: { type: 'upgrade_right', id: 1 }, total: 234_000, cheaperBy: 26_000 },
          {
            discount: { type: 'birthday_coupon', id: 5 },
            deliveryFee: 25_000,
            total: 246_000,
            cheaperBy: 14_000,
          },
        ],
        withoutDiscount: { deliveryFee: 0, total: 260_000 },
        staleChoice: false,
      },
    },
    {
      name: '«не применять» keeps an entered valid code out too; it stays offered and is not refused',
      given: {
        lines: lines368k,
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
        choice: { type: 'none' },
      },
      expected: {
        discount: null,
        total: 368_000,
        alternatives: [
          { discount: { type: 'upgrade_right', id: 1 }, total: 324_200, cheaperBy: 43_800 },
          { discount: { type: 'promo_code', code: 'BLOGGER5' }, total: 349_600, cheaperBy: 18_400 },
        ],
        promoCode: { code: 'BLOGGER5', invalid: null },
        staleChoice: false,
      },
    },
    {
      name: '«не применять» with nothing to keep is no discount, and nothing is stale',
      given: { lines: lines260k, choice: { type: 'none' } },
      expected: { discount: null, total: 260_000, alternatives: [], staleChoice: false },
    },
    {
      name: 'the total without any discount comes with every quote, for «не применять» (#39)',
      given: {
        lines: lines368k,
        entitlements: [setRight(1, [GUIDANCE])],
        promoCode: percentPromo('BLOGGER5', 5),
      },
      expected: {
        discount: { type: 'promo_code' },
        total: 349_600,
        withoutDiscount: { deliveryFee: 0, total: 368_000 },
      },
    },
    {
      name: 'without a discount delivery may come back: the code that brought it costs more than none',
      given: { lines: lines260k, promoCode: fixedPromo('MINUS13', 13_000) },
      expected: {
        total: 272_000,
        withoutDiscount: { deliveryFee: 0, total: 260_000 },
      },
    },
    {
      name: 'choosing a code that is now below its minimum falls back and says why',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000)],
        entitlements: [birthday(5, 20, 100_000)],
        promoCode: percentPromo('MIN250', 10, { minOrderTotal: 250_000 }),
        choice: { type: 'promo_code' },
      },
      expected: {
        discount: { type: 'birthday_coupon', id: 5 },
        promoCode: { invalid: { reason: 'below_minimum', minOrderTotal: 250_000 } },
        staleChoice: true,
      },
    },
  ]);
});

describe('quote(): a gift code adds a free line, not a price cut (ADR 0039)', () => {
  const g50 = volume('g50', GUIDANCE, 50, 219_000);
  runTable([
    {
      name: 'a gift applies: nothing comes off the paid items, the discount carries the gift at its regular price',
      given: { lines: [g50], promoCode: giftPromo('RAINTEA') },
      expected: {
        lines: [{ key: 'g50', lineTotal: 219_000 }],
        itemsSubtotal: 219_000,
        discount: {
          type: 'promo_code',
          code: 'RAINTEA',
          amount: 0,
          promoGift: { item: { kind: 'volume', volumeId: 70 }, value: 69_000 },
        },
        thresholdBaseAmount: 219_000,
        amountToFreeDelivery: 31_000,
        deliveryFee: 25_000,
        total: 244_000,
        promoCode: { code: 'RAINTEA', invalid: null },
        withoutDiscount: { deliveryFee: 25_000, total: 244_000 },
      },
    },
    {
      name: 'the Discovery set as the gift',
      given: {
        lines: [g50],
        promoCode: giftPromo('DISCOVERY', { item: { kind: 'discovery_set' }, regular: 199_000 }),
      },
      expected: {
        itemsSubtotal: 219_000,
        discount: { amount: 0, promoGift: { item: { kind: 'discovery_set' }, value: 199_000 } },
        total: 244_000,
      },
    },
    {
      name: 'the minimum counts the paid items only: 219 000 + a 69 000 gift is still below 250 000',
      given: { lines: [g50], promoCode: giftPromo('RAINTEA', { minOrderTotal: 250_000 }) },
      expected: {
        discount: null,
        promoCode: { invalid: { reason: 'below_minimum', minOrderTotal: 250_000 } },
        total: 244_000,
      },
    },
    {
      name: 'paid items at the minimum take the gift',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 125_000, { qty: 2 })],
        promoCode: giftPromo('RAINTEA', { minOrderTotal: 250_000 }),
      },
      expected: { discount: { promoGift: { value: 69_000 } }, deliveryFee: 0, total: 250_000 },
    },
    {
      name: 'a gift with none left refuses the code: «Подарок закончился», the order is priced without it',
      given: { lines: [g50], promoCode: giftPromo('RAINTEA', { soldOut: true }) },
      expected: {
        discount: null,
        promoCode: { code: 'RAINTEA', invalid: { reason: 'gift_sold_out' } },
        total: 244_000,
      },
    },
    {
      name: 'a sold-out gift is said before the minimum: adding items will not bring it back',
      given: {
        lines: [g50],
        promoCode: giftPromo('RAINTEA', { soldOut: true, minOrderTotal: 250_000 }),
      },
      expected: { discount: null, promoCode: { invalid: { reason: 'gift_sold_out' } } },
    },
    {
      name: 'nothing paid for (every line sold out) takes no gift, and says the gift needs items',
      given: {
        lines: [volume('g50', GUIDANCE, 50, 219_000, { soldOut: true })],
        promoCode: giftPromo('RAINTEA'),
      },
      expected: {
        discount: null,
        promoCode: { invalid: { reason: 'gift_needs_items' } },
        total: 0,
      },
    },
    {
      name: 'a marked-down item neither blocks nor changes the gift (it cuts no item’s price)',
      given: {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 175_000, endsAt: null } }),
        ],
        promoCode: giftPromo('RAINTEA'),
      },
      expected: {
        lines: [{ key: 'g50', unitPrice: 175_000, markedDown: true, lineTotal: 175_000 }],
        itemsSubtotal: 175_000,
        discount: { type: 'promo_code', amount: 0, promoGift: { value: 69_000 } },
        total: 200_000,
      },
    },
    {
      name: 'delivery: the gift adds nothing to the threshold base, so 240 000 paid still pays delivery',
      given: {
        lines: [volume('a', TYGAR, 50, 240_000)],
        promoCode: giftPromo('RAINTEA'),
      },
      expected: {
        itemsSubtotal: 240_000,
        thresholdBaseAmount: 240_000,
        amountToFreeDelivery: 10_000,
        deliveryFee: 25_000,
        total: 265_000,
      },
    },
    {
      name: 'delivery: under a "before" promo base the gift still adds nothing',
      given: {
        lines: [volume('a', TYGAR, 50, 240_000)],
        promoCode: giftPromo('RAINTEA'),
        settings: {
          ...DEFAULTS,
          thresholdBase: { ...DEFAULTS.thresholdBase, promoCode: 'before' },
        },
      },
      expected: {
        thresholdBase: 'before',
        thresholdBaseAmount: 240_000,
        amountToFreeDelivery: 10_000,
        deliveryFee: 25_000,
        total: 265_000,
      },
    },
    {
      name: 'delivery: paid items at the threshold ship free with the gift',
      given: {
        lines: [volume('g30', GUIDANCE, 30, 125_000, { qty: 2 })],
        promoCode: giftPromo('RAINTEA'),
      },
      expected: {
        thresholdBaseAmount: 250_000,
        amountToFreeDelivery: 0,
        deliveryFee: 0,
        total: 250_000,
      },
    },
    {
      name: 'an entered gift code wins over a better upgrade right, which is offered with what it saves',
      given: {
        lines: [g50],
        entitlements: [setRight(7, [GUIDANCE])],
        promoCode: giftPromo('RAINTEA'),
      },
      expected: {
        discount: { type: 'promo_code', code: 'RAINTEA', amount: 0, promoGift: { value: 69_000 } },
        total: 244_000,
        alternatives: [
          {
            discount: { type: 'upgrade_right', id: 7, amount: 43_800 },
            deliveryFee: 25_000,
            total: 200_200,
            cheaperBy: 43_800,
          },
        ],
        staleChoice: false,
      },
    },
    {
      name: 'switching to the upgrade right drops the gift: one discount per order',
      given: {
        lines: [g50],
        entitlements: [setRight(7, [GUIDANCE])],
        promoCode: giftPromo('RAINTEA'),
        choice: { type: 'upgrade_right', id: 7 },
      },
      expected: {
        discount: { type: 'upgrade_right', id: 7, amount: 43_800 },
        total: 200_200,
        alternatives: [
          {
            discount: { type: 'promo_code', code: 'RAINTEA', amount: 0 },
            total: 244_000,
            cheaperBy: 0,
          },
        ],
      },
    },
  ]);

  it('refuses a gift price with tiyin', () => {
    expect(() =>
      quote(input({ lines: [g50], promoCode: giftPromo('RAINTEA', { regular: 69_000.5 }) })),
    ).toThrow(RangeError);
  });
});

describe('quote(): integer so’m only (ADR 0016)', () => {
  const g50 = volume('g50', GUIDANCE, 50, 219_000);
  it.each<[string, Partial<QuoteInput>]>([
    ['a price with tiyin', { lines: [volume('g50', GUIDANCE, 50, 219_000.5)] }],
    [
      'a markdown price with tiyin',
      {
        lines: [
          volume('g50', GUIDANCE, 50, 219_000, { markdown: { price: 174_999.9, endsAt: null } }),
        ],
      },
    ],
    ['a negative price', { lines: [volume('g50', GUIDANCE, 50, -1)] }],
    ['a fractional quantity', { lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 1.5 })] }],
    ['a zero quantity', { lines: [volume('g50', GUIDANCE, 50, 219_000, { qty: 0 })] }],
    ['a delivery tariff with tiyin', { lines: [g50], deliveryTariff: 25_000.5 }],
    [
      'a fractional percentage',
      { lines: [g50], entitlements: [setRight(1, [GUIDANCE], { percent: 12.5 })] },
    ],
    ['a percentage above 100', { lines: [g50], promoCode: percentPromo('X', 101) }],
    ['a birthday cap with tiyin', { lines: [g50], entitlements: [birthday(5, 20, 99_999.5)] }],
    ['a fixed promo with tiyin', { lines: [g50], promoCode: fixedPromo('X', 10_000.5) }],
    [
      'a promo max discount with tiyin',
      { lines: [g50], promoCode: percentPromo('X', 10, { maxDiscount: 0.5 }) },
    ],
    [
      'a promo minimum with tiyin',
      { lines: [g50], promoCode: percentPromo('X', 10, { minOrderTotal: 0.5 }) },
    ],
    [
      'a threshold with tiyin',
      { lines: [g50], settings: { ...DEFAULTS, freeDeliveryThreshold: 250_000.5 } },
    ],
  ])('refuses %s', (_name, given) => {
    expect(() => quote(input(given))).toThrow(RangeError);
  });
});

describe('pricing settings', () => {
  it('refuses 10 ml as a Full size volume, which would let an upgrade right discount a 10 ml', () => {
    const fullSize = settingDefinitions['pricing.fullSizeVolumesMl'].schema;
    expect(fullSize.safeParse([10, 30, 50]).success).toBe(false);
    expect(fullSize.safeParse([30, 50]).success).toBe(true);
    expect(fullSize.safeParse([50]).success).toBe(true);
  });
});
