import type { ProviderAnswer, ReceiptJudgeInput } from '../receipt-judge';

/** Thrown by an adapter on error, timeout, refusal or an unreadable answer; the composite then falls back. */
export class JudgeFailure extends Error {
  constructor(
    readonly reason: 'error' | 'timeout' | 'refusal' | 'not-configured',
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

/** One provider, one request. `timeoutMs` is read from settings by the composite. */
export interface ProviderJudge {
  readonly name: 'typesafe' | 'openai';
  judge(input: ReceiptJudgeInput, timeoutMs: number): Promise<ProviderAnswer>;
}

export const NONE_OPTION = 'none';

/** Receipts show local Tashkent time (UTC+5, no DST). */
export function formatTashkent(at: Date): string {
  const t = new Date(at.getTime() + 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The same Tashkent minute in words, `14 November 2026, 02:14`: receipts write dates many ways. */
export function formatTashkentWords(at: Date): string {
  const t = new Date(at.getTime() + 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export function candidateKey(index: number): string {
  return `c${index + 1}`;
}

/**
 * The four questions of ADR 0013, provider-neutral. This is everything the AI is told besides the image:
 * the amount, card last-4 and holder name of the SHOP, and candidate amounts and times. Never customer data.
 */
export function buildQuestions(input: ReceiptJudgeInput) {
  return {
    isReceipt: 'The image is a receipt or confirmation of a successful bank card transfer.',
    amountMatches: `The amount transferred is exactly ${input.amountDue} so'm.`,
    recipientMatches: `The recipient's card number ends in ${input.cardLast4}, or the recipient is ${input.holderName}.`,
    time: {
      // Owner, 2026-11-14: a receipt without a year still counts (bank apps' success screens
      // show «14 ноя 2:14»); see the eval note in test/receipt-ai.unit.test.ts.
      instructions:
        'Which of the options is the date and time of the transfer shown on the receipt? Times are Tashkent local time. ' +
        'Receipts often leave out the year and write the date and time in a short local form, such as «14 ноя 2:14», ' +
        '«14-noyabr 02:14» or «14.11 02:14»: a date without a year matches an option when its day, month, hour and ' +
        "minute match. Read the transfer's own date and time, not the phone's status-bar clock or a notification " +
        'banner. Pick "none" if the receipt shows none of them.',
      options: [
        ...input.candidates.map((c, i) => ({
          key: candidateKey(i),
          description: `Credit of ${c.amount} so'm at ${formatTashkent(c.at)} (${formatTashkentWords(c.at)})`,
        })),
        { key: NONE_OPTION, description: 'The receipt shows none of these date-times.' },
      ],
    },
  };
}

export type ImageKind = 'png' | 'jpeg';

/** Magic bytes decide, not the declared type (ADR 0020). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpeg';
  return null;
}

/** fetch with a hard timeout; maps abort to a JudgeFailure('timeout'). */
export async function postJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError')
      throw new JudgeFailure('timeout', `no answer in ${timeoutMs} ms`);
    throw new JudgeFailure('error', `network: ${(e as Error).message}`);
  }
  if (!res.ok) throw new JudgeFailure('error', `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new JudgeFailure('error', 'response is not JSON');
  }
}

export interface ProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
}

/** Both adapters: only PNG/JPEG go out (normalisation happens upstream). Returns the sniffed kind. */
export function requireImage(bytes: Uint8Array): ImageKind {
  const kind = sniffImage(bytes);
  if (!kind) throw new JudgeFailure('error', 'image is not PNG or JPEG');
  return kind;
}

/** The provider's chosen option key -> credit id; "none" or an unknown key -> null. */
export function resolveChoice(input: ReceiptJudgeInput, choice: string): number | null {
  const i = input.candidates.findIndex((_, n) => candidateKey(n) === choice);
  return choice === NONE_OPTION || i < 0 ? null : input.candidates[i]!.creditId;
}
