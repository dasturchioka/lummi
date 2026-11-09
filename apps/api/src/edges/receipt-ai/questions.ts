import type { ReceiptJudgeInput, ReceiptJudgement } from '../receipt-judge';

/** Thrown by an adapter on error, timeout, refusal or an unreadable answer; the composite then falls back. */
export class JudgeFailure extends Error {
  constructor(
    readonly reason: 'error' | 'timeout' | 'refusal' | 'not-configured' | 'bad-input',
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

/** One provider, one request. `timeoutMs` is read from settings by the composite. */
export interface ProviderJudge {
  readonly name: 'typesafe' | 'openai';
  judge(input: ReceiptJudgeInput, timeoutMs: number): Promise<ReceiptJudgement>;
}

export const NONE_OPTION = 'none';

/** Receipts show local Tashkent time (UTC+5, no DST). */
export function formatTashkent(at: Date): string {
  const t = new Date(at.getTime() + 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
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
      instructions:
        'Which of the options is the date and time of the transfer shown on the receipt? Times are Tashkent local time. Pick "none" if the receipt shows none of them.',
      options: [
        ...input.candidates.map((c, i) => ({
          key: candidateKey(i),
          description: `Transfer of ${input.amountDue} so'm at ${formatTashkent(c.at)}`,
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
