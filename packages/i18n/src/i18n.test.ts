import { describe, expect, it } from 'vitest';
import { dictionaries } from './all';
import {
  defineMessages,
  formatMoney,
  formatPhone,
  languageFromTelegram,
  normalizeUzbek,
} from './index';

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

describe('formatPhone', () => {
  it('groups Uzbek numbers with no-break spaces and leaves others as stored', () => {
    expect(formatPhone('+998901234567')).toBe('+998\u00a090\u00a0123\u00a045\u00a067');
    expect(formatPhone('+79161234567')).toBe('+79161234567');
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
  it('rejects a namespace with a missing key (checked by tsc)', () => {
    // @ts-expect-error uz.errors.b is missing
    const broken = defineMessages({ errors: { a: 'x', b: 'y' } }, { errors: { a: 'x' } });
    expect(broken.ru.errors.a).toBe('x');
  });
  it('merges the namespaces for server code', () => {
    expect(dictionaries.uz.common.currency).toBe('soʻm');
    expect(dictionaries.ru.bot.openShop).toBeTruthy();
  });
});
