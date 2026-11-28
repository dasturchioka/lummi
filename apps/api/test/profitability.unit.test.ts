import { describe, expect, it } from 'vitest';
import type { SalesChannel } from '@lummi/contracts';
import { costSale, type SaleContext, type SaleLine } from '../src/profitability/cost-sale';
import { bottleCost, defaultCostSettings, giftSampleCost, setCost } from '../src/cost/unit-cost';
import type { PricingSettings } from '../src/pricing/quote';

/**
 * Seam 2 (ADR 0028): the «Рентабельность» page's sale (#77) against the customer's calculator at
 * its default settings. Every expected profit is the calculator's own «Все ароматы» figure
 * (`single(scent, volume, channel, gift, coupon)`, and its set), rounded to whole so'm as it shows
 * it, for the made-up oil prices below; the prices and delivery are the calculator's `P0`.
 */
const S = defaultCostSettings();
/** Made-up oil prices, so'm per gram before the supplier discount (A, B, C: the unit table's). */
const OIL = { A: 3950, B: 2150, C: 9150, D: 2650, E: 2750 } as const;
type Scent = keyof typeof OIL;
const PRICE = { 10: 69_000, 30: 189_000, 50: 249_000 } as const;
const SET_PRICE = 299_000;

const PRICING: PricingSettings = {
  freeDeliveryThreshold: 250_000,
  thresholdBase: {
    upgradeRight: { set: 'before', single_10ml: 'before' },
    promoCode: 'after',
    birthdayCoupon: 'after',
  },
  discountsApplyToMarkedDown: { upgradeRight: false, birthdayCoupon: false },
  fullSizeVolumesMl: [30, 50],
  setDiscountScope: 'set_fragrances',
};
const GIFT = giftSampleCost(Object.values(OIL), S)!;

function ctx(channel: SalesChannel, over: Partial<SaleContext> = {}): SaleContext {
  return {
    channel,
    afterSetDiscountPercent: null,
    giftSample: null,
    deliveryTariff: 25_000,
    pricing: PRICING,
    cost: S,
    now: new Date('2026-11-19T05:00:00Z'),
    ...over,
  };
}

const bottle = (scent: Scent, ml: 10 | 30 | 50, qty = 1): SaleLine => ({
  item: { kind: 'volume', fragranceId: Object.keys(OIL).indexOf(scent) + 1, ml },
  name: scent,
  brand: null,
  ml,
  qty,
  price: { regular: PRICE[ml], markdown: null },
  unitCost: bottleCost(OIL[scent], ml, S),
});

const SET: SaleLine = {
  item: { kind: 'discovery_set' },
  name: 'Discovery',
  brand: null,
  ml: 10,
  qty: 1,
  price: { regular: SET_PRICE, markdown: null },
  unitCost: setCost(Object.values(OIL), 10, S),
};

/**
 * The calculator's «Все ароматы» profit for one bottle: plain, «с пробником», «после набора».
 * Mini App («app») and Uzum.
 */
const CALCULATOR: Record<string, [plain: number, gift: number, afterSet: number]> = {
  A10app: [40848, 29626, 40848],
  A10uzum: [28703, 17481, 28703],
  A30app: [130024, 118802, 92602],
  A30uzum: [93279, 82057, 63606],
  A50app: [162859, 151637, 113557],
  A50uzum: [113814, 102592, 74721],
  B10app: [46165, 34943, 46165],
  B10uzum: [34020, 22798, 34020],
  B30app: [145976, 134754, 108554],
  B30uzum: [109231, 98009, 79558],
  B50app: [189447, 178225, 140145],
  B50uzum: [140402, 129180, 101309],
  C10app: [25486, 14264, 25486],
  C10uzum: [13341, 2119, 13341],
  C30app: [83938, 72716, 46516],
  C30uzum: [47193, 35971, 17520],
  C50app: [86051, 74829, 36749],
  // a loss on Uzum after the set's discount
  C50uzum: [37006, 25784, -2087],
  D10app: [44688, 33466, 44688],
  D10uzum: [32543, 21321, 32543],
  D30app: [141545, 130323, 104123],
  D30uzum: [104800, 93578, 75127],
  D50app: [182061, 170839, 132759],
  D50uzum: [133016, 121794, 93923],
  E10app: [44393, 33171, 44393],
  E10uzum: [32248, 21026, 32248],
  E30app: [140659, 129437, 103237],
  E30uzum: [103914, 92692, 74241],
  E50app: [180584, 169362, 131282],
  E50uzum: [131539, 120317, 92446],
};

