import { tashkentToUtc } from '@lummi/contracts';

/**
 * The Humo message parser (ADR 0014; layout in spec Changes 2026-11-07 «Humo credit feed», the
 * accepted variants in Changes 2026-11-09 «Humo credit intake»). Pure: text in, verdict out.
 * Lines are found by their marker, not their position. A required field that does not fit exactly
 * is reported, never guessed: the owner is alerted and the parser is fixed by hand (decision APIs
 * cannot read free text, ADR 0013). Real samples live in test/fixtures/humo-messages.ts.
 */

export interface ParsedCredit {
  /** Exact amount in tiyin (1/100 so'm), so a «,50» is never lost. */
  amountTiyin: number;
  /** The message's minute-precision Asia/Tashkent time, as a UTC instant. */
  occurredAt: Date;
  /** The card line as written, e.g. «HUMOCARD *1234». */
  cardMask: string;
  cardLast4: string;
  counterparty: string | null;
}

/**
 * Why a Humo message is not a credit we can record: it looks like an operation (a card mask or
 * something amount-shaped) but has no ➕/➖ line, or a required field of a ➕ does not fit the
 * template.
 */
export type HumoParseError = 'not_an_operation' | 'amount' | 'time' | 'card';

export type HumoParse =
  | { kind: 'credit'; credit: ParsedCredit }
  | { kind: 'debit' }
  /**
   * The Humo bot's own talk (menus, settings answers, promos, codes): no ➕/➖ line, no card mask
   * and nothing amount-shaped (#51). Kept, never alerted.
   */
  | { kind: 'service' }
  /**
   * The bot's word about the card itself (blocked, unblocked, a limit), with no ➕/➖ line: no
   * money to record, but the owner hears of it, since a blocked card takes no transfers (#51).
   */
  | { kind: 'card_notice' }
  | { kind: 'unparseable'; reason: HumoParseError };

/**
 * «75.750,00»: groups of three after the first, one separator throughout (`.`, space, no-break or
 * narrow no-break space) or none, then an optional «,dd» in tiyin. Anything else (say «75,750.00»)
 * is refused rather than guessed: a wrong amount could confirm the wrong order.
 */
const AMOUNT = /^(\d{1,3}(?:([. \u00A0\u202F])\d{3}(?:\2\d{3})*)?|\d+)(?:,(\d{2}))?$/u;

/** «20:54 22.06.2025»: no seconds, four-digit year. The clock emoji in front is not relied on. */
const TIME = /(?<![\d:])(\d{2}):(\d{2}) (\d{2})\.(\d{2})\.(\d{4})(?![\d.:])/;

/**
 * What an operation notification carries whatever its layout (#51): a ➕/➖ anywhere, a card mask
 * («*1234», «••1234», «XX1234») or something amount-shaped: digits grouped by `.`, `,` or a space
 * («60.000», «1 000 000»), with tiyin («5,00», «60000.00»), or next to a currency word (UZS,
 * so'm, сум, before or after, any case, any suffix: «60000 so'mga», «UZS 60000»). A message with
 * any of them but no line starting with ➕/➖ may be a changed format, so it is refused and the
 * owner alerted; only a message with none is the bot's own talk. Money is never dropped on a
 * guess: a false match costs one alert.
 */
const OPERATION_LIKE = [
  /[➕➖]/u,
  /\*\s?\d{4}(?!\d)/u,
  /[•·xX]{2,}\s?\d{4}/u,
  /(?<!\d)\d{1,3}(?:[., \u00A0\u202F]\d{3})+(?!\d)/u,
  /(?<!\d)\d+,\d{2}(?!\d)/u,
  /(?<![\d.])\d+\.\d{2}(?![\d.])/u,
  /\d[\s\u00A0\u202F]*(?:uzs|so['ʻʼ’‘`]?m|sum|сум|сўм)/iu,
  /(?:uzs|so['ʻʼ’‘`]?m|сум|сўм)[\s\u00A0\u202F]*\d/iu,
];
/** Words of a notice about the card itself: blocked or unblocked, a limit. */
const CARD_NOTICE = /blok|блок|limit|лимит/iu;

export function parseHumoMessage(text: string): HumoParse {
  // Emoji may carry a variation selector (U+FE0F); it changes nothing.
  const lines = text
    .replace(/\uFE0F/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim());

  // Exactly one signed line, ➕ (credit) or ➖ (debit).
  const signed = lines.filter((l) => l.startsWith('➕') || l.startsWith('➖'));
  if (signed.length === 0) {
    if (CARD_NOTICE.test(text)) return { kind: 'card_notice' };
    const looksLikeOperation = lines.some((l) => OPERATION_LIKE.some((re) => re.test(l)));
    return looksLikeOperation ? unparseable('not_an_operation') : { kind: 'service' };
  }
  if (signed.length > 1) return unparseable('amount');
  const [amountLine] = signed as [string];
  // Money out of the card is none of our business: not parsed further, not stored.
  if (amountLine.startsWith('➖')) return { kind: 'debit' };

  const amountText = /^➕\s*(.+?)\s+UZS$/u.exec(amountLine)?.[1];
  const amountTiyin = amountText === undefined ? null : parseAmountTiyin(amountText);
  if (amountTiyin === null) return unparseable('amount');

  const times = lines.filter((l) => TIME.test(l));
  const occurredAt = times.length === 1 ? parseTime(times[0]!) : null;
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

function parseAmountTiyin(value: string): number | null {
  const m = AMOUNT.exec(value);
  if (!m) return null;
  const som = m[1]!.replace(/\D/g, '');
  const tiyin = Number(som) * 100 + Number(m[3] ?? '0');
  return Number.isSafeInteger(tiyin) && tiyin > 0 ? tiyin : null;
}

function parseTime(line: string): Date | null {
  const [, hour, minute, day, month, year] = TIME.exec(line)!.map(Number) as number[];
  return tashkentToUtc({ year: year!, month: month!, day: day!, hour: hour!, minute: minute! });
}

function unparseable(reason: HumoParseError): HumoParse {
  return { kind: 'unparseable', reason };
}
