import { describe, expect, it } from 'vitest';
import {
  bottleCost,
  defaultCostSettings,
  giftSampleCost,
  landedOilPrice,
  liquidNeeded,
  setCost,
  type CostSettings,
} from '../src/cost/unit-cost';

/**
 * Seam 2 (ADR 0028), the cost model (ADR 0040). Every expected figure is the customer's calculator
 * itself: its `unit`, `setUnit` and `giftCost` run on its own `P0` (and once on other values) with
 * the made-up oil prices below, each figure rounded to whole so'm as the calculator shows it.
 * Never recomputed here.
 */

/**
 * Oil prices, so'm per gram before the supplier discount: made up (the customer's real prices stay
 * off the repository), each run through the calculator to get the figures below.
 */
const A = 3950;
const B = 2150;
const C = 9150;
/** The five vials of a set. */
const SET_PICK = [2050, 2450, 2850, 2650, 2750];
/** The fragrances a gift sample's cost averages over. */
const GIFT_LIST = [1950, 2350, 3350, 4150, 5550, 7150];

/** Every setting off its default, so a value read from the wrong setting shows. */
const OTHER: CostSettings = {
  liquid: {
    usdRate: 12_000,
    oilPercent: 25,
    ethanolPercent: 75,
    oilDiscountPercent: 10,
    ethanolPerLitre: 160_000,
    oilDensity: 0.95,
    fixativePerMl: 300,
    fillingLossPercent: 4,
    oilImportPercent: 5,
  },
  packaging: {
    bottle: { 5: 2100, 10: 2500, 30: 6200, 50: 7300 },
    label: 600,
    spray: 800,
    filling: 1200,
    box: { 10: 5100, 30: 6000, 50: 7000 },
    setBox: { 5: 4000, 10: 6500 },
    insert: 1200,
    defectPercent: 3,
  },
  order: { ...defaultCostSettings().order, giftSampleMl: 3 },
};

describe("bottle cost at the default settings (the calculator's P0)", () => {
  it.each([
    [A, 5, { oil: 5720, ethanol: 541, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 0, insert: 0, base: 9761, defect: 195, total: 9956 }],
    [A, 10, { oil: 11440, ethanol: 1082, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 22022, defect: 440, total: 22462 }],
    [A, 30, { oil: 34321, ethanol: 3245, bottle: 6000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 51065, defect: 1021, total: 52086 }],
    [A, 50, { oil: 57201, ethanol: 5408, bottle: 7000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 77109, defect: 1542, total: 78651 }],
    [B, 5, { oil: 3113, ethanol: 541, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 0, insert: 0, base: 7154, defect: 143, total: 7297 }],
    // the parts round on their own: 16 808 + 336 shows 17 144, the total is 17 145
    [B, 10, { oil: 6227, ethanol: 1082, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 16808, defect: 336, total: 17145 }],
    [B, 30, { oil: 18681, ethanol: 3245, bottle: 6000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 35425, defect: 709, total: 36134 }],
    [B, 50, { oil: 31135, ethanol: 5408, bottle: 7000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 51042, defect: 1021, total: 52063 }],
    [C, 5, { oil: 13250, ethanol: 541, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 0, insert: 0, base: 17291, defect: 346, total: 17637 }],
    [C, 10, { oil: 26501, ethanol: 1082, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 37082, defect: 742, total: 37824 }],
    [C, 30, { oil: 79502, ethanol: 3245, bottle: 6000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 96247, defect: 1925, total: 98172 }],
    [C, 50, { oil: 132504, ethanol: 5408, bottle: 7000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 152411, defect: 3048, total: 155459 }],
  ] as const)("oil %i so'm/g, %i ml", (oilPrice, ml, expected) => {
    expect(bottleCost(oilPrice, ml, defaultCostSettings())).toEqual(expected);
  });
});

describe('set cost at the default settings: five vials, one set box, one QR card, defect on top', () => {
  it('Discovery Set 5 × 5 ml', () => {
    expect(setCost(SET_PICK, 5, defaultCostSettings())).toEqual({
      oil: 18464, ethanol: 2704, bottle: 10000, label: 2500, spray: 0, filling: 5000, box: 5000, insert: 1000, base: 44667, defect: 893, total: 45561,
    });
  });
  it('Discovery Set 5 × 10 ml', () => {
    expect(setCost(SET_PICK, 10, defaultCostSettings())).toEqual({
      oil: 36927, ethanol: 5408, bottle: 10000, label: 2500, spray: 0, filling: 5000, box: 5000, insert: 1000, base: 65835, defect: 1317, total: 67151,
    });
  });
});

describe('gift sample: the average 5 ml vial over the fragrances, scaled to the sample, plus a QR card', () => {
  it('5 ml at the default settings', () => {
    expect(giftSampleCost(GIFT_LIST, defaultCostSettings())).toBe(11_153);
  });
  it('3 ml at other settings', () => {
    expect(giftSampleCost(GIFT_LIST, OTHER)).toBe(10_336);
  });
  it('nothing to average over: no cost', () => {
    expect(giftSampleCost([], defaultCostSettings())).toBeNull();
  });
});

