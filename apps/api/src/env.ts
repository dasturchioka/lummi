import { z } from 'zod';

const port = z.coerce.number().int().min(0).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: port.default(4000),
  DATABASE_URL: z.string().url(),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required (signing key of initData)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** Dev/test-only admin sign-in without the Login Widget; refused in production (see parseEnv). */
  ADMIN_DEV_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  FILES_DIR: z.string().min(1).default('./media'),
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
  if (result.success && result.data.NODE_ENV === 'production' && result.data.ADMIN_DEV_LOGIN) {
    throw new Error(
      'Invalid environment:\n  ADMIN_DEV_LOGIN: the dev-only admin sign-in must not be enabled in production',
    );
  }
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
