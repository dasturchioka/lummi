/**
 * The Humo notification parser (ADR 0014; format in spec Changes 2026-11-07, «Humo credit feed»).
 * Pure: text in, verdict out. Lines are found by their marker, not their position, and a required
 * field that does not fit exactly is reported, never guessed: the owner is alerted and the parser
 * is fixed by hand (decision APIs cannot read free text, ADR 0013). Real samples live in
 * test/fixtures/humo-notifications.ts.
 */

export interface ParsedCredit {
  /** Exact amount in tiyin (1/100 so'm), so a «,50» is never lost. */
  amountTiyin: number;
  /** The notification's minute-precision Asia/Tashkent time, as a UTC instant. */
  occurredAt: Date;
  /** The card line as written, e.g. «HUMOCARD *1234». */
  cardMask: string;
  cardLast4: string;
  counterparty: string | null;
}

/** Which required field did not fit the template. */
export type HumoParseError = 'amount' | 'time' | 'card';

export type HumoParse =
  | { kind: 'credit'; credit: ParsedCredit }
  | { kind: 'debit' }
  | { kind: 'unparseable'; reason: HumoParseError };

/** Asia/Tashkent is UTC+05:00 all year (no DST since 1992). */
const TASHKENT_OFFSET_MINUTES = 5 * 60;

/**
 * «75.750,00»: groups of three after the first, one separator throughout (`.`, space, no-break or
 * narrow no-break space) or none, then an optional «,dd» in tiyin. Anything else (say «75,750.00»)
 * is refused rather than guessed: a wrong amount could confirm the wrong order.
 */
const AMOUNT = /^(\d{1,3}(?:([. \u00A0\u202F])\d{3}(?:\2\d{3})*)?|\d+)(?:,(\d{2}))?$/u;

/** «20:54 22.06.2025»: no seconds, four-digit year. The clock emoji in front is not relied on. */
const TIME = /(?<![\d:])(\d{2}):(\d{2}) (\d{2})\.(\d{2})\.(\d{4})(?![\d.:])/;

function parseAmountTiyin(value: string): number | null {
  const m = AMOUNT.exec(value);
  if (!m) return null;
  const som = m[1]!.replace(/\D/g, '');
  const tiyin = Number(som) * 100 + Number(m[3] ?? '0');
  return Number.isSafeInteger(tiyin) && tiyin > 0 ? tiyin : null;
}

export function parseHumoNotification(text: string): HumoParse {
  // Emoji may carry a variation selector (U+FE0F); it changes nothing.
  const lines = text
    .replace(/\uFE0F/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  // Exactly one signed line, ➕ (credit) or ➖ (debit); none or several is not a notification we know.
  const signed = lines.filter((l) => l.startsWith('➕') || l.startsWith('➖'));
  if (signed.length !== 1) return unparseable('amount');
  const [amountLine] = signed as [string];
  // Money out of the card is none of our business: not parsed further, not stored.
  if (amountLine.startsWith('➖')) return { kind: 'debit' };
  const amountText = /^➕\s*(.+?)\s+UZS$/u.exec(amountLine)?.[1];
  const amountTiyin = amountText === undefined ? null : parseAmountTiyin(amountText);
  if (amountTiyin === null) return unparseable('amount');
  const times = lines.filter((l) => TIME.test(l));
  const occurredAt = times.length === 1 ? parseTashkentTime(times[0]!) : null;
  if (occurredAt === null) return unparseable('time');
  const cards = lines.filter((l) => l.startsWith('💳'));
  const cardMask = cards.length === 1 ? cards[0]!.slice('💳'.length).trim() : '';
  const cardLast4 = /\*\s?(\d{4})$/.exec(cardMask)?.[1];
  if (cardLast4 === undefined) return unparseable('card');
  const counterparty =
    lines
      .find((l) => l.startsWith('📍'))
      ?.slice('📍'.length)
      .trim() ?? null;
  return { kind: 'credit', credit: { amountTiyin, occurredAt, cardMask, cardLast4, counterparty } };
}

function parseTashkentTime(line: string): Date | null {
  const [, hh, mi, dd, mo, yyyy] = TIME.exec(line)!.map(Number) as number[];
  // Date.UTC rolls 31.02 over to March; reading the fields back catches every out-of-range part.
  const local = new Date(Date.UTC(yyyy!, mo! - 1, dd!, hh!, mi!));
  const fits =
    local.getUTCFullYear() === yyyy &&
    local.getUTCMonth() === mo! - 1 &&
    local.getUTCDate() === dd &&
    local.getUTCHours() === hh &&
    local.getUTCMinutes() === mi;
  return fits ? new Date(local.getTime() - TASHKENT_OFFSET_MINUTES * 60_000) : null;
}

function unparseable(reason: HumoParseError): HumoParse {
  return { kind: 'unparseable', reason };
}
