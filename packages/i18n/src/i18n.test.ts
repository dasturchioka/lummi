import { describe, expect, it } from 'vitest';
import { dictionaries } from './all';
import {
  defineMessages,
  fill,
  formatDateTime,
  formatDecimal,
  formatDayMonth,
  formatDuration,
  formatMoney,
  formatPhone,
  formatTiyin,
  languageFromTelegram,
  normalizeUzbek,
  plural,
  stripApostrophes,
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

describe('formatDecimal', () => {
  it('uses the language’s decimal separator, never a hard-coded one', () => {
    expect(formatDecimal(1.24, 1, 'ru')).toBe('1,2');
    expect(formatDecimal(0.97, 2, 'uz')).toBe('0,97');
    expect(formatDecimal(1250.5, 1, 'ru')).toBe('1\u202f250,5');
    expect(formatDecimal(74, 0, 'uz')).toBe('74');
  });
});

describe('formatTiyin', () => {
  it('reads a Humo credit to the tiyin, and a whole amount as formatMoney does', () => {
    expect(formatTiyin(7_575_050, 'ru')).toBe('75\u202f750,50\u202fсум');
    expect(formatTiyin(125_000_005, 'uz')).toBe('1\u202f250\u202f000,05\u202fsoʻm');
    expect(formatTiyin(14_900_000, 'ru')).toBe('149\u202f000\u202fсум');
    expect(formatTiyin(99, 'ru')).toBe('0,99\u202fсум');
  });
  it('refuses fractions and negatives', () => {
    expect(() => formatTiyin(10.5, 'ru')).toThrow();
    expect(() => formatTiyin(-100, 'ru')).toThrow();
  });
});

describe('formatDuration', () => {
  it('reads whole hours, else whole minutes rounded down, in both languages', () => {
    expect(formatDuration(43_200, 'ru')).toBe('12 часов');
    expect(formatDuration(3600, 'ru')).toBe('1 час');
    expect(formatDuration(86_400, 'ru')).toBe('24 часа');
    expect(formatDuration(43_200, 'uz')).toBe('12 soat');
    expect(formatDuration(5400, 'ru')).toBe('90 минут');
    expect(formatDuration(5459, 'uz')).toBe('90 daqiqa');
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

describe('formatPhone', () => {
  it('groups Uzbek numbers with no-break spaces and leaves others as stored', () => {
    expect(formatPhone('+998901234567')).toBe('+998\u00a090\u00a0123\u00a045\u00a067');
    expect(formatPhone('+79161234567')).toBe('+79161234567');
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

describe('stripApostrophes', () => {
  it('makes every apostrophe variant compare equal', () => {
    expect(stripApostrophes("Devil's Intrigue")).toBe(stripApostrophes('Devil’s Intrigue'));
    expect(stripApostrophes("Bal d'Afrique")).toBe('Bal dAfrique');
  });
});

describe('dates on the Tashkent wall clock', () => {
  it('reads an instant in Tashkent (UTC+5), RU and UZ', () => {
    expect(formatDateTime('2026-11-09T22:00:00Z', 'ru')).toBe('10 ноября, 03:00');
    expect(formatDateTime(new Date('2026-11-09T22:00:00Z'), 'uz')).toBe('10-noyabr, 03:00');
    expect(formatDayMonth('2026-12-31T19:00:00Z', 'ru')).toBe('1 января');
    expect(formatDayMonth('2026-12-31T18:59:59Z', 'uz')).toBe('31-dekabr');
  });
});
