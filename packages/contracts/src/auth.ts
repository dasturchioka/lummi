import { LANGUAGES } from '@lummi/i18n';
import { z } from 'zod';

export const languageSchema = z.enum(LANGUAGES);

export const THEMES = ['light', 'dark'] as const;
export const themeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof themeSchema>;

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
  theme: themeSchema,
  /** Account phone from the verified contact, `+998901234567`; null until shared. */
  phone: z.string().nullable(),
  /** The answer to the write-access request; null = not asked yet. */
  writeAccess: z.enum(['granted', 'refused']).nullable(),
});
export type CustomerDto = z.infer<typeof customerSchema>;

export const authErrorSchema = z.object({
  code: z.enum(['invalid_init_data', 'expired_init_data', 'unauthorized']),
});

export const preferencesBodySchema = z
  .object({ language: languageSchema, theme: themeSchema })
  .partial()
  .refine((v) => v.language !== undefined || v.theme !== undefined, 'nothing to change');

/** `raw` is the signed string `requestContact` returns; the server verifies it, never a bare phone. */
export const contactBodySchema = z.object({ proof: z.string().min(1).max(4096) });

export const contactErrorSchema = z.object({
  code: z.enum(['invalid_contact', 'expired_contact', 'contact_not_yours']),
});

/** `session` is set only when the phone relinked an older account: use this token from now on. */
export const contactResultSchema = z.object({
  customer: customerSchema,
  session: sessionSchema.nullable(),
});

export const writeAccessBodySchema = z.object({ allowed: z.boolean() });
