/**
 * Hand-run eval (COSTS MONEY, never in CI): runs the real judges over labelled receipts and prints
 * accuracy per threshold pair.
 *
 *   node --env-file=../../.env --import tsx scripts/receipt-eval.ts <dir>
 *
 * <dir> holds receipt images (png/jpg) and a labels.json:
 *   { "file.png": { "amountDue": 120000, "cardLast4": "4242", "holderName": "NAME",
 *                   "candidates": [{ "creditId": 1, "amount": 120000, "at": "2026-11-09T09:30:00Z" }],
 *                   "expect": { "confirm": true, "creditId": 1 } } }
 * "expect.confirm": a correct system confirms this receipt with `creditId` (null/false = must not confirm).
 * Each receipt is judged once per provider; thresholds are then swept offline over the raw answers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OpenAiDecisionsJudge,
  TypeSafeJudge,
  passesThresholds,
  type ProviderJudge,
  type ProviderAnswer,
} from '../src/edges';

const dir = process.argv[2];
if (!dir) throw new Error('usage: receipt-eval.ts <dir>');
type Label = {
  amountDue: number;
  cardLast4: string;
  holderName: string;
  candidates: { creditId: number; amount: number; at: string }[];
  expect: { confirm: boolean; creditId?: number | null };
};
const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as Record<string, Label>;

const providers: ProviderJudge[] = [];
if (process.env.TYPESAFE_API_KEY)
  providers.push(new TypeSafeJudge({ apiKey: process.env.TYPESAFE_API_KEY }));
if (process.env.OPENAI_API_KEY)
  providers.push(new OpenAiDecisionsJudge({ apiKey: process.env.OPENAI_API_KEY }));
if (!providers.length) throw new Error('set TYPESAFE_API_KEY and/or OPENAI_API_KEY');

const probs = [0.6, 0.7, 0.8, 0.9, 0.95];
const confs = [0.4, 0.5, 0.6, 0.7, 0.8];

for (const p of providers) {
  const answers: { label: Label; j: ProviderAnswer | null }[] = [];
  for (const [file, label] of Object.entries(labels)) {
    const bytes = new Uint8Array(readFileSync(join(dir, file)));
    const j = await p
      .judge(
        {
          image: bytes,
          mimeType: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
          ...label,
          candidates: label.candidates.map((c) => ({
            creditId: c.creditId,
            amount: c.amount,
            at: new Date(c.at),
          })),
        },
        60_000,
      )
      .catch((e: Error) => {
        console.error(`${p.name} ${file}: ${e.message}`);
        return null;
      });
    answers.push({ label, j });
  }
  console.log(
    `\n${p.name}: ${answers.length} receipts, ${answers.filter((a) => !a.j).length} failed calls`,
  );
  console.log('prob  conf  accuracy  false-confirm  missed');
  for (const probability of probs)
    for (const confidence of confs) {
      let ok = 0,
        falseConfirm = 0,
        missed = 0;
      for (const { label, j } of answers) {
        const confirmed = !!j && passesThresholds(j, { probability, confidence });
        const right = confirmed
          ? label.expect.confirm && j!.chosenCreditId === (label.expect.creditId ?? null)
          : !label.expect.confirm;
        if (right) ok++;
        else if (confirmed) falseConfirm++;
        else missed++;
      }
      console.log(
        `${probability.toFixed(2)}  ${confidence.toFixed(2)}  ${((ok / answers.length) * 100).toFixed(0).padStart(6)}%  ${String(falseConfirm).padStart(12)}  ${String(missed).padStart(6)}`,
      );
    }
}
