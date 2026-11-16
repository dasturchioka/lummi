import { describe, expect, it } from 'vitest';
import { stepUps } from '../src/pricing/step-up';

/**
 * The Step-up rule (#57, #60): what the product page offers under its volume tiles, and what it
 * says the customer saves: the bigger volume at the chosen volume's price per ml, less its price.
 */

type Ml = 10 | 30 | 50;
const v = (ml: Ml, effectivePrice: number, available = 20) => ({ ml, effectivePrice, available });
const placeholders = [v(10, 69_000), v(30, 149_000), v(50, 219_000)];

describe('stepUps', () => {
  it('saves against the chosen volume, at the placeholder prices', () => {
    // 10 → 30: 3 × 69 000 = 207 000 against 149 000 → 58 000 (28 %)
    // 30 → 50: 149 000 / 30 × 50 = 248 333 against 219 000 → 29 333, shown as 29 000 (11 %)
    expect(stepUps(placeholders, 10)).toEqual([
      { fromMl: 10, toMl: 30, saving: 58_000 },
      { fromMl: 30, toMl: 50, saving: 29_000 },
    ]);
  });

  it('keeps only what clears the threshold, never rounding up into an offer', () => {
    expect(stepUps(placeholders, 12)).toEqual([{ fromMl: 10, toMl: 30, saving: 58_000 }]);
    // 10 → 30 saves 28.02 %: 28 offers it, 29 does not
    expect(stepUps(placeholders, 28)).toEqual([{ fromMl: 10, toMl: 30, saving: 58_000 }]);
    expect(stepUps(placeholders, 29)).toEqual([]);
  });

  it('offers a saving exactly at the threshold, and not one percent above it', () => {
    // 10 ml 100 000: 30 ml at that rate is 300 000; at 270 000 it saves exactly 10 %
    const exact = [v(10, 100_000), v(30, 270_000)];
    expect(stepUps(exact, 10)).toEqual([{ fromMl: 10, toMl: 30, saving: 30_000 }]);
    expect(stepUps(exact, 11)).toEqual([]);
  });

  it('shows the saving in whole thousands, and nothing under one thousand', () => {
    // 10 ml 10 000: 30 ml at that rate is 30 000; at 29 500 it saves 500
    expect(stepUps([v(10, 10_000), v(30, 29_500)], 1)).toEqual([]);
  });

  it('steps over a sold-out volume to the next one that can be bought', () => {
    // 10 → 50: 5 × 69 000 = 345 000 against 219 000
    expect(stepUps([v(10, 69_000), v(30, 149_000, 0), v(50, 219_000)], 10)).toEqual([
      { fromMl: 10, toMl: 50, saving: 126_000 },
    ]);
  });

  it('offers nothing from or to a sold-out volume, and nothing from the largest', () => {
    expect(stepUps([v(10, 69_000, 0), v(30, 149_000), v(50, 219_000, 0)], 10)).toEqual([]);
    expect(stepUps([v(50, 219_000)], 10)).toEqual([]);
  });

  it('reads effective prices: a markdown on the chosen volume can take the offer away', () => {
    // 30 ml at 99 000 (3 300 a ml): 50 ml at that rate is 165 000, less than 219 000
    expect(stepUps([v(10, 69_000), v(30, 99_000), v(50, 219_000)], 10)).toEqual([
      { fromMl: 10, toMl: 30, saving: 108_000 },
    ]);
  });

  it('reads effective prices: a markdown on the bigger volume can make an offer', () => {
    // at 20 %: 30 → 50 saves 11 %, none; 50 ml marked down to 169 000 saves 79 333 (31 %)
    expect(stepUps(placeholders, 20)).toEqual([{ fromMl: 10, toMl: 30, saving: 58_000 }]);
    expect(stepUps([v(10, 69_000), v(30, 149_000), v(50, 169_000)], 20)).toEqual([
      { fromMl: 10, toMl: 30, saving: 58_000 },
      { fromMl: 30, toMl: 50, saving: 79_000 },
    ]);
  });

  it('counts a bigger volume at the same price as the saving it is, and skips a free one', () => {
    expect(stepUps([v(10, 149_000), v(30, 149_000)], 10)).toEqual([
      { fromMl: 10, toMl: 30, saving: 298_000 },
    ]);
    expect(stepUps([v(10, 0), v(30, 149_000)], 10)).toEqual([]);
  });

  it('offers nothing from staging’s demo price (10 ml for 1 000)', () => {
    expect(stepUps([v(10, 1_000), v(30, 149_000), v(50, 219_000)], 10)).toEqual([
      { fromMl: 30, toMl: 50, saving: 29_000 },
    ]);
  });

  it('takes the volumes in any order', () => {
    expect(stepUps([...placeholders].reverse(), 10)).toEqual(stepUps(placeholders, 10));
  });
});