const CHANNEL: Record<string, SalesChannel> = { app: 'miniapp', uzum: 'uzum' };

describe("one bottle's profit equals the calculator's «Все ароматы» at its defaults", () => {
  const cases = Object.entries(CALCULATOR).map(([key, figures]) => {
    const [, scent, ml, chan] = /^([A-E])(\d+)(app|uzum)$/.exec(key)!;
    return [key, scent as Scent, Number(ml) as 10 | 30 | 50, CHANNEL[chan!]!, figures] as const;
  });

  it.each(cases)('%s', (_key, scent, ml, channel, [plain, gift, afterSet]) => {
    const line = bottle(scent, ml);
    expect(costSale([line], ctx(channel)).profit?.profit).toBe(plain);
    expect(costSale([line], ctx(channel, { giftSample: GIFT })).profit?.profit).toBe(gift);
    expect(costSale([line], ctx(channel, { afterSetDiscountPercent: 20 })).profit?.profit).toBe(
      afterSet,
    );
  });

  it('the gift sample is the average 5 ml vial over the fragrances, plus a card', () => {
    // the calculator: 11 221.95
    expect(GIFT).toBe(11_222);
  });
});

describe('the Discovery set: its five vials, one box and one card, at its own price', () => {
  it('on the Mini App (from the free-delivery threshold) and on Uzum', () => {
    // the calculator: Discovery Set 5×10 мл, 299 000, these five
    expect(costSale([SET], ctx('miniapp')).profit).toMatchObject({
      revenue: 299_000,
      goods: 90_490,
      deliveryPaid: 0,
      btsCharge: 25_000,
      profit: 175_520,
    });
    expect(costSale([SET], ctx('uzum')).profit?.profit).toBe(141_225);
    // no after-set discount on a set (sets are never Full size)
    expect(costSale([SET], ctx('miniapp', { afterSetDiscountPercent: 20 })).discount).toBe(0);
  });
});

describe('the order simulator prices as the shop does', () => {
  it('delivery is the tariff below the threshold and free from it', () => {
    const below = costSale([bottle('A', 10), bottle('B', 10)], ctx('miniapp'));
    expect([below.itemsSubtotal, below.deliveryFee, below.amountToFreeDelivery]).toEqual([
      138_000, 25_000, 112_000,
    ]);
    const above = costSale([bottle('A', 50), bottle('B', 10)], ctx('miniapp'));
    expect([above.deliveryFee, above.amountToFreeDelivery]).toEqual([0, 0]);
    // the calculator's order screen: 318 000, goods 78 650.75 + 17 144.62, profit 189 024.63
    expect(above.profit).toMatchObject({
      revenue: 318_000,
      goods: 78_651 + 17_145,
      profit: 189_024,
    });
  });

  it('one upgrade right takes one Full size bottle, the dearest (ADR 0007), not each one', () => {
    const sale = costSale(
      [bottle('A', 30), bottle('B', 50)],
      ctx('miniapp', { afterSetDiscountPercent: 20 }),
    );
    expect(sale.discount).toBe(49_800);
    expect(sale.profit?.revenue).toBe(189_000 + 249_000 - 49_800);
  });

  it('Uzum has no delivery and no markdown', () => {
    const marked: SaleLine = {
      ...bottle('A', 30),
      price: { regular: 189_000, markdown: { price: 150_000, endsAt: null } },
    };
    const uzum = costSale([marked], ctx('uzum'));
    expect([uzum.lines[0]!.unitPrice, uzum.deliveryFee, uzum.profit?.mailer]).toEqual([
      189_000, 0, 0,
    ]);
    expect(costSale([marked], ctx('miniapp')).lines[0]!.unitPrice).toBe(150_000);
  });

  it('a line without a unit cost leaves the sale without costs', () => {
    const unknown: SaleLine = { ...bottle('A', 30), unitCost: null };
    const sale = costSale([bottle('B', 10), unknown], ctx('miniapp'));
    expect(sale.profit).toBeNull();
    expect(sale.itemsSubtotal).toBe(69_000 + 189_000);
  });
});
