import { z } from 'zod';
import { settingIssueSchema } from './setting-issues';
import { passwordSchema, staffLoginSchema } from './staff-access';
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

/** Sign-in by login and password (ADR 0038); the login is matched case-insensitively. */
export const passwordLoginBodySchema = z.object({
  login: z.string().max(64),
  password: passwordSchema,
});

/** A staff member as the panel sees them: never a password or its hash (ADR 0038). */
export const staffSchema = z.object({
  id: z.number().int(),
  /** Null until the member binds a Telegram account through the bot. */
  telegramId: z.number().int().nullable(),
  /** Null for a Telegram-only record (one added before #50). */
  login: z.string().nullable(),
  /** Whether a password is set; the hash itself never leaves the API. */
  hasPassword: z.boolean(),
  /** Signed in with a temporary password: only «Смените пароль» works until it is changed. */
  mustChangePassword: z.boolean(),
  name: z.string(),
  role: staffRoleSchema,
  active: z.boolean(),
});
export type StaffDto = z.infer<typeof staffSchema>;

export const adminErrorSchema = z.object({
  code: z.enum([
    'invalid_login',
    'expired_login',
    'invalid_credentials',
    'no_access',
    'unauthorized',
    'forbidden',
    'password_change_required',
    'not_found',
    'conflict',
    'not_available',
    'login_taken',
    'login_required',
    'already_linked',
    'telegram_only',
  ]),
});

/** Too many wrong passwords for this login or from this address: try again at `retryAt`. */
export const lockedErrorSchema = z.object({
  code: z.literal('locked'),
  retryAt: z.string().datetime(),
});

/** A new password refused: shorter than the setting, or the same as the one it replaces. */
export const passwordErrorSchema = z.object({
  code: z.enum(['weak_password', 'same_password', 'wrong_password']),
  /** `auth.passwordMinLength`, for the message. */
  minLength: z.number().int(),
});

/** The owner adds a manager with a temporary password (generated in the panel, or typed). */
export const createManagerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  login: staffLoginSchema,
  password: passwordSchema,
});
export const updateStaffBodySchema = z.object({ active: z.boolean() });

/** «Сбросить пароль»: a new temporary password; a manager without a login gets one with it. */
export const resetPasswordBodySchema = z.object({
  password: passwordSchema,
  login: staffLoginSchema.optional(),
});

/**
 * «Сменить пароль». `currentPassword` is required while the account has a password that is not
 * temporary; a forced change (or a first password) needs only the new one.
 */
export const changePasswordBodySchema = z.object({
  currentPassword: passwordSchema.optional(),
  newPassword: passwordSchema,
});

export const passwordPolicySchema = z.object({ minLength: z.number().int() });

/** «Привязать Telegram»: the one-time bot link and when it stops working. */
export const telegramLinkSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type TelegramLinkDto = z.infer<typeof telegramLinkSchema>;

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
  /**
   * The target's name while it still exists: a staff member, a banner (its RU title), a fragrance,
   * or the fragrance of a volume; null for any other target or a deleted one.
   */
  targetName: z.string().nullable(),
  /** The same name in Uzbek (a banner's UZ title; otherwise equal to `targetName`). */
  targetNameUz: z.string().nullable(),
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
