import { Logger } from '@nestjs/common';
import {
  passesThresholds,
  type ReceiptJudge,
  type ReceiptJudgeInput,
  type ReceiptJudgement,
} from '../receipt-judge';
import { JudgeFailure, requireImage, type ProviderJudge } from './questions';

export interface JudgeConfig {
  probability: number;
  confidence: number;
  typesafeTimeoutMs: number;
  openaiTimeoutMs: number;
}

const NOT_CONFIRMED = {
  isReceipt: 0,
  amountMatches: 0,
  recipientMatches: 0,
  chosenCreditId: null,
  choiceConfidence: 0,
  confirmed: false,
  provider: 'none',
} as const;

/**
 * TypeSafe first; OpenAI when TypeSafe errors, times out, refuses, or answers below threshold (ADR 0013).
 * `confirmed` is true only when one provider's answer passed the thresholds. Otherwise it is false and
 * `reason` says why; the receipt then waits for a person. A missing adapter (no API key) fails as
 * `not-configured`.
 */
export class FallbackReceiptJudge implements ReceiptJudge {
  private readonly log = new Logger('ReceiptJudge');
  constructor(
    private readonly primary: ProviderJudge | null,
    private readonly fallback: ProviderJudge | null,
    private readonly config: () => Promise<JudgeConfig>,
  ) {}

  async judge(input: ReceiptJudgeInput): Promise<ReceiptJudgement> {
    try {
      requireImage(input.image);
    } catch (e) {
      return this.notConfirmed((e as Error).message);
    }
    const cfg = await this.config();
    const t = { probability: cfg.probability, confidence: cfg.confidence };
    const problems: string[] = [];
    let weak: ReceiptJudgement | null = null;
    for (const [name, p, timeout] of [
      ['typesafe', this.primary, cfg.typesafeTimeoutMs],
      ['openai', this.fallback, cfg.openaiTimeoutMs],
    ] as const) {
      if (!p) {
        problems.push(`${name}: ${new JudgeFailure('not-configured', 'no API key').message}`);
        continue;
      }
      try {
        const a = await p.judge(input, timeout);
        if (passesThresholds(a, t)) return { ...a, confirmed: true };
        problems.push(`${name}: below threshold`);
        weak = { ...a, confirmed: false };
      } catch (e) {
        problems.push(
          e instanceof JudgeFailure
            ? `${name}: ${e.message}`
            : `${name}: error: ${(e as Error).message}`,
        );
      }
    }
    // Neither convinced. Keep the last real answer for the audit trail (it is not confirmed).
    const reason = problems.join('; ');
    this.log.warn(`receipt not confirmed by AI: ${reason}`);
    return weak ? { ...weak, reason } : this.notConfirmed(reason);
  }

  private notConfirmed(reason: string): ReceiptJudgement {
    this.log.warn(`receipt AI failed: ${reason}`);
    return { ...NOT_CONFIRMED, reason };
  }
}
