import { describe, expect, it } from 'vitest';
import { normalizePromoCode, PROMO_CODE_PATTERN } from './promo-code';

describe('normalizePromoCode', () => {
  it.each([
    ['bloger10', 'BLOGER10'],
    ['  Bloger10 ', 'BLOGER10'],
    // spaces inside, as a code is sometimes written in a post or split by a phone keyboard
    ['BLOGER 10', 'BLOGER10'],
    ['BLO GER\t10', 'BLOGER10'],
    // the Cyrillic letters a Russian layout gives for Latin ones fold to Latin
    ['ВLОGЕR10', 'BLOGER10'],
    ['мinus50', 'MINUS50'],
    ['АВЕКМНОРСТХУ', 'ABEKMHOPCTXY'],
    ['авекмнорстху', 'ABEKMHOPCTXY'],
    // NFKC: full-width forms (a code pasted from a styled post) become plain ones
    ['ＢＬＯＧＥＲ１０', 'BLOGER10'],
    ['LUMMI_2026-UZ', 'LUMMI_2026-UZ'],
  ])('reads %j as %s', (typed, code) => {
    const read = normalizePromoCode(typed);
    expect(read).toBe(code);
    expect(PROMO_CODE_PATTERN.test(read)).toBe(true);
  });

  it.each([
    ['лумми', 'ЛYMMИ'],
    ['скидка', 'CKИДKA'],
    ['', ''],
  ])(
    'leaves what has no Latin twin as it is (%j is %s), so the pattern refuses it',
    (typed, read) => {
      expect(normalizePromoCode(typed)).toBe(read);
      expect(PROMO_CODE_PATTERN.test(normalizePromoCode(typed))).toBe(false);
    },
  );
});
