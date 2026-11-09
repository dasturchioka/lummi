import { LANGUAGES } from '@lummi/i18n';
import { z } from 'zod';

export const languageSchema = z.enum(LANGUAGES);

export const telegramAuthBodySchema = z.object({ initData: z.string().min(1).max(8192) });

export const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
});

export const customerSchema = z.object({
  id: z.number().int(),
  telegramId: z.number().int(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  username: z.string().nullable(),
  language: languageSchema,
});
export type CustomerDto = z.infer<typeof customerSchema>;

export const authErrorSchema = z.object({
  code: z.enum(['invalid_init_data', 'expired_init_data', 'unauthorized']),
});
