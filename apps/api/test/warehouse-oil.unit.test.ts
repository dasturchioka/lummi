import { describe, expect, it } from 'vitest';
import { defaultCostSettings, type LiquidSettings } from '../src/cost/unit-cost';
import {
  concentrateLevel,
  gramsFromMg,
  mgFromGrams,
  mixingNeeds,
  mlFromUl,
  oilLevel,
  oilMlOf,
  oilReceiptCost,
  oilValue,
  ulFromMl,
} from '../src/warehouse/oil';

/**
 * Seam 2 (ADR 0028): the warehouse's arithmetic (ADR 0041, 0043) on top of the cost model's one
 * liquid formula (ADR 0040). Every expected figure is worked out by hand from the settings named in the
 * test, never by calling the code under test.
 */
const DEFAULTS = defaultCostSettings().liquid; // oil 30 %, density 1 g/ml, filling loss 3 %

/** Other liquid settings, so a value read from the wrong setting shows. */
const OTHER: LiquidSettings = {
  ...DEFAULTS,
  oilPercent: 25,
  ethanolPercent: 75,
  oilDensity: 0.95,
  fillingLossPercent: 5,
};

describe('what a mixing uses up (the cost model mixNeeds, no filling loss, rounded once)', () => {
  it('takes 30 g of oil and 70 ml of ethanol for 100 ml of concentrate at the defaults', () => {
    // 100 ml: 30 % oil = 30 ml × 1 g/ml, 70 % ethanol = 70 ml; the filling loss is in each fill
    expect(mixingNeeds(100, DEFAULTS)).toEqual({ oilMg: 30_000, ethanolMl: 70 });
  });

  it('follows the oil percent and the density, and never the filling loss', () => {
    // 10 ml: 25 % oil = 2.5 ml × 0.95 g/ml = 2.375 g; ethanol 75 % = 7.5 ml → 8 ml (half up)
    expect(mixingNeeds(10, OTHER)).toEqual({ oilMg: 2375, ethanolMl: 8 });
    expect(mixingNeeds(10, { ...OTHER, fillingLossPercent: 40 })).toEqual({
      oilMg: 2375,
      ethanolMl: 8,
    });
  });

  it('keeps a fraction of a ml to the milligram of oil', () => {
    // 10.3 ml (one 10 ml fill): 3.09 g of oil, 7.21 ml of ethanol → 7 ml
    expect(mixingNeeds(10.3, DEFAULTS)).toEqual({ oilMg: 3090, ethanolMl: 7 });
    expect(mixingNeeds(0.001, DEFAULTS)).toEqual({ oilMg: 0, ethanolMl: 0 });
  });
});

describe('the oil read in ml (by the density)', () => {
  it('is the grams over the density', () => {
    expect(oilMlOf(300, DEFAULTS)).toBe(300);
    // 95 g ÷ 0.95 g/ml = 100 ml
    expect(oilMlOf(95, OTHER)).toBeCloseTo(100, 9);
  });

  it('is nothing at a zero density', () => {
    expect(oilMlOf(10, { oilDensity: 0 })).toBe(0);
  });
});

describe('the low-oil warning', () => {
  it('says none for no oil, low at or under the ml the setting names, else ok', () => {
    expect(oilLevel(0, 300)).toBe('zero');
    expect(oilLevel(120, 300)).toBe('low');
    expect(oilLevel(300, 300)).toBe('low');
    expect(oilLevel(300.5, 300)).toBe('ok');
    expect(oilLevel(0.2, 0)).toBe('ok');
  });
});

describe('the low-concentrate warning', () => {
  it('says none while it can not fill the smallest bottle, low at or under the setting, else ok', () => {
    // the smallest bottle sold is 10 ml: 10 300 µl at the default loss
    expect(concentrateLevel(0, 10_300, 300)).toBe('zero');
    expect(concentrateLevel(10_299, 10_300, 300)).toBe('zero');
    expect(concentrateLevel(10_300, 10_300, 300)).toBe('low');
    expect(concentrateLevel(300_000, 10_300, 300)).toBe('low');
    expect(concentrateLevel(300_001, 10_300, 300)).toBe('ok');
    // a threshold of 0 warns only when a bottle can't be filled
    expect(concentrateLevel(10_300, 10_300, 0)).toBe('ok');
  });
});

describe('ml and µl, g and mg', () => {
  it('round to the microlitre and the milligram', () => {
    expect(ulFromMl(10.3)).toBe(10_300);
    expect(ulFromMl(0.0004)).toBe(0);
    expect(mlFromUl(51_500)).toBe(51.5);
    expect(mgFromGrams(3.0905)).toBe(3091);
    expect(gramsFromMg(46_350)).toBe(46.35);
  });
});

describe('what a receipt cost', () => {
  it('is the invoice price less the discount plus the delivery to Termez, per gram and in all', () => {
    // 4 000 × 0.91 × 1.03 = 3 749.2 so'm per gram; × 1 500 g = 5 623 800
    expect(
      oilReceiptCost({
        oilMg: 1_500_000,
        pricePerGram: 4000,
        discountPercent: 9,
        importPercent: 3,
      }),
    ).toEqual({ landedPerGram: 3749, total: 5_623_800 });
  });

  it('rounds the total once, half up, from the unrounded price per gram', () => {
    // 2 150 × 0.9 × 1.025 = 1 983.375 so'm/g; × 0.5 g = 991.6875 → 992 (per gram shows 1 983)
    expect(
      oilReceiptCost({ oilMg: 500, pricePerGram: 2150, discountPercent: 10, importPercent: 2.5 }),
    ).toEqual({ landedPerGram: 1983, total: 992 });
  });
});

describe('the oil balance valued at cost', () => {
  it('is the balance at the average landed price of the receipts still standing', () => {
    // 1 000 g at 3 749.2 (3 749 200) + 500 g at 1 983.375 (991 687.5) = 4 740 887.5 for 1 500 g:
    // 3 160.591… per gram; 600 g of it left = 1 896 355
    const receipts = [
      { oilMg: 1_000_000, pricePerGram: 4000, discountPercent: 9, importPercent: 3 },
      { oilMg: 500_000, pricePerGram: 2150, discountPercent: 10, importPercent: 2.5 },
    ];
    expect(oilValue(600_000, receipts)).toBe(1_896_355);
  });

  it('is zero with no oil, whatever was received', () => {
    expect(
      oilValue(0, [{ oilMg: 1000, pricePerGram: 4000, discountPercent: 9, importPercent: 3 }]),
    ).toBe(0);
    expect(oilValue(0, [])).toBe(0);
  });
});
