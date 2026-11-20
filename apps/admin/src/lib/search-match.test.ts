import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch } from './search-match';

describe('matchesSearch', () => {
  it('matches a part of a name, case-insensitive', () => {
    expect(matchesSearch('Absolu Aventus · 50 мл · доступно 3', 'aven')).toBe(true);
    expect(matchesSearch('Absolu Aventus', 'AVEN')).toBe(true);
    expect(matchesSearch('Discovery set 5 × 10 мл', 'discovery')).toBe(true);
    expect(matchesSearch('Absolu Aventus', 'oud')).toBe(false);
  });
  it('ignores diacritics and apostrophes', () => {
    expect(matchesSearch("Oʻzbek Nur", "o'zbek")).toBe(true);
    expect(matchesSearch('Oʻzbek Nur', 'ozbek')).toBe(true);
    expect(matchesSearch('Café Noir', 'cafe')).toBe(true);
    expect(normalizeSearch('Ёлка')).toBe('елка');
  });
  it('matches words in any order and handles Cyrillic', () => {
    expect(matchesSearch('Авентус · 50 мл', '50 авен')).toBe(true);
    expect(matchesSearch('Авентус · 50 мл', 'авен 30')).toBe(false);
  });
  it('empty query matches everything', () => {
    expect(matchesSearch('x', '  ')).toBe(true);
  });
});
