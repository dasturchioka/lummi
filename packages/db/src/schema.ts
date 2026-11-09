import { LANGUAGES } from '@lummi/i18n';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** Internal keys are `bigint identity` (ADR 0016); money columns elsewhere are `integer` so'm. */
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const languageEnum = pgEnum('language', LANGUAGES);
export const staffRoleEnum = pgEnum('staff_role', ['owner', 'manager']);
export const actorTypeEnum = pgEnum('actor_type', ['customer', 'staff', 'ai', 'system']);

/** A Customer is a Telegram account (ADR 0004). */
export const customers = pgTable('customers', {
  id: id(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  language: languageEnum('language').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Staff (ADR 0017): gates the admin panel and the orders-group buttons; audit entries point here. */
export const staff = pgTable('staff', {
  id: id(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  name: text('name').notNull(),
  role: staffRoleEnum('role').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Admin panel sessions: the cookie holds a random token, only its SHA-256 is stored; revocable. */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: id(),
    staffId: bigint('staff_id', { mode: 'number' })
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('staff_sessions_staff_idx').on(t.staffId)],
);

/** Admin-editable rule values; typed keys live in @lummi/contracts. Missing row = default. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: bigint('actor_id', { mode: 'number' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_target_idx').on(t.targetType, t.targetId),
    index('audit_log_created_idx').on(t.createdAt),
  ],
);

export type CustomerRow = typeof customers.$inferSelect;
export type StaffRow = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRoleEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];
