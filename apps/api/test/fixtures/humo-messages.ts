import type { HumoParse } from '../../src/humo/humo-parser';

export interface RecordedHumoMessage {
  /** Where it came from: who sent it, when, and what kind of operation. */
  name: string;
  /** The message text exactly as the Humo bot sent it, anonymised (see below). */
  text: string;
  expected: HumoParse;
}

/**
 * Real Humo messages from the official Humo bot (ADR 0014, ADR 0028), checked by
 * `humo-parser.unit.test.ts` on every run. The table rows there are built from the documented
 * format; these are the ground truth that format came from.
 *
 * To add one (from the project chat, or from `humo_messages` once the userbot runs):
 * - copy the text exactly: keep every emoji, line break, space, separator and the currency;
 * - anonymise only digits that identify someone: card number, balance, a sender's name or card;
 *   keep the amount and time realistic, since they are what the parser reads;
 * - write the parse you expect (`expected`), then make the parser pass it.
 *
 * The 2026-11-14/15 messages come from Sardor's chat with @HUMOcardbot (orchestration notes
 * `humo-real-samples-2026-11-14.md`): the operations verbatim but the card mask and balance, the
 * four service messages that raised the F16 false alerts verbatim (#51).
 */
export const recordedHumoMessages: RecordedHumoMessage[] = [
  {
    name: 'debit, CLICK P2P (customer, project chat 2026-11-07, anonymised)',
    text: [
      "💸 To'lov",
      '➖ 75.750,00 UZS',
      '📍 CLICK P2P HUMO2UZCAR',
      '💳 HUMOCARD *1234',
      '🕓 20:54 22.06.2025',
      '💰 1.234.567,89 UZS',
    ].join('\n'),
    expected: { kind: 'debit' },
  },
  {
    name: 'credit, PAYME P2P (Sardor, 2026-11-14, card mask and balance anonymised)',
    text: [
      "🎉 To'ldirish",
      '➕ 60.000,00 UZS',
      '📍 PAYME P2P UZCARD NA',
      '💳 HUMOCARD *1234',
      '🕓 09:49 14.11.2026',
      '💰 66.328,00 UZS',
    ].join('\n'),
    expected: {
      kind: 'credit',
      credit: {
        amountTiyin: 6_000_000,
        occurredAt: new Date('2026-11-14T04:49:00Z'),
        cardMask: 'HUMOCARD *1234',
        cardLast4: '1234',
        counterparty: 'PAYME P2P UZCARD NA',
      },
    },
  },
  {
    name: 'credit, Visa to Humo (Sardor, 2026-11-14, card mask and balance anonymised)',
    text: [
      "🎉 To'ldirish",
      '➕ 1.000,00 UZS',
      '📍 UB Visa to Humo P2P>',
      '💳 HUMOCARD *1234',
      '🕓 12:15 14.11.2026',
      '💰 8.328,00 UZS',
    ].join('\n'),
    expected: {
      kind: 'credit',
      credit: {
        amountTiyin: 100_000,
        occurredAt: new Date('2026-11-14T07:15:00Z'),
        cardMask: 'HUMOCARD *1234',
        cardLast4: '1234',
        counterparty: 'UB Visa to Humo P2P>',
      },
    },
  },
  {
    name: 'credit, CLICK P2P (Sardor, 2026-11-14, card mask and balance anonymised)',
    text: [
      "🎉 To'ldirish",
      '➕ 1.000,00 UZS',
      '📍 CLICK P2P U2H ER>TAS',
      '💳 HUMOCARD *1234',
      '🕓 21:22 14.11.2026',
      '💰 15.426,00 UZS',
    ].join('\n'),
    expected: {
      kind: 'credit',
      credit: {
        amountTiyin: 100_000,
        occurredAt: new Date('2026-11-14T16:22:00Z'),
        cardMask: 'HUMOCARD *1234',
        cardLast4: '1234',
        counterparty: 'CLICK P2P U2H ER>TAS',
      },
    },
  },
  {
    name: 'debit, YandexGO (Sardor, 2026-11-14, card mask and balance anonymised)',
    text: [
      "💸 To'lov",
      '➖ 59.000,00 UZS',
      '📍 YandexGO Taxi UB OPL',
      '💳 HUMOCARD *1234',
      '🕓 10:02 14.11.2026',
      '💰 7.328,00 UZS',
    ].join('\n'),
    expected: { kind: 'debit' },
  },
  {
    name: 'debit, Yandex Plus (Sardor, 2026-11-16, card mask and balance anonymised)',
    text: [
      "💸 To'lov",
      '➖ 29.999,00 UZS',
      '📍 YANDEX PLUS>Toshkent',
      '💳 HUMOCARD *1234',
      '🕓 01:22 16.11.2026',
      '💰 23.652,00 UZS',
    ].join('\n'),
    expected: { kind: 'debit' },
  },
  {
    name: 'service: notification type menu (F16, message 531419, verbatim)',
    text: '🔔 Faqat Telegram\n\nXabar turini tanlang 👇',
    expected: { kind: 'service' },
  },
  {
    name: 'service: settings saved (F16, message 531421, verbatim)',
    text: "✅ O'zgarishlar saqlandi",
    expected: { kind: 'service' },
  },
  {
    name: 'service: reset confirmation (F16, message 531423, verbatim)',
    text: "Botdagi barcha ma'lumotlaringiz o'chiriladi. Botdan foydalanish uchun qaytadan ro'yxatdan o'tishingiz kerak bo'ladi.\n\nTasdiqlaysizmi?",
    expected: { kind: 'service' },
  },
  {
    name: 'service: settings menu (F16, message 531425, verbatim)',
    text: 'Sozlamalar 👇',
    expected: { kind: 'service' },
  },
];

/** The four service messages that raised the F16 false alerts on 2026-11-14 (#51). */
export const recordedServiceMessages = recordedHumoMessages.filter(
  (m) => m.expected.kind === 'service',
);
/** The real ➕ and ➖ operations. */
export const recordedOperations = recordedHumoMessages.filter(
  (m) => m.expected.kind === 'credit' || m.expected.kind === 'debit',
);
