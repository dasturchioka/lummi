import { settingDefinitions, type SettingKey, type SettingValue } from '@lummi/contracts';
import { eq, settings, type Db } from '@lummi/db';
import type { Env } from '../env';
import {
  FallbackReceiptJudge,
  OpenAiDecisionsJudge,
  TypeSafeJudge,
  type JudgeConfig,
} from './receipt-ai';
import type { ReceiptJudge } from './receipt-judge';

/** Read-only settings access that does not need the Nest container (edges are built before it). */
function reader(db: Db) {
  return async <K extends SettingKey>(key: K): Promise<SettingValue<K>> => {
    const def = settingDefinitions[key];
    const [row] = await db.select().from(settings).where(eq(settings.key, key));
    return (row ? def.schema.parse(row.value) : def.default) as SettingValue<K>;
  };
}

/** Production wiring of the ReceiptJudge edge; a missing key leaves that adapter out ("failed"). */
export function createReceiptJudge(env: Env, db: Db): ReceiptJudge {
  const get = reader(db);
  const config = async (): Promise<JudgeConfig> => ({
    probability: await get('ai.receipt.probabilityThreshold'),
    confidence: await get('ai.receipt.confidenceThreshold'),
    typesafeTimeoutMs: await get('ai.receipt.typesafeTimeoutMs'),
    openaiTimeoutMs: await get('ai.receipt.openaiTimeoutMs'),
  });
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
