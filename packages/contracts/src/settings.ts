import { z } from 'zod';

/**
 * Every rule value is a setting (CLAUDE.md invariant). Add a key here with its zod schema
 * and default; services read it through SettingsService, admins change it through
 * SettingsService.set (which writes the audit entry).
 */
export const settingDefinitions = {
  'auth.initDataMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
  },
  'auth.initDataMaxFutureSkewSeconds': {
    schema: z.number().int().min(0).max(300),
    default: 30,
  },
  'auth.sessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86_400),
    default: 3600,
  },
  // Orders group (spec Changes 2026-11-07). Null until the group is set up; the bot follows migrate_to_chat_id.
  'bot.groupChatId': { schema: z.number().int().nullable(), default: null },
  'bot.topics': {
    schema: z.object({
      orders: z.number().int().nullable(),
      payments: z.number().int().nullable(),
      reviews: z.number().int().nullable(),
      system: z.number().int().nullable(),
    }),
    default: { orders: null, payments: null, reviews: null, system: null },
  },
  /** Telegram ids (owner, developer) who get alerts in DM as well as in the Системные topic. */
  'bot.alertRecipients': { schema: z.array(z.number().int()), default: [] as number[] },
  /** A queued outbox row that was not sent within this window is handed to the queue again. */
  'outbox.requeueAfterSeconds': { schema: z.number().int().min(30).max(86_400), default: 300 },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;
export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];
