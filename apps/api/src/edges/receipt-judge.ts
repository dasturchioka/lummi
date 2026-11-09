/** Decision questions about a receipt image (ADR 0013). The AI never sees phone or address. */
export interface ReceiptJudgeInput {
  image: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  amountDue: number;
  cardLast4: string;
  holderName: string;
  candidates: { creditId: number; at: Date }[];
}

export interface ReceiptJudgement {
  /** Probabilities in 0..1. */
  isReceipt: number;
  amountMatches: number;
  recipientMatches: number;
  /** Chosen candidate credit, or null for "none of these". */
  chosenCreditId: number | null;
  choiceConfidence: number;
  /** Which adapter produced the answer; 'none' when every adapter failed (never confirms). */
  provider?: 'typesafe' | 'openai' | 'none';
  /** Why the adapters failed or were not trusted, for the audit trail and logs. */
  failure?: string;
}

export interface ReceiptThresholds {
  probability: number;
  confidence: number;
}

/** ADR 0013: all predicates >= probability, and a real (non-"none") choice >= confidence. */
export function confirmsReceipt(j: ReceiptJudgement, t: ReceiptThresholds): boolean {
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
