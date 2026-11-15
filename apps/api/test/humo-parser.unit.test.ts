import { describe, expect, it } from 'vitest';
import { parseHumoMessage } from '../src/humo/humo-parser';
import {
  recordedHumoMessages,
  recordedOperations,
  recordedServiceMessages,
} from './fixtures/humo-messages';

/**
 * Humo notifications built from the documented format (spec Changes 2026-11-07, «Humo credit
 * feed»). The only real sample so far is a debit; a credit is the same layout with ➕.
 * `null` drops a line, to model a missing field.
 */
function humoMessage(
  lines: {
    type?: string | null;
    amount?: string | null;
    counterparty?: string | null;
    card?: string | null;
    time?: string | null;
    balance?: string | null;
  } = {},
): string {
  const all = {
    type: "💸 To'lov",
    amount: '➕ 75.750,00 UZS',
    counterparty: '📍 CLICK P2P HUMO2UZCAR',
    card: '💳 HUMOCARD *1234',
    time: '🕓 20:54 22.06.2025',
    balance: '💰 1.234.567,89 UZS',
    ...lines,
  };
  return Object.values(all)
    .filter((l): l is string => l !== null)
    .join('\n');
}

describe('a credit in the documented format', () => {
  it('reads amount, Tashkent time as UTC, card mask and counterparty', () => {
    expect(parseHumoMessage(humoMessage())).toEqual({
      kind: 'credit',
      credit: {
        amountTiyin: 7_575_000,
        occurredAt: new Date('2025-06-22T15:54:00Z'),
        cardMask: 'HUMOCARD *1234',
        cardLast4: '1234',
        counterparty: 'CLICK P2P HUMO2UZCAR',
      },
    });
  });
});

describe('a debit', () => {
  it('the documented ➖ sample is a debit, whatever else it carries', () => {
    expect(parseHumoMessage(humoMessage({ amount: '➖ 75.750,00 UZS' }))).toEqual({
      kind: 'debit',
    });
    expect(
      parseHumoMessage(humoMessage({ amount: '➖ 75.750,00 UZS', card: null, time: null })),
    ).toEqual({ kind: 'debit' });
  });
});

const amountOf = (amountLine: string) => {
  const r = parseHumoMessage(humoMessage({ amount: amountLine }));
  return r.kind === 'credit' ? r.credit.amountTiyin : r;
};

describe('credit amount, exact in tiyin', () => {
  it.each([
    ['documented: . thousands, , tiyin', '➕ 75.750,00 UZS', 7_575_000],
    ['millions', '➕ 1.250.000,00 UZS', 125_000_000],
    ['under a thousand', '➕ 750,00 UZS', 75_000],
    ['non-zero tiyin kept', '➕ 75.750,50 UZS', 7_575_050],
    ['one tiyin', '➕ 0,01 UZS', 1],
    ['space thousands', '➕ 75 750,00 UZS', 7_575_000],
    ['no-break space thousands', '➕ 1\u00A0250\u00A0000,00 UZS', 125_000_000],
    ['narrow no-break space thousands', '➕ 75\u202F750,00 UZS', 7_575_000],
    ['no thousands separator', '➕ 75750,00 UZS', 7_575_000],
    ['no tiyin part', '➕ 99.000 UZS', 9_900_000],
    ['no space after the sign', '➕75.750,00 UZS', 7_575_000],
    ['emoji variation selector after the sign', '➕\uFE0F 75.750,00 UZS', 7_575_000],
  ])('%s: %s', (_name, line, tiyin) => {
    expect(amountOf(line)).toBe(tiyin);
  });
});

