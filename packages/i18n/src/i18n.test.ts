import { describe, expect, it } from 'vitest';
import { dictionaries } from './all';
import {
  defineMessages,
  fill,
  formatMoney,
  languageFromTelegram,
  normalizeUzbek,
  plural,
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

describe('plural', () => {
  const ru = { one: '{n} пункт', few: '{n} пункта', many: '{n} пунктов', other: '{n} пункта' };
  const uz = {
    one: '{n} ta punkt',
    few: '{n} ta punkt',
    many: '{n} ta punkt',
    other: '{n} ta punkt',
  };
  it('picks the Russian form by count', () => {
    expect([1, 3, 5, 11, 21, 22, 25].map((n) => plural('ru', n, ru))).toEqual([
      '1 пункт',
      '3 пункта',
      '5 пунктов',
      '11 пунктов',
      '21 пункт',
      '22 пункта',
      '25 пунктов',
    ]);
  });
  it('has one Uzbek form', () => {
    expect(plural('uz', 1, uz)).toBe('1 ta punkt');
    expect(plural('uz', 88, uz)).toBe('88 ta punkt');
  });
});

describe('fill', () => {
  it('fills named placeholders and leaves unknown ones visible', () => {
    expect(fill('по мотивам {brand}', { brand: 'Louis Vuitton' })).toBe('по мотивам Louis Vuitton');
    expect(fill('{brand} asosida', {})).toBe('{brand} asosida');
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