describe('every setting off its default: each value reaches its own part', () => {
  it.each([
    [A, 5, { oil: 4610, ethanol: 2184, bottle: 2100, label: 600, spray: 800, filling: 1200, box: 0, insert: 0, base: 11494, defect: 345, total: 11839 }],
    [A, 10, { oil: 9220, ethanol: 4368, bottle: 2500, label: 600, spray: 800, filling: 1200, box: 5100, insert: 1200, base: 24988, defect: 750, total: 25738 }],
    [A, 30, { oil: 27660, ethanol: 13104, bottle: 6200, label: 600, spray: 800, filling: 1200, box: 6000, insert: 1200, base: 56764, defect: 1703, total: 58467 }],
    [A, 50, { oil: 46099, ethanol: 21840, bottle: 7300, label: 600, spray: 800, filling: 1200, box: 7000, insert: 1200, base: 86039, defect: 2581, total: 88621 }],
    [B, 30, { oil: 15055, ethanol: 13104, bottle: 6200, label: 600, spray: 800, filling: 1200, box: 6000, insert: 1200, base: 44159, defect: 1325, total: 45484 }],
    [C, 50, { oil: 106787, ethanol: 21840, bottle: 7300, label: 600, spray: 800, filling: 1200, box: 7000, insert: 1200, base: 146727, defect: 4402, total: 151129 }],
  ] as const)("bottle: oil %i so'm/g, %i ml", (oilPrice, ml, expected) => {
    expect(bottleCost(oilPrice, ml, OTHER)).toEqual(expected);
  });

  it('Discovery Set 5 × 5 ml takes its own box', () => {
    expect(setCost(SET_PICK, 5, OTHER)).toEqual({
      oil: 14880, ethanol: 10920, bottle: 10500, label: 3000, spray: 4000, filling: 6000, box: 4000, insert: 1200, base: 54500, defect: 1635, total: 56135,
    });
  });
  it('Discovery Set 5 × 10 ml takes its own box', () => {
    expect(setCost(SET_PICK, 10, OTHER)).toEqual({
      oil: 29760, ethanol: 21840, bottle: 12500, label: 3000, spray: 4000, filling: 6000, box: 6500, insert: 1200, base: 84800, defect: 2544, total: 87344,
    });
  });
});

describe('the registry defaults are the calculator\'s P0', () => {
  it('maps every cost setting', () => {
    expect(defaultCostSettings()).toEqual({
      liquid: {
        usdRate: 12_000,
        oilPercent: 30,
        ethanolPercent: 70,
        oilDiscountPercent: 9,
        ethanolPerLitre: 150_000,
        oilDensity: 1,
        fixativePerMl: 0,
        fillingLossPercent: 3,
        oilImportPercent: 3,
      },
      packaging: {
        bottle: { 5: 2000, 10: 2000, 30: 6000, 50: 7000 },
        label: 500,
        spray: 0,
        filling: 1000,
        box: { 10: 5000, 30: 5000, 50: 5000 },
        setBox: { 5: 5000, 10: 5000 },
        insert: 1000,
        defectPercent: 2,
      },
      order: {
        mailer: 2000,
        btsCharge: 25_000,
        adPerSale: 3000,
        taxPercent: 1,
        onlinePaymentPercent: 0,
        uzumCommissionPercent: 20.5,
        giftSampleCount: 2000,
        giftSampleMl: 5,
      },
    });
  });
});

describe('the liquid a bottle takes (bottling draws on it, #76)', () => {
  it('50 ml at the defaults: 30 % oil at 1 g/ml and 70 % ethanol, plus 3 % filling loss', () => {
    // worked by hand: 50 × 1.03 × 0.30 × 1 = 15.45 g; 50 × 1.03 × 0.70 = 36.05 ml
    const need = liquidNeeded(50, defaultCostSettings().liquid);
    expect(need.oilGrams).toBeCloseTo(15.45, 10);
    expect(need.ethanolMl).toBeCloseTo(36.05, 10);
  });
  it('the oil of a bottle costs those grams at the landed price', () => {
    // A, 50 ml: 3950 × 0.91 × 1.03 = 3702.335 so'm/g × 15.45 g = 57 201.1, the table's 57 201
    const s = defaultCostSettings();
    expect(landedOilPrice(A, s.liquid)).toBeCloseTo(3702.335, 6);
    expect(Math.round(landedOilPrice(A, s.liquid) * liquidNeeded(50, s.liquid).oilGrams)).toBe(57_201);
  });
  it('density turns ml of oil into grams', () => {
    // 10 ml at 25 % oil, 0.95 g/ml, 4 % loss: 10 × 1.04 × 0.25 × 0.95 = 2.47 g; ethanol 10 × 1.04 × 0.75 = 7.8 ml
    const need = liquidNeeded(10, OTHER.liquid);
    expect(need.oilGrams).toBeCloseTo(2.47, 10);
    expect(need.ethanolMl).toBeCloseTo(7.8, 10);
  });
});
