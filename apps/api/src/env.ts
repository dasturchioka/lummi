import { isIP } from 'node:net';
import { z } from 'zod';

const port = z.coerce.number().int().min(0).max(65535);

export interface Cidr {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** «127.0.0.0/8,::1/128» → subnets; a malformed entry fails the env check, so the API refuses to boot. */
const cidrList = z.string().transform((value, ctx): Cidr[] => {
  const list: Cidr[] = [];
  for (const entry of value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [address = '', prefixText = ''] = entry.split('/');
    const version = isIP(address);
    const prefix = Number(prefixText);
    const max = version === 6 ? 128 : 32;
    if (version === 0 || !/^\d{1,3}$/.test(prefixText) || prefix > max) {
      ctx.addIssue({ code: 'custom', message: `not a CIDR: «${entry}»` });
      return z.NEVER;
    }
    list.push({ address, prefix, family: version === 6 ? 'ipv6' : 'ipv4' });
  }
  return list;
});

const botModes = ['polling', 'webhook', 'off'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    /** BullMQ queue of the outbox; API and worker must agree (tests use a unique one). */
    OUTBOX_QUEUE: z.string().min(1).default('outbox'),
    /** BullMQ queue of broadcast deliveries; API and worker must agree. */
    BROADCAST_QUEUE: z.string().min(1).default('broadcasts'),
    /** The bot's link; a broadcast button is `<link>?startapp=<target>`. Required in production (the customer's bot, never a default, ADR 0023); locally the dev bot's link. */
    BOT_LINK: z
      .string()
      .url()
      .refine((v) => v.startsWith('https://'), 'must be an https:// link')
      .optional(),
    /** BullMQ queue of domain events the worker handles (credit recorded); API and worker must agree. */
    EVENTS_QUEUE: z.string().min(1).default('events'),
    /** BullMQ queue of the daily birthday-coupon job (a repeatable job, 10:00 Asia/Tashkent; ticket #30). */
    BIRTHDAY_QUEUE: z.string().min(1).default('birthday-coupons'),
    /** BullMQ queue of receipt checks (the receipt AI, ADR 0013); API and worker must agree. */
    RECEIPT_CHECKS_QUEUE: z.string().min(1).default('receipt-checks'),
    /** BullMQ queue of receipts sent to the bot, downloaded and taken in by the worker (#31); API and worker must agree. */
    BOT_RECEIPTS_QUEUE: z.string().min(1).default('bot-receipts'),
    /** BullMQ queue of review photos sent to the bot, fetched and stored by the worker (#41); API and worker must agree. */
    REVIEW_PHOTOS_QUEUE: z.string().min(1).default('review-photos'),
    /** First retry delay of a receipt check whose judge could not answer, and of a bot receipt's download (doubles each time); tests shorten it. */
    RECEIPT_CHECK_BACKOFF_MS: z.coerce.number().int().min(1).default(5000),

    /** Receipt AI keys (ADR 0013). TypeSafe is required in production; OpenAI (the fallback) is optional everywhere and fails as not-configured. */
    TYPESAFE_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    /** Overrides for tests and proxies only. */
    TYPESAFE_BASE_URL: z.string().url().default('https://api.typesafe.ai'),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
    /** Shared secret of the internal endpoints the userbot calls (ADR 0031); unset = they answer 404. */
    INTERNAL_API_SECRET: z
      .string()
      .min(32, 'INTERNAL_API_SECRET must be at least 32 characters')
      .optional(),
    /**
     * Source networks allowed to call the internal endpoints. Loopback only by default (ADR 0031);
     * a Compose deploy where the userbot is its own container adds that network's subnet.
     */
    INTERNAL_ALLOWED_CIDRS: cidrList.default('127.0.0.0/8,::1/128'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.TYPESAFE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TYPESAFE_API_KEY'],
        message: 'TYPESAFE_API_KEY is required in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.BOT_LINK) {
      ctx.addIssue({
        code: 'custom',
        path: ['BOT_LINK'],
        message: 'BOT_LINK is required in production (https://t.me/<bot>)',
      });
    }
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
  // An empty variable counts as unset (NODE_ENV excepted: `NODE_ENV=` must not switch the production checks off): Compose passes `KEY=` for an optional key left blank in .env.
  const given = Object.fromEntries(
    Object.entries(source).filter(([k, v]) => v !== '' || k === 'NODE_ENV'),
  );
  const result = envSchema.safeParse(given);
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

/** Where a dev or test run points broadcast buttons when `BOT_LINK` is unset. */
export const DEV_BOT_LINK = 'https://t.me/lummi_dev_bot';
