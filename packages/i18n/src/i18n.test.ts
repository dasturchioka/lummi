import { describe, expect, it } from 'vitest';
import { formatMoney, languageFromTelegram, normalizeUzbek, uz, type Messages } from './index';

describe('formatMoney', () => {
  it('formats RU and UZ with narrow no-break spaces', () => {
    expect(formatMoney(100000, 'ru')).toBe('100 000 сум');
    expect(formatMoney(100000, 'uz')).toBe('100 000 soʻm');
    expect(formatMoney(999, 'ru')).toBe('999 сум');
    expect(formatMoney(1250000, 'ru')).toBe('1 250 000 сум');
    expect(formatMoney(0, 'uz')).toBe('0 soʻm');
  });
  it('refuses non-integers', () => {
    expect(() => formatMoney(10.5, 'ru')).toThrow();
  });
});

describe('normalizeUzbek', () => {
  it('uses U+02BB for oʻ and gʻ in every apostrophe variant', () => {
    for (const a of ["'", '‘', '’', 'ʼ', '`', '´']) {
      expect(normalizeUzbek(`o${a}zbek G${a}ishtli`)).toBe('oʻzbek Gʻishtli');
    }
  });
  it('uses U+2019 for the tutuq belgisi', () => {
    expect(normalizeUzbek("ma'no")).toBe('ma’no');
    expect(normalizeUzbek('saʻy')).toBe('sa’y');
  });
  it('leaves other text alone', () => {
    expect(normalizeUzbek('Лаванда 100')).toBe('Лаванда 100');
  });
});

describe('languageFromTelegram', () => {
  it('maps uz to UZ and everything else to RU', () => {
    expect(languageFromTelegram('uz')).toBe('uz');
    expect(languageFromTelegram('uz-UZ')).toBe('uz');
    expect(languageFromTelegram('ru')).toBe('ru');
    expect(languageFromTelegram('en')).toBe('ru');
    expect(languageFromTelegram(undefined)).toBe('ru');
  });
});

describe('dictionary typing', () => {
  it('rejects a dictionary with a missing key (checked by tsc)', () => {
    // @ts-expect-error errors.sessionExpired is missing
    const broken: Messages = { common: { currency: 'x' }, errors: { generic: 'x' } };
    expect(broken).toBeDefined();
    expect(uz.common.currency).toBe('soʻm');
  });
});
