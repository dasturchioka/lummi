import { describe, expect, it } from 'vitest';
import { copyWarnings } from './broadcast';

describe('copyWarnings', () => {
  it('flags banned words, fragrance numbers, concentration and emoji', () => {
    expect(copyWarnings('Копия известного аромата')).toEqual(['banned']);
    expect(copyWarnings('Аромат No.123 и № 45')).toEqual(['numbers']);
    expect(copyWarnings('Extrait 20% концентрации')).toEqual(['numbers']);
    expect(copyWarnings('Вечер 🎉🎉🎉')).toEqual(['emoji']);
  });
  it('lets the required disclaimer through', () => {
    expect(copyWarnings('Аромат LUMMI по мотивам, не оригинальный парфюм')).toEqual([]);
    expect(copyWarnings('Аромат по мотивам Louis Vuitton Symphony. 🎉')).toEqual([]);
  });
});
