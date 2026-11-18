import { describe, expect, it } from 'vitest';
import { planPurchase, type PlanFragrance, type PlanSettings } from '../src/cost/purchase-plan';
import { defaultCostSettings } from '../src/cost/unit-cost';

/**
 * Seam 2 (ADR 0028): the purchase planner (#78). Every expected figure is the customer's
 * calculator itself: its `buyCalc` run on its own `P0` (and once on other values) over four
 * fragrances with made-up oil prices, each figure rounded to whole so'm. Never recomputed here.
 * The calculator prices every fragrance at one list, so each fragrance here has those prices.
 */
const LIST = { 10: 69_000, 30: 189_000, 50: 249_000 };
const frag = (id: number, name: string, oilPrice: number, oilKg: number): PlanFragrance => ({
  id,
  name,
  brand: 'Maison Test',
  oilPrice,
  prices: LIST,
  oilKg,
  overridden: false,
});
const four = (kg: number) => [
  frag(1, 'A', 2_000, kg),
  frag(2, 'B', 3_500, kg),
  frag(3, 'C', 5_000, kg),
  frag(4, 'D', 8_000, kg),
];

/** The calculator's own defaults for the planner and the settings of other areas it reads. */
const defaults: PlanSettings = {
  shares: { 10: 30, 30: 40, 50: 30 },
  avgDiscountPercent: 15,
  uzumSharePercent: 30,
  soldPercent: 70,
  staffCount: 2,
  staffSalary: 3_000_000,
  rent: 3_000_000,
  otherUsdPerMonth: 300,
  freeDeliveryThreshold: 250_000,
  customerDeliveryFee: 25_000,
};

describe("planPurchase equals the calculator's buyCalc", () => {
  it('at the calculator defaults: 1 kg of oil each, 2000 gift samples', () => {
    const p = planPurchase(four(1), defaults, defaultCostSettings(), 1);
    expect(p.investment).toEqual({ oil: 17_340_050, ethanol: 1_400_000, total: 18_740_050 });
    expect(p.liquid).toEqual({ perfumeMl: 12_933, giftMl: 10_000 });
    expect(p.bottles).toEqual({ ml10: 88, ml30: 36, ml50: 16, total: 140 });
    expect(p.revenue).toEqual({ full: 16_860_000, discount: 2_529_000, net: 14_331_000 });
    expect(p.gift).toEqual({ unitCost: 11_953, total: 23_906_222 });
    expect(p.profit).toBe(-16_876_446);
    expect(p.margin).toBeCloseTo(-16_876_446.279 / 14_331_000, 6);
    expect(p.payback.units).toBe(538);
    expect(p.payback.share).toBeCloseTo(538 / 140, 9);
    expect(p.year).toEqual({
      soldBottles: 98,
      revenue: 10_031_700,
      profit: -18_985_379,
      fixedCosts: 151_200_000,
      net: -170_185_379,
      netPerMonth: -14_182_115,
      stockAtCost: 5_622_015,
    });
    expect(p.inputs.fixedPerMonth).toBe(12_600_000);
    expect(p.rows.map((r) => [r.name, r.oilCost, r.bottles, r.revenue, r.profit])).toEqual([
      ['A', 1_874_600, 35, 3_582_750, 2_292_520],
      ['B', 3_280_550, 35, 3_582_750, 1_986_762],
      ['C', 4_686_500, 35, 3_582_750, 1_681_005],
      ['D', 7_498_400, 35, 3_582_750, 1_069_489],
    ]);
  });

  it('with other inputs: 3 kg each, 200 samples, 10 % discount, half through Uzum', () => {
    const cost = defaultCostSettings();
    cost.order.giftSampleCount = 200;
    const p = planPurchase(
      four(3),
      { ...defaults, avgDiscountPercent: 10, uzumSharePercent: 50 },
      cost,
      3,
    );
    expect(p.investment).toEqual({ oil: 52_020_150, ethanol: 4_200_000, total: 56_220_150 });
    expect(p.liquid).toEqual({ perfumeMl: 38_800, giftMl: 1_000 });
    expect(p.bottles).toEqual({ ml10: 1_132, ml30: 504, ml50: 224, total: 1_860 });
    expect(p.revenue).toEqual({ full: 229_140_000, discount: 22_914_000, net: 206_226_000 });
    expect(p.gift.total).toBe(2_390_622);
    expect(p.profit).toBe(96_392_772);
    expect(p.payback.units).toBe(707);
    expect(p.year.profit).toBe(66_757_753);
    expect(p.year.net).toBe(-84_442_247);
    expect(p.year.stockAtCost).toBe(16_866_045);
    expect(p.rows.map((r) => [r.name, r.bottles, r.profit])).toEqual([
      ['A', 465, 31_993_048],
      ['B', 465, 27_823_220],
      ['C', 465, 23_653_391],
      ['D', 465, 15_313_735],
    ]);
  });
});

describe('planPurchase edges', () => {
  it("a fragrance's own kilograms change only its row", () => {
    const list = four(1);
    list[3] = { ...list[3]!, oilKg: 2, overridden: true };
    const p = planPurchase(list, defaults, defaultCostSettings(), 1);
    const d = p.rows.find((r) => r.name === 'D')!;
    expect(d.oilKg).toBe(2);
    expect(d.overridden).toBe(true);
    expect(d.oilCost).toBe(2 * 7_498_400);
    expect(d.bottles).toBeGreaterThan(35);
  });

  it('an empty plan is all zeros, not NaN', () => {
    const p = planPurchase([], defaults, defaultCostSettings(), 1);
    expect(p.bottles.total).toBe(0);
    expect(p.margin).toBeNull();
    expect(p.payback).toEqual({ units: null, share: null });
    expect(Number.isFinite(p.year.net)).toBe(true);
  });

  it('a volume without a catalog price is not filled', () => {
    const only30 = { ...frag(1, 'A', 2_000, 1), prices: { 30: 189_000 } };
    const p = planPurchase([only30], defaults, defaultCostSettings(), 1);
    expect(p.bottles.ml10).toBe(0);
    expect(p.bottles.ml50).toBe(0);
  });
});
