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
  constructor(private readonly opts: ProviderOptions) {}

  buildRequest(input: ReceiptJudgeInput) {
    const kind = requireImage(input.image);
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

  async judge(input: ReceiptJudgeInput, timeoutMs: number): Promise<ProviderAnswer> {
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
    return {
      isReceipt: p('isReceipt'),
      amountMatches: p('amountMatches'),
      recipientMatches: p('recipientMatches'),
      chosenCreditId: resolveChoice(input, time.choice),
      choiceConfidence: time.confidence,
      provider: 'openai',
    };
  }
}
