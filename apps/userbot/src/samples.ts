/**
 * Sample Humo notifications in the documented layout (spec Changes 2026-11-07, the recorded debit in
 * `apps/api/test/fixtures/humo-messages.ts`): type, signed amount, counterparty, card mask, Tashkent
 * time to the minute, balance. Outside production our test bot sends these to the listened chat
 * (ADR 0023, `src/cli/send-sample.ts`); the tests use them too. No real ➕ has been recorded yet, so
 * a credit is the debit's layout with ➕ (open question «Humo userbot»).
 */

export interface SampleOptions {
  /** Whole so'm. */
  amount: number;
  /** 0–99; a credit with tiyin is recorded but never confirms an order by itself. */
  tiyin?: number;
  /** Last 4 digits of the card; the shop card's makes it a candidate for matching. */
  cardLast4?: string;
  /** When the operation happened; the text shows it in Asia/Tashkent, to the minute. */
  at?: Date;
}

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5, no DST

/** `99.000,00`: thousands with `.`, two tiyin digits after `,`. */
export function formatAmount(amount: number, tiyin = 0): string {
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error('amount must be a positive integer');
  if (!Number.isInteger(tiyin) || tiyin < 0 || tiyin > 99) throw new Error('tiyin must be 0–99');
  const whole = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${whole},${String(tiyin).padStart(2, '0')}`;
}

/** `HH:MM DD.MM.YYYY` in Asia/Tashkent. */
export function tashkentStamp(at: Date): string {
  const t = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(t.getUTCHours())}:${two(t.getUTCMinutes())} ` +
    `${two(t.getUTCDate())}.${two(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`
  );
}

function operation(sign: '➕' | '➖', counterparty: string, o: SampleOptions): string {
  const card = o.cardLast4 ?? '1234';
  if (!/^\d{4}$/.test(card)) throw new Error('cardLast4 must be 4 digits');
  return [
    "💸 To'lov",
    `${sign} ${formatAmount(o.amount, o.tiyin)} UZS`,
    `📍 ${counterparty}`,
    `💳 HUMOCARD *${card}`,
    `🕓 ${tashkentStamp(o.at ?? new Date())}`,
    '💰 1.234.567,89 UZS',
  ].join('\n');
}

/** A ➕ credit: recorded by the API, forwarded to «Поступления». */
export const creditText = (o: SampleOptions): string => operation('➕', 'HUMO P2P TEST', o);

/** A ➖ debit: ignored by the API, not forwarded. */
export const debitText = (o: SampleOptions): string => operation('➖', 'CLICK P2P HUMO2UZCAR', o);

/** Not an operation (no ➕ or ➖ line): stored and flagged by the API, which alerts the owner. */
export const OTHER_TEXT = 'HUMO: test message without an operation line (LUMMI staging)';
