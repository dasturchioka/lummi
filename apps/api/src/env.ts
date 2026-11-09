import { z } from 'zod';

const port = z.coerce.number().int().min(0).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: port.default(4000),
  DATABASE_URL: z.string().url(),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required (signing key of initData)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  FILES_DIR: z.string().min(1).default('./media'),
});
export type Env = z.infer<typeof envSchema>;

/** Throws with a readable list of problems; main.ts lets that kill the process. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
