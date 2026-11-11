import { z } from 'zod';
import { parseSessionKey } from './session-crypto';

/**
 * The userbot's configuration (ADR 0023: validated at start, a bad config refuses to boot). Error
 * messages name the key and what is wrong with it, never its value: two of these are secrets.
 */

const apiId = z.coerce.number().int().positive();
const apiHash = z
  .string()
  .regex(/^[0-9a-f]{32}$/, 'must be the 32 hex characters from my.telegram.org');
const sessionKey = z.string().superRefine((value, ctx) => {
  try {
    parseSessionKey(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must be 32 random bytes in base64 (openssl rand -base64 32)',
    });
  }
});
const sessionFile = z.string().min(1).default('/data/userbot/session.enc');

/** What logging in needs: the app credentials and where the encrypted session goes. */
export const loginEnvSchema = z.object({
  USERBOT_API_ID: apiId,
  USERBOT_API_HASH: apiHash,
  USERBOT_SESSION_KEY: sessionKey,
  USERBOT_SESSION_FILE: sessionFile,
});
export type LoginEnv = z.infer<typeof loginEnvSchema>;

/** What the running userbot needs on top. */
export const envSchema = loginEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** The API on the internal network (ADR 0031): http://api:4000 in Compose. */
  API_URL: z.string().url().default('http://127.0.0.1:4000'),
  INTERNAL_API_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /**
   * The one chat the userbot reads (ADR 0014, ADR 0023): the official Humo bot's user id in
   * production, our test bot's elsewhere. A server value, deliberately not an admin setting: whoever
   * could change it could pipe any private chat of this personal account into our database.
   */
  USERBOT_LISTEN_CHAT_ID: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type Env = z.infer<typeof envSchema>;

/** Parse, or throw an error that lists the bad keys and why, without echoing any value. */
export function parseEnv<S extends z.ZodTypeAny>(schema: S, source: NodeJS.ProcessEnv): z.infer<S> {
  const res = schema.safeParse(source);
  if (res.success) return res.data;
  const problems = res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`invalid userbot configuration:\n  ${problems.join('\n  ')}`);
}