describe('an amount that does not fit is refused, never guessed', () => {
  it.each([
    ['English separators', '➕ 75,750.00 UZS'],
    ['. followed by two digits', '➕ 75.75 UZS'],
    ['short thousands group', '➕ 1.25.000,00 UZS'],
    ['mixed separators', '➕ 1.234 567,00 UZS'],
    ['one tiyin digit', '➕ 75.750,5 UZS'],
    ['other currency', '➕ 75.750,00 USD'],
    ['no currency', '➕ 75.750,00'],
    ['zero', '➕ 0,00 UZS'],
    ['no digits', '➕ UZS'],
  ])('%s: %s', (_name, line) => {
    expect(parseHumoMessage(humoMessage({ amount: line }))).toEqual({
      kind: 'unparseable',
      reason: 'amount',
    });
  });

  it('a message with no ➕ or ➖ line that still looks like an operation (a card mask or an amount) is refused', () => {
    for (const text of [
      humoMessage({ amount: null }),
      humoMessage({ amount: null, balance: null }), // the card mask alone
      humoMessage({ amount: '75.750,00 UZS', card: null, balance: null }), // the amount alone
      'HUMOCARD *1234',
      '60.000,00 UZS',
      "To'lov: 99 000 UZS",
      "To'ldirish 60.000,00", // grouped, with tiyin, no currency
      'Hisobingizga 1 000 000 tushdi', // grouped by spaces, no currency
      "Sizga 150 so'm keshbek", // a currency word, any case
      'Поступление 99000 сум',
      'Popolnenie 99000 uzs',
      'Summa: 5,00',
    ]) {
      expect([text, parseHumoMessage(text)]).toEqual([
        text,
        { kind: 'unparseable', reason: 'not_an_operation' },
      ]);
    }
  });

  it('an ASCII plus is not ➕: the message reports no card operation', () => {
    expect(parseHumoMessage(humoMessage({ amount: '+ 75.750,00 UZS' }))).toEqual({
      kind: 'unparseable',
      reason: 'not_an_operation',
    });
  });

  it('two amount lines are ambiguous, even if one is ➖', () => {
    const two = (second: string) => humoMessage({ amount: `➕ 75.750,00 UZS\n${second}` });
    expect(parseHumoMessage(two('➕ 10.000,00 UZS'))).toEqual({
      kind: 'unparseable',
      reason: 'amount',
    });
    expect(parseHumoMessage(two('➖ 10.000,00 UZS'))).toEqual({
      kind: 'unparseable',
      reason: 'amount',
    });
  });
});

const timeOf = (timeLine: string | null) => {
  const r = parseHumoMessage(humoMessage({ time: timeLine }));
  return r.kind === 'credit' ? r.credit.occurredAt.toISOString() : r;
};

describe('credit time: HH:MM DD.MM.YYYY in Asia/Tashkent (UTC+5), stored as UTC', () => {
  it.each([
    ['documented sample', '🕓 20:54 22.06.2025', '2025-06-22T15:54:00.000Z'],
    [
      'early morning falls on the previous UTC day',
      '🕓 03:10 01.01.2026',
      '2025-12-31T22:10:00.000Z',
    ],
    ['midnight after a leap day', '🕓 00:00 01.03.2024', '2024-02-29T19:00:00.000Z'],
    ['last minute of the year', '🕓 23:59 31.12.2025', '2025-12-31T18:59:00.000Z'],
    ['another clock emoji', '🕘 09:05 07.11.2026', '2026-11-07T04:05:00.000Z'],
  ])('%s: %s', (_name, line, iso) => {
    expect(timeOf(line)).toBe(iso);
  });

  it.each([
    ['hour 25', '🕓 25:00 22.06.2025'],
    ['minute 60', '🕓 20:60 22.06.2025'],
    ['31 February', '🕓 20:54 31.02.2025'],
    ['month 13', '🕓 20:54 22.13.2025'],
    ['two-digit year', '🕓 20:54 22.06.25'],
    ['with seconds', '🕓 20:54:13 22.06.2025'],
    ['time without date', '🕓 20:54'],
    ['missing line', null],
    ['two time lines', '🕓 20:54 22.06.2025\n🕓 20:55 22.06.2025'],
  ])('%s is refused', (_name, line) => {
    expect(timeOf(line)).toEqual({ kind: 'unparseable', reason: 'time' });
  });
});

const creditOf = (lines: Parameters<typeof humoMessage>[0]) => {
  const r = parseHumoMessage(humoMessage(lines));
  return r.kind === 'credit' ? r.credit : r;
};

