import type { Db } from '@lummi/db';
import type { Env } from '../env';
import { readSettings } from '../settings/settings.service';
import {
  FallbackReceiptJudge,
  OpenAiDecisionsJudge,
  TypeSafeJudge,
  type JudgeConfig,
} from './receipt-ai';
import type { ReceiptJudge } from './receipt-judge';

/**
 * Production wiring of the ReceiptJudge edge. Settings are read through the same definitions as
 * SettingsService (edges are built before the Nest container, so it cannot be injected), in one query
 * per judgement. A missing key leaves that adapter out, and it fails as `not-configured`.
 */
export function createReceiptJudge(env: Env, db: Db): ReceiptJudge {
  const config = async (): Promise<JudgeConfig> => {
    const s = await readSettings(db, [
      'ai.receipt.probabilityThreshold',
      'ai.receipt.confidenceThreshold',
      'ai.receipt.typesafeTimeoutMs',
      'ai.receipt.openaiTimeoutMs',
    ]);
    return {
      probability: s['ai.receipt.probabilityThreshold'],
      confidence: s['ai.receipt.confidenceThreshold'],
      typesafeTimeoutMs: s['ai.receipt.typesafeTimeoutMs'],
      openaiTimeoutMs: s['ai.receipt.openaiTimeoutMs'],
    };
  };
  return new FallbackReceiptJudge(
    env.TYPESAFE_API_KEY
      ? new TypeSafeJudge({ apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL })
      : null,
    env.OPENAI_API_KEY
      ? new OpenAiDecisionsJudge({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL })
      : null,
    config,
  );
}
