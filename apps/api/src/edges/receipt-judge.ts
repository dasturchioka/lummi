/** Decision questions about a receipt image (ADR 0013). The AI never sees phone or address. */
export interface ReceiptJudgeInput {
  image: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  amountDue: number;
  cardLast4: string;
  holderName: string;
  /** Each unclaimed credit: its own amount (so'm) and arrival time. */
  candidates: { creditId: number; amount: number; at: Date }[];
}

/** What one provider says; the probabilities are in 0..1. */
export interface ProviderAnswer {
  isReceipt: number;
  amountMatches: number;
  recipientMatches: number;
  /** Chosen candidate credit, or null for "none of these". */
  chosenCreditId: number | null;
  choiceConfidence: number;
  provider: 'typesafe' | 'openai';
}

/**
 * The verdict. **Only `confirmed` counts**: it is true solely when a provider's answer passed the
 * probability and confidence thresholds with a real credit chosen. Callers must not re-derive trust
 * from the numbers; when `confirmed` is false the receipt waits for a person (ADR 0012/0013).
 * The numbers are kept for the audit trail and tuning only.
 */
export interface ReceiptJudgement extends Omit<ProviderAnswer, 'provider'> {
  confirmed: boolean;
  provider: ProviderAnswer['provider'] | 'none';
  /** Why it is not confirmed (failure, timeout, refusal, not configured, below threshold). */
  reason?: string;
}

/**
 * Whether a provider answered at all. `provider: 'none'` means none could be asked (both errored
 * or timed out, refused, not configured, or the image was unusable): a failure to retry, not an
 * answer. An answer, confirmed or not, is final.
 */
export const answered = (j: ReceiptJudgement): boolean => j.provider !== 'none';

export interface ReceiptThresholds {
  probability: number;
  confidence: number;
}

/** ADR 0013: all predicates >= probability, and a real (non-"none") choice >= confidence. */
export function passesThresholds(
  j: Omit<ProviderAnswer, 'provider'>,
  t: ReceiptThresholds,
): boolean {
  return (
    j.isReceipt >= t.probability &&
    j.amountMatches >= t.probability &&
    j.recipientMatches >= t.probability &&
    j.chosenCreditId !== null &&
    j.choiceConfidence >= t.confidence
  );
}

export interface ReceiptJudge {
  judge(input: ReceiptJudgeInput): Promise<ReceiptJudgement>;
}

export class UnconfiguredReceiptJudge implements ReceiptJudge {
  judge(): Promise<ReceiptJudgement> {
    return Promise.reject(new Error('ReceiptJudge is not configured yet'));
  }
}
