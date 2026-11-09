import { z } from 'zod';
import type { ReceiptJudgeInput, ReceiptJudgement } from '../receipt-judge';
import {
  JudgeFailure,
  NONE_OPTION,
  buildQuestions,
  candidateKey,
  postJson,
  sniffImage,
  type ProviderJudge,
} from './questions';

const answer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('predicate'),
    name: z.string(),
    probability: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('choice'),
    name: z.string(),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal('refusal'), name: z.string() }),
]);
const response = z.object({ answers: z.array(answer) });

/** OpenAI Decisions, POST /v1/decisions, model gpt-6-luna. See ./API-NOTES.md. */
export class OpenAiDecisionsJudge implements ProviderJudge {
  readonly name = 'openai' as const;
  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      fetch?: typeof fetch;
    },
  ) {}

  buildRequest(input: ReceiptJudgeInput) {
    const kind = sniffImage(input.image);
    if (!kind) throw new JudgeFailure('bad-input', 'image is not PNG or JPEG');
    const q = buildQuestions(input);
    return {
      model: this.opts.model ?? 'gpt-6-luna',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Payment receipt screenshot:' },
            {
              type: 'input_image',
              image_url: `data:image/${kind};base64,${Buffer.from(input.image).toString('base64')}`,
            },
          ],
        },
      ],
      questions: [
        { type: 'predicate', name: 'isReceipt', instructions: q.isReceipt },
        { type: 'predicate', name: 'amountMatches', instructions: q.amountMatches },
        { type: 'predicate', name: 'recipientMatches', instructions: q.recipientMatches },
        {
          type: 'choice',
          name: 'time',
          instructions: q.time.instructions,
          choices: q.time.options.map((o) => ({ value: o.key, description: o.description })),
        },
      ],
    };
  }

  async judge(input: ReceiptJudgeInput, timeoutMs: number): Promise<ReceiptJudgement> {
    const raw = await postJson(
      this.opts.fetch ?? fetch,
      `${this.opts.baseUrl ?? 'https://api.openai.com'}/v1/decisions`,
      { authorization: `Bearer ${this.opts.apiKey}` },
      this.buildRequest(input),
      timeoutMs,
    );
    const parsed = response.safeParse(raw);
    if (!parsed.success) throw new JudgeFailure('error', 'unexpected response shape');
    const byName = new Map(parsed.data.answers.map((a) => [a.name, a]));
    for (const a of byName.values())
      if (a.type === 'refusal') throw new JudgeFailure('refusal', `question ${a.name} refused`);
    const p = (name: string) => {
      const a = byName.get(name);
      if (a?.type !== 'predicate') throw new JudgeFailure('error', `missing answer ${name}`);
      return a.probability;
    };
    const time = byName.get('time');
    if (time?.type !== 'choice') throw new JudgeFailure('error', 'missing answer time');
    const index = input.candidates.findIndex((_, i) => candidateKey(i) === time.choice);
    return {
      isReceipt: p('isReceipt'),
      amountMatches: p('amountMatches'),
      recipientMatches: p('recipientMatches'),
      chosenCreditId:
        time.choice === NONE_OPTION || index < 0 ? null : input.candidates[index]!.creditId,
      choiceConfidence: time.confidence,
      provider: 'openai',
    };
  }
}