describe('card mask', () => {
  it.each([
    ['documented', '💳 HUMOCARD *1234', 'HUMOCARD *1234', '1234'],
    ['other product name', '💳 HUMO *9876', 'HUMO *9876', '9876'],
    ['trailing spaces', '💳 HUMOCARD *0042   ', 'HUMOCARD *0042', '0042'],
  ])('%s: %s', (_name, line, cardMask, cardLast4) => {
    expect(creditOf({ card: line })).toMatchObject({ cardMask, cardLast4 });
  });

  it.each([
    ['no digits', '💳 HUMOCARD'],
    ['two digits', '💳 HUMOCARD *12'],
    ['five digits', '💳 HUMOCARD *12345'],
    ['missing line', null],
    ['two card lines', '💳 HUMOCARD *1234\n💳 HUMOCARD *5678'],
  ])('%s is refused', (_name, line) => {
    expect(creditOf({ card: line })).toEqual({ kind: 'unparseable', reason: 'card' });
  });
});

describe('lines matching does not need', () => {
  it('a missing counterparty is null; the credit still counts', () => {
    expect(creditOf({ counterparty: null })).toMatchObject({
      amountTiyin: 7_575_000,
      counterparty: null,
    });
  });

  it('the balance is ignored, missing or garbled', () => {
    expect(creditOf({ balance: null })).toMatchObject({ amountTiyin: 7_575_000 });
    expect(creditOf({ balance: '💰 ??? UZS' })).toMatchObject({ amountTiyin: 7_575_000 });
  });

  it('the type line is not relied on', () => {
    expect(creditOf({ type: null })).toMatchObject({ amountTiyin: 7_575_000 });
    expect(creditOf({ type: "💸 To'ldirish" })).toMatchObject({ amountTiyin: 7_575_000 });
  });

  it('Windows line endings', () => {
    const r = parseHumoMessage(humoMessage().replace(/\n/g, '\r\n'));
    expect(r).toMatchObject({ kind: 'credit', credit: { cardLast4: '1234' } });
  });
});

describe('recorded real notifications (test/fixtures/humo-messages.ts)', () => {
  it.each(recordedHumoMessages)('$name', ({ text, expected }) => {
    expect(parseHumoMessage(text)).toEqual(expected);
  });

  if (!recordedHumoMessages.some((n) => n.expected.kind === 'credit')) {
    it.todo('a real ➕ credit: waiting for the first transfer to the shop card');
  }
});

describe('a Humo service message: no ➕/➖, no card mask, nothing amount-shaped (#51, F16)', () => {
  it.each(recordedServiceMessages)('the real one: $name', ({ text }) => {
    expect(parseHumoMessage(text)).toEqual({ kind: 'service' });
  });

  it.each([
    ['empty', ''],
    ['the main menu', "Asosiy menyu\nKerakli bo'limni tanlang 👇"],
    ['a language answer', '🇷🇺 Язык изменён на русский'],
    ['a promo with a percent', "🎁 HUMO kartasi bilan to'lovlarda 5% keshbek!"],
    ['a verification code (no grouping)', 'Tasdiqlash kodi: 123456. Uni hech kimga bermang!'],
  ])('%s', (_name, text) => {
    expect(parseHumoMessage(text)).toEqual({ kind: 'service' });
  });

  it('every real ➕ and ➖ is an operation, and stays one with its sign line or its fields gone', () => {
    for (const { text } of recordedOperations) {
      const lines = text.split('\n');
      const variants = [
        text,
        ...lines.map((_, i) => lines.filter((__, j) => j !== i).join('\n')),
        lines.filter((l) => !/^[➕➖]/u.test(l) && !l.startsWith('💳')).join('\n'),
        lines.filter((l) => !/^[➕➖]/u.test(l) && !l.startsWith('💰')).join('\n'),
      ];
      for (const v of variants) expect([v, parseHumoMessage(v).kind]).not.toEqual([v, 'service']);
    }
  });
});

describe('a Humo message about the card itself is never quiet (#51)', () => {
  it.each([
    ['blocked, UZ', 'Kartangiz vaqtincha bloklandi'],
    ['unblocked, UZ', 'Kartangiz blokdan chiqarildi'],
    ['blocked, RU', 'Ваша карта заблокирована'],
    ['a limit, UZ', "Kunlik limit o'zgartirildi"],
    ['a limit, RU', 'Лимит по карте исчерпан'],
    ['blocked, with the card mask', '💳 HUMOCARD *1234 bloklandi'],
  ])('%s', (_name, text) => {
    expect(parseHumoMessage(text)).toEqual({ kind: 'card_notice' });
  });
});
