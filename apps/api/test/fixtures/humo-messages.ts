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
 * Still missing: a real ➕ credit (P2P transfer to the shop card). See docs/open-questions.md →
 * «Humo userbot».
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
];
