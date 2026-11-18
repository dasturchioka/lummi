import { describe, expect, it } from 'vitest';
import { lineUnitCost, saleProfit } from '../src/cost/order-costs';
import { defaultCostSettings, type CostSettings } from '../src/cost/unit-cost';

/**
 * Seam 2 (ADR 0028): an order's costs and profit (#77), the customer's calculator's `orderCosts`.
 * Every expected figure is the calculator's own (`saleProfit(revenue, goods, chan, gift)` run on
 * its `P0`, and once on other values), each rounded to whole so'm as it shows them. Goods are whole
 * so'm here, as an order freezes them (the unit cost's total, ADR 0040).
 */

const P0 = defaultCostSettings();
const OTHER: CostSettings = {
  ...P0,
  order: {
    ...P0.order,
    mailer: 2500,
    btsCharge: 30_000,
    adPerSale: 4000,
    taxPercent: 1.5,
    onlinePaymentPercent: 2.5,
    uzumCommissionPercent: 18.5,
  },
};

describe("an order's costs (the cost model's `orderCosts`, with the order's own delivery fee)", () => {
  it('Mini App below the free-delivery threshold: the customer paid the delivery, so BTS costs nothing more', () => {
    expect(
      saleProfit(
        { channel: 'miniapp', revenue: 69_000, goods: 22_462, deliveryPaid: 25_000, giftSample: 0 },
        P0,
      ),
    ).toEqual({
      channel: 'miniapp',
      revenue: 69_000,
      goods: 22_462,
      mailer: 2000,
      btsCharge: 25_000,
      deliveryPaid: 25_000,
      commissionPercent: 0,
      commission: 0,
      adPerSale: 3000,
      taxPercent: 1,
      tax: 690,
      giftSample: 0,
      cost: 28_152,
      profit: 40_848,
      margin: 40_848 / 69_000,
    });
  });

  it('Mini App from the threshold: delivery is free for the customer, the shop pays BTS', () => {
    const c = saleProfit(
      { channel: 'miniapp', revenue: 299_000, goods: 90_490, deliveryPaid: 0, giftSample: 0 },
      P0,
    );
    expect(c).toMatchObject({ btsCharge: 25_000, deliveryPaid: 0, tax: 2990, cost: 123_480 });
    expect(c.profit).toBe(175_520);
  });

  it('Uzum: its commission, no mailer and no delivery', () => {
    const c = saleProfit(
      { channel: 'uzum', revenue: 189_000, goods: 52_086, deliveryPaid: 25_000, giftSample: 0 },
      P0,
    );
    expect(c).toMatchObject({
      mailer: 0,
      btsCharge: 0,
      deliveryPaid: 0,
      commissionPercent: 20.5,
      commission: 38_745,
      adPerSale: 3000,
      tax: 1890,
      cost: 95_721,
      profit: 93_279,
    });
  });

  it('a gift sample adds its cost', () => {
    const c = saleProfit(
      {
        channel: 'miniapp',
        revenue: 69_000,
        goods: 22_462,
        deliveryPaid: 25_000,
        giftSample: 11_222,
      },
      P0,
    );
    expect([c.giftSample, c.cost, c.profit]).toEqual([11_222, 39_374, 29_626]);
  });

  it('other settings: percentages of revenue rounded half up, each on its own', () => {
    // the calculator: commission 1 749.75, tax 1 049.85, profit 33 228.4
    expect(
      saleProfit(
        { channel: 'miniapp', revenue: 69_990, goods: 22_462, deliveryPaid: 25_000, giftSample: 0 },
        OTHER,
      ),
    ).toMatchObject({
      mailer: 2500,
      btsCharge: 30_000,
      commissionPercent: 2.5,
      commission: 1750,
      adPerSale: 4000,
      taxPercent: 1.5,
      tax: 1050,
      cost: 36_762,
      profit: 33_228,
    });
    // Uzum: commission 12 948.15, tax 1 049.85, profit 29 530
    expect(
      saleProfit(
        { channel: 'uzum', revenue: 69_990, goods: 22_462, deliveryPaid: 0, giftSample: 0 },
        OTHER,
      ),
    ).toMatchObject({ commission: 12_948, tax: 1050, cost: 40_460, profit: 29_530 });
  });

  it('a delivery fee above the BTS charge is income: the delivery cost goes below zero', () => {
    const c = saleProfit(
      { channel: 'miniapp', revenue: 69_000, goods: 22_462, deliveryPaid: 30_000, giftSample: 0 },
      P0,
    );
    expect([c.cost, c.profit]).toEqual([23_152, 45_848]);
  });

  it('no revenue (a 100 % code): no margin, the costs are a loss', () => {
    const c = saleProfit(
      { channel: 'miniapp', revenue: 0, goods: 22_462, deliveryPaid: 25_000, giftSample: 0 },
      P0,
    );
    expect([c.tax, c.cost, c.profit, c.margin]).toEqual([0, 27_462, -27_462, null]);
  });
});

describe("a line's unit cost (the order's goods)", () => {
  const s = defaultCostSettings();
  const oil = new Map([
    [1, 3950],
    [2, 2150],
    [3, 9150],
    [4, 2050],
    [5, 2450],
    [6, null],
  ]);
  const of = (id: number) => oil.get(id) ?? null;

  it('a bottle: the unit table total for its oil price and volume', () => {
    expect(lineUnitCost({ kind: 'volume', fragranceId: 1, ml: 30 }, of, s)).toEqual({
      unitCost: 52_086,
      missing: [],
    });
    expect(lineUnitCost({ kind: 'volume', fragranceId: 3, ml: 10 }, of, s).unitCost).toBe(37_824);
  });

  it('a set: its five vials, one set box and one card (`setCost`)', () => {
    const set = { kind: 'set' as const, ml: 10, fragranceIds: [1, 2, 3, 4, 5] };
    expect(lineUnitCost(set, of, s)).toEqual({ unitCost: 87_831, missing: [] });
  });

  it('no oil price, no cost: the fragrance is named', () => {
    expect(lineUnitCost({ kind: 'volume', fragranceId: 6, ml: 50 }, of, s)).toEqual({
      unitCost: null,
      missing: [6],
    });
    const set = { kind: 'set' as const, ml: 10, fragranceIds: [1, 2, 6, 4, 5] };
    expect(lineUnitCost(set, of, s)).toEqual({ unitCost: null, missing: [6] });
  });

  it('a volume the model has no cost for (no such bottle) has none', () => {
    expect(lineUnitCost({ kind: 'volume', fragranceId: 1, ml: 100 }, of, s).unitCost).toBeNull();
  });
});
