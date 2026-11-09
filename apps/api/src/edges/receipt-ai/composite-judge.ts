import { Logger } from '@nestjs/common';
import {
  confirmsReceipt,
  type ReceiptJudge,
  type ReceiptJudgeInput,
  type ReceiptJudgement,
} from '../receipt-judge';
import { JudgeFailure, sniffImage, type ProviderJudge } from './questions';

export interface JudgeConfig {
  probability: number;
  confidence: number;
  typesafeTimeoutMs: number;
  openaiTimeoutMs: number;
}

const FAILED: ReceiptJudgement = {
  isReceipt: 0,
  amountMatches: 0,
  recipientMatches: 0,
  chosenCreditId: null,
  choiceConfidence: 0,
  provider: 'none',
};

/**
 * TypeSafe first; OpenAI when TypeSafe errors, times out, refuses, or answers below threshold (ADR 0013).
 * When neither gives a trustworthy answer the result never confirms and says why in `failure`.
 * A missing adapter (no API key) counts as failed.
 */
export class FallbackReceiptJudge implements ReceiptJudge {
  private readonly log = new Logger('ReceiptJudge');
  constructor(
    private readonly primary: ProviderJudge | null,
    private readonly fallback: ProviderJudge | null,
    private readonly config: () => Promise<JudgeConfig>,
  ) {}

  async judge(input: ReceiptJudgeInput): Promise<ReceiptJudgement> {
    if (!sniffImage(input.image)) return this.fail('image is not PNG or JPEG');
    const cfg = await this.config();
    const t = { probability: cfg.probability, confidence: cfg.confidence };
    const problems: string[] = [];
    let weak: ReceiptJudgement | null = null;
    for (const [p, timeout] of [
      [this.primary, cfg.typesafeTimeoutMs],
      [this.fallback, cfg.openaiTimeoutMs],
    ] as const) {
      if (!p) {
        problems.push('adapter not configured');
        continue;
      }
      try {
        const j = await p.judge(input, timeout);
        if (confirmsReceipt(j, t)) return j;
        problems.push(`${p.name}: below threshold`);
        weak = j;
      } catch (e) {
        problems.push(
          e instanceof JudgeFailure
            ? `${p.name}: ${e.message}`
            : `${p.name}: error: ${(e as Error).message}`,
        );
      }
    }
    // Both ran but neither convinced: report the last real answer (it will not confirm). Both failed: zeros.
    const failure = problems.join('; ');
    this.log.warn(`receipt not confirmed by AI: ${failure}`);
    return weak ? { ...weak, failure } : this.fail(failure);
  }

  private fail(failure: string): ReceiptJudgement {
    this.log.warn(`receipt AI failed: ${failure}`);
    return { ...FAILED, failure };
  }
}
