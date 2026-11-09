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
  'auth.loginWidgetMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
  },
  'auth.staffSessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(300)
      .max(30 * 86_400),
    default: 7 * 86_400,
  },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;
export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];
