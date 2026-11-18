import { describe, expect, it } from 'vitest';
import { defaultCostSettings, liquidFromOil, type LiquidSettings } from '../src/cost/unit-cost';
import { bottlingNeeds, oilLevel, oilValue, receiptCost } from '../src/warehouse/oil';

/**
 * Seam 2 (ADR 0028): the warehouse's arithmetic (ADR 0041) on top of the cost model's one liquid
 * formula (ADR 0040). Every expected figure is worked out by hand from the settings named in the
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

describe('what a bottling uses up (the cost model liquidNeeded, summed and rounded once)', () => {
  it('takes 3.09 g of oil and 7 ml of ethanol for one 10 ml bottle at the defaults', () => {
    // 10 ml × 1.03 = 10.3 ml of liquid: 30 % oil = 3.09 ml × 1 g/ml, 70 % ethanol = 7.21 ml
    expect(bottlingNeeds([{ ml: 10, quantity: 1 }], DEFAULTS)).toEqual({
      oilMg: 3090,
      ethanolMl: 7,
    });
  });

  it('adds the volumes up before rounding', () => {
    // oil: 4 × 3.09 + 2 × 9.27 + 1 × 15.45 = 46.35 g; ethanol: 28.84 + 43.26 + 36.05 = 108.15 ml
    expect(
      bottlingNeeds(
        [
          { ml: 10, quantity: 4 },
          { ml: 30, quantity: 2 },
          { ml: 50, quantity: 1 },
        ],
        DEFAULTS,
      ),
    ).toEqual({ oilMg: 46_350, ethanolMl: 108 });
  });

  it('follows the oil percent, the density and the filling loss', () => {
    // 10 ml × 1.05 = 10.5 ml: 25 % oil = 2.625 ml × 0.95 g/ml = 2.49375 g → 2 494 mg (half up);
    // ethanol 75 % = 7.875 ml → 8 ml
    expect(bottlingNeeds([{ ml: 10, quantity: 1 }], OTHER)).toEqual({ oilMg: 2494, ethanolMl: 8 });
    // no loss: exactly 30 % of the bottle
    expect(
      bottlingNeeds([{ ml: 50, quantity: 2 }], { ...DEFAULTS, fillingLossPercent: 0 }),
    ).toEqual({ oilMg: 30_000, ethanolMl: 70 });
  });

  it('is nothing for no bottles', () => {
    expect(bottlingNeeds([{ ml: 30, quantity: 0 }], DEFAULTS)).toEqual({ oilMg: 0, ethanolMl: 0 });
  });
});

describe('the oil balance as litres of liquid (the inverse of the same formula)', () => {
  it('turns 1 kg of oil into 3.236 l of perfume at the defaults, the filling loss taken off', () => {
    // 1000 g ÷ 1 g/ml = 1000 ml of oil; ÷ 30 % = 3333.3 ml of liquid; ÷ 1.03 = 3236.2 ml bottled
    expect(liquidFromOil(1000, DEFAULTS)).toBeCloseTo(3236.246, 3);
  });

  it('gives back the 10 ml a bottle took', () => {
    expect(liquidFromOil(3.09, DEFAULTS)).toBeCloseTo(10, 9);
    expect(liquidFromOil(2.49375, OTHER)).toBeCloseTo(10, 9);
  });

  it('follows the density and the oil percent', () => {
    // 95 g ÷ 0.95 g/ml = 100 ml of oil; ÷ 25 % = 400 ml; ÷ 1.05 = 380.95 ml
    expect(liquidFromOil(95, OTHER)).toBeCloseTo(380.952, 3);
  });
});

describe('the low-oil warning', () => {
  it('says none for no oil, low at or under the litres the setting names, else ok', () => {
    expect(oilLevel(0, 1)).toBe('zero');
    expect(oilLevel(0.4, 1)).toBe('low');
    expect(oilLevel(1, 1)).toBe('low');
    expect(oilLevel(1.01, 1)).toBe('ok');
    expect(oilLevel(0.2, 0)).toBe('ok');
  });
});

describe('what a receipt cost', () => {
  it('is the invoice price less the discount plus the delivery to Termez, per gram and in all', () => {
    // 4 000 × 0.91 × 1.03 = 3 749.2 so'm per gram; × 1 500 g = 5 623 800
    expect(
      receiptCost({ oilMg: 1_500_000, pricePerGram: 4000, discountPercent: 9, importPercent: 3 }),
    ).toEqual({ landedPerGram: 3749, total: 5_623_800 });
  });

  it('rounds the total once, half up, from the unrounded price per gram', () => {
    // 2 150 × 0.9 × 1.025 = 1 983.375 so'm/g; × 0.5 g = 991.6875 → 992 (per gram shows 1 983)
    expect(
      receiptCost({ oilMg: 500, pricePerGram: 2150, discountPercent: 10, importPercent: 2.5 }),
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
