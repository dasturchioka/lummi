import { describe, expect, it } from 'vitest';
import { stepUps } from '../src/pricing/step-up';

/** The Step-up rule (#57): what the product page offers under its volume tiles. */

type Ml = 10 | 30 | 50;
const v = (ml: Ml, effectivePrice: number, available = 20) => ({ ml, effectivePrice, available });
const placeholders = [v(10, 69_000), v(30, 149_000), v(50, 219_000)];

describe('stepUps', () => {
  it('offers each next volume with what it adds, at the placeholder prices', () => {
    // 10 → 30: 80 000 for 20 ml = 4 000 a ml against 6 900 (−42 %); 30 → 50: 3 500 against 4 967 (−29 %)
    expect(stepUps(placeholders, 10)).toEqual([
      { fromMl: 10, toMl: 30, extra: 80_000 },
      { fromMl: 30, toMl: 50, extra: 70_000 },
    ]);
  });

  it('keeps only what clears the threshold, never rounding up into an offer', () => {
    expect(stepUps(placeholders, 30)).toEqual([{ fromMl: 10, toMl: 30, extra: 80_000 }]);
    // 30 → 50 saves 29.53… %: 29 offers it, 30 does not
    expect(stepUps(placeholders, 29)).toHaveLength(2);
    // 10 → 30 saves exactly 42.02… %: 42 offers it, 43 does not
    expect(stepUps(placeholders, 42)).toEqual([{ fromMl: 10, toMl: 30, extra: 80_000 }]);
    expect(stepUps(placeholders, 43)).toEqual([]);
  });

  it('steps over a sold-out volume to the next one that can be bought', () => {
    expect(stepUps([v(10, 69_000), v(30, 149_000, 0), v(50, 219_000)], 10)).toEqual([
      { fromMl: 10, toMl: 50, extra: 150_000 },
    ]);
  });

  it('offers nothing from or to a sold-out volume, and nothing from the largest', () => {
    expect(stepUps([v(10, 69_000, 0), v(30, 149_000), v(50, 219_000, 0)], 10)).toEqual([]);
    expect(stepUps([v(50, 219_000)], 10)).toEqual([]);
  });

  it('reads effective prices: a markdown on the smaller volume can take the offer away', () => {
    // 30 ml at 99 000: 50 ml adds 120 000 for 20 ml = 6 000 a ml against 3 300
    expect(stepUps([v(10, 69_000), v(30, 99_000), v(50, 219_000)], 10)).toEqual([
      { fromMl: 10, toMl: 30, extra: 30_000 },
    ]);
  });

  it('offers nothing when the bigger volume costs the same or less, or nothing is charged', () => {
    expect(stepUps([v(10, 149_000), v(30, 149_000)], 10)).toEqual([]);
    expect(stepUps([v(10, 160_000), v(30, 149_000)], 10)).toEqual([]);
    expect(stepUps([v(10, 0), v(30, 149_000)], 10)).toEqual([]);
  });

  it('offers nothing at staging’s demo price (10 ml for 1 000)', () => {
    expect(stepUps([v(10, 1_000), v(30, 149_000), v(50, 219_000)], 10)).toEqual([
      { fromMl: 30, toMl: 50, extra: 70_000 },
    ]);
  });

  it('offers a saving exactly at the threshold, and not one percent above it', () => {
    // 10 ml 100 000 (10 000 a ml), 30 ml 280 000: 180 000 for 20 ml = 9 000 a ml, exactly −10 %
    const exact = [v(10, 100_000), v(30, 280_000)];
    expect(stepUps(exact, 10)).toEqual([{ fromMl: 10, toMl: 30, extra: 180_000 }]);
    expect(stepUps(exact, 11)).toEqual([]);
  });

  it('reads effective prices: a markdown on the bigger volume can make an offer', () => {
    // at 45 %: 10 → 30 saves 42 % and 30 → 50 saves 29 %, so nothing; 50 ml marked down to 189 000
    // adds 40 000 for 20 ml = 2 000 a ml against 4 967 (−59 %)
    expect(stepUps(placeholders, 45)).toEqual([]);
    expect(stepUps([v(10, 69_000), v(30, 149_000), v(50, 189_000)], 45)).toEqual([
      { fromMl: 30, toMl: 50, extra: 40_000 },
    ]);
  });

  it('takes the volumes in any order', () => {
    expect(stepUps([...placeholders].reverse(), 10)).toEqual(stepUps(placeholders, 10));
  });
});
