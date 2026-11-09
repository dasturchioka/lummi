import { z } from 'zod';
import { settingIssueSchema } from './setting-issues';
import { tashkentToUtc } from './tashkent';

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

/** A setting as the page shows it: the effective value (default when nothing is stored). */
export const settingStateSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  /** When the owner last changed it; null while it still has its default. */
  updatedAt: z.string().datetime().nullable(),
  /** The stored value no longer fits the registry; `value` shows the default until it is saved again. */
  invalid: z.boolean(),
});
export type SettingState = z.infer<typeof settingStateSchema>;

export const updateSettingBodySchema = z.object({ value: z.unknown() });
export const settingErrorSchema = z.object({
  code: z.literal('invalid_value'),
  issues: z.array(settingIssueSchema),
});

/** `YYYY-MM-DD`, a real calendar day, read as a Tashkent date. */
export const tashkentDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const [year, month, day] = v.split('-').map(Number) as [number, number, number];
    return tashkentToUtc({ year, month, day, hour: 0, minute: 0 }) !== null;
  }, 'not a calendar day');

/** `staff:<id>`, or a bare actor type for everyone of that type. */
export const auditActorFilterSchema = z.string().regex(/^(staff:\d{1,15}|customer|ai|system)$/);

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  actor: auditActorFilterSchema.optional(),
  action: z.string().min(1).max(100).optional(),
  /** First day, Tashkent, inclusive. */
  from: tashkentDaySchema.optional(),
  /** Last day, Tashkent, inclusive. */
  to: tashkentDaySchema.optional(),
});
export type AuditQuery = z.input<typeof auditQuerySchema>;

export const auditEntrySchema = z.object({
  id: z.number().int(),
  createdAt: z.string().datetime(),
  actorType: z.enum(['customer', 'staff', 'ai', 'system']),
  actorId: z.number().int().nullable(),
  /** Staff or customer name when the actor still exists. */
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  /** A staff target's name while the staff member still exists; null for any other target. */
  targetName: z.string().nullable(),
  payload: z.record(z.unknown()),
});
export type AuditEntryDto = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const auditFiltersSchema = z.object({
  /** Every action type that has been logged. */
  actions: z.array(z.string()),
  actors: z.array(
    z.object({
      value: auditActorFilterSchema,
      type: z.enum(['customer', 'staff', 'ai', 'system']),
      name: z.string().nullable(),
    }),
  ),
});
