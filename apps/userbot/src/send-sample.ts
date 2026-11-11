import { creditText, debitText, OTHER_TEXT } from './samples';

/**
 * Outside production the userbot listens to our own test bot (ADR 0023): this makes that bot send
 * a sample Humo message to the account the userbot runs on, through the Bot API. The userbot then
 * handles it like a real one: posts it, and forwards a ➕ to «Поступления».
 */

export interface SampleArgs {
  kind: 'credit' | 'debit' | 'other';
  /** Whole so'm. */
  amount: number;
  tiyin: number;
  cardLast4: string;
  at: Date;
}

export const USAGE =
  "usage: send-sample.ts [credit|debit|other] [amount in so'm] [--card 1234] [--tiyin 0-99]";

export function parseSampleArgs(argv: string[], now: Date): SampleArgs {
  const fail = (): never => {
    throw new Error(USAGE);
  };
  const args: SampleArgs = { kind: 'credit', amount: 99_000, tiyin: 0, cardLast4: '1234', at: now };
  const rest = [...argv];
  const positional: string[] = [];
  while (rest.length > 0) {
    const a = rest.shift()!;
    if (a === '--card') args.cardLast4 = /^\d{4}$/.test(rest[0] ?? '') ? rest.shift()! : fail();
    else if (a === '--tiyin') {
      const t = Number(rest.shift());
      args.tiyin = Number.isInteger(t) && t >= 0 && t <= 99 ? t : fail();
    } else positional.push(a);
  }
  const [kind, amount] = positional;
  if (kind !== undefined) {
    args.kind = kind === 'credit' || kind === 'debit' || kind === 'other' ? kind : fail();
  }
  if (amount !== undefined) {
    const n = Number(amount);
    args.amount = /^\d+$/.test(amount) && n > 0 ? n : fail();
  }
  if (positional.length > 2) fail();
  return args;
}

export function sampleText(a: SampleArgs): string {
  if (a.kind === 'other') return OTHER_TEXT;
  const o = { amount: a.amount, tiyin: a.tiyin, cardLast4: a.cardLast4, at: a.at };
  return a.kind === 'credit' ? creditText(o) : debitText(o);
}

/** A bot's user id is the number before the colon of its token: the chat the userbot listens to. */
export function botIdFromToken(token: string): number {
  const m = /^(\d+):[A-Za-z0-9_-]+$/.exec(token);
  if (!m) throw new Error('HUMO_TEST_BOT_TOKEN does not look like a bot token');
  return Number(m[1]);
}

/** Send through the Bot API. Errors carry Telegram's description at most, never the token. */
export async function sendSample(o: {
  token: string;
  chatId: number;
  text: string;
  fetch?: typeof fetch;
}): Promise<void> {
  const doFetch = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`https://api.telegram.org/bot${o.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: o.chatId, text: o.text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The error's message may hold the URL, and the URL holds the token.
    throw new Error('Bot API unreachable');
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: unknown };
  if (!body.ok) {
    const description = typeof body.description === 'string' ? body.description : '';
    throw new Error(
      `Bot API refused (${res.status}) ${description.replaceAll(o.token, '[token]')}`,
    );
  }
}
