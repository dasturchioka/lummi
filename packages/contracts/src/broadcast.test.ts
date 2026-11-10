import { describe, expect, it } from 'vitest';
import { copyWarnings } from './broadcast';

describe('copyWarnings', () => {
  it('flags banned words, fragrance numbers, concentration and emoji, naming what matched', () => {
    expect(copyWarnings('Копия известного аромата')).toEqual([
      { kind: 'banned', matches: ['Копия'] },
    ]);
    expect(copyWarnings('Аромат No.123 и № 45')).toEqual([
      { kind: 'numbers', matches: ['No.123', '№ 45'] },
    ]);
    expect(copyWarnings('Extrait 20% концентрации')).toEqual([
      { kind: 'numbers', matches: ['20%'] },
    ]);
    expect(copyWarnings('Вечер 🎉🎉🎉')).toEqual([{ kind: 'emoji', matches: ['🎉'] }]);
  });
  it('names each banned word once, whole, as written, in RU and UZ', () => {
    expect(copyWarnings('Не реплика и не копия: копия оригинала')).toEqual([
      { kind: 'banned', matches: ['реплика', 'копия', 'оригинала'] },
    ]);
    expect(copyWarnings('Bu nusxa emas, replikalar ham emas')).toEqual([
      { kind: 'banned', matches: ['nusxa', 'replikalar'] },
    ]);
  });
  it('lets the required disclaimer through', () => {
    expect(copyWarnings('Аромат LUMMI по мотивам, не оригинальный парфюм')).toEqual([]);
    expect(copyWarnings('Аромат по мотивам Louis Vuitton Symphony. 🎉')).toEqual([]);
  });
});
