import { z } from 'zod';

const port = z.coerce.number().int().min(0).max(65535);

const botModes = ['polling', 'webhook', 'off'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: port.default(4000),
    DATABASE_URL: z.string().url(),
    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required (signing key of initData)'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    FILES_DIR: z.string().min(1).default('./media'),
    /** polling: local dev (one poller per token); webhook: staging and production; off: tests, API-only runs. */
    BOT_MODE: z.enum(botModes).default('off'),
    /** Public https URL Telegram posts updates to (webhook mode), and the secret it echoes in a header. */
    WEBHOOK_URL: z.string().url().optional(),
    WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/, 'WEBHOOK_SECRET must be 1-256 chars of A-Z a-z 0-9 _ -')
      .optional(),
    /** The Mini App https URL behind the web_app button and the menu button (ADR 0023: a tunnel hostname locally). */
    MINIAPP_URL: z.string().url().optional(),
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  })
  .superRefine((env, ctx) => {
    if (env.BOT_MODE === 'webhook') {
      for (const key of ['WEBHOOK_URL', 'WEBHOOK_SECRET'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when BOT_MODE=webhook`,
          });
        }
      }
    }
  });
export type Env = z.infer<typeof envSchema>;

/** `.env.example` placeholder; a production deploy that forgets to replace it must not boot. */
export const PLACEHOLDER_SESSION_SECRET = 'change-me-change-me-change-me-change-me';

/** Throws with a readable list of problems; main.ts lets that kill the process. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (
    result.success &&
    result.data.NODE_ENV === 'production' &&
    result.data.SESSION_SECRET.startsWith('change-me')
  ) {
    throw new Error(
      'Invalid environment:\n  SESSION_SECRET: placeholder value is not allowed in production',
    );
  }
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
