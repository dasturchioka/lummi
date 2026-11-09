import { z } from 'zod';

export const staffRoleSchema = z.enum(['owner', 'manager']);

/** Fields the Telegram Login Widget returns; the API checks `hash` against the bot token. */
export const loginWidgetBodySchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string().min(1).max(256),
    last_name: z.string().max(256).optional(),
    username: z.string().max(256).optional(),
    photo_url: z.string().max(2048).optional(),
    auth_date: z.number().int().positive(),
    hash: z.string().min(1).max(256),
    // Telegram may add fields; they are part of the signed string, so keep them.
  })
  .passthrough();
export type LoginWidgetBody = z.infer<typeof loginWidgetBodySchema>;

/** Dev-only sign-in (disabled by the env schema in production). */
export const devLoginBodySchema = z.object({ telegramId: z.number().int().positive() });

export const staffSchema = z.object({
  id: z.number().int(),
  telegramId: z.number().int(),
  name: z.string(),
  role: staffRoleSchema,
  active: z.boolean(),
});
export type StaffDto = z.infer<typeof staffSchema>;

export const adminErrorSchema = z.object({
  code: z.enum([
    'invalid_login',
    'expired_login',
    'no_access',
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'not_available',
  ]),
});

export const createManagerBodySchema = z.object({
  telegramId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
});
export const updateStaffBodySchema = z.object({ active: z.boolean() });
