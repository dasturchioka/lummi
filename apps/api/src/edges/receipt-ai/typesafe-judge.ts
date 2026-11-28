import { z } from 'zod';
import type { ProviderAnswer, ReceiptJudgeInput } from '../receipt-judge';
import {
  JudgeFailure,
  buildQuestions,
  postJson,
  requireImage,
  resolveChoice,
  type ProviderOptions,
  type ProviderJudge,
} from './questions';

const answers = z.object({
  answers: z.object({
    isReceipt: z.object({ noul: z.number().min(0).max(1) }),
    amountMatches: z.object({ noul: z.number().min(0).max(1) }),
    recipientMatches: z.object({ noul: z.number().min(0).max(1) }),
    time: z.object({ choice: z.string(), confidence: z.number().min(0).max(1) }),
  }),
});

/** TypeSafe Jev, POST /v1/systemone. See ./API-NOTES.md for the sources. */
export class TypeSafeJudge implements ProviderJudge {
  readonly name = 'typesafe' as const;
  constructor(private readonly opts: ProviderOptions) {}

  buildRequest(input: ReceiptJudgeInput) {
    const kind = requireImage(input.image);
    const q = buildQuestions(input);
    const ref = 'receipt-image';
    return {
      model: this.opts.model ?? 'jev-latest',
      state: { receipt: ref },
      assets: {
        [ref]: {
          type: 'image',
          format: kind === 'png' ? 'png' : 'jpg',
          data_base64: Buffer.from(input.image).toString('base64'),
        },
      },
      questions: {
        isReceipt: { type: 'noul', instructions: q.isReceipt },
        amountMatches: { type: 'noul', instructions: q.amountMatches },
        recipientMatches: { type: 'noul', instructions: q.recipientMatches },
        time: {
          type: 'choice',
          instructions: q.time.instructions,
          criteria: Object.fromEntries(q.time.options.map((o) => [o.key, o.description])),
        },
      },
    };
  }

  async judge(input: ReceiptJudgeInput, timeoutMs: number): Promise<ProviderAnswer> {
    const body = this.buildRequest(input);
    const raw = await postJson(
      this.opts.fetch ?? fetch,
      `${this.opts.baseUrl ?? 'https://api.typesafe.ai'}/v1/systemone`,
      {
        authorization: `Bearer ${this.opts.apiKey}`,
        // Images are still experimental; without this header the API answers 400.
        'typesafe-danger-zone-images': 'true',
      },
      body,
      timeoutMs,
    );
    const parsed = answers.safeParse(raw);
    if (!parsed.success) throw new JudgeFailure('error', 'unexpected response shape');
    const a = parsed.data.answers;
    return {
      isReceipt: a.isReceipt.noul,
      amountMatches: a.amountMatches.noul,
      recipientMatches: a.recipientMatches.noul,
      chosenCreditId: resolveChoice(input, a.time.choice),
      choiceConfidence: a.time.confidence,
      provider: 'typesafe',
    };
  }
}
