import { LANGUAGES } from '@lummi/i18n';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
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
export const actorTypeEnum = pgEnum('actor_type', ['customer', 'staff', 'ai', 'system']);

/** A Customer is a Telegram account (ADR 0004). */
export const customers = pgTable('customers', {
  id: id(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  username: text('username'),
  language: languageEnum('language').notNull(),
  /** Telegram answered 403 to a send; /start clears it. Reports show such sends as "не доставлено". */
  botBlocked: boolean('bot_blocked').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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

/** Telegram updates already handled, keyed by update_id (dedup for polling and webhook). Pruned by a sweep. */
export const processedUpdates = pgTable('processed_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  createdAt: createdAt(),
});

/**
 * Transactional outbox (ADR 0021): callers insert in the same transaction as the state change.
 * Pending = neither sent_at nor failed_at. queued_at is the marker stamped when the worker hands the
 * row to BullMQ; a row stuck queued past the requeue window is handed over again (jobId = id dedups).
 */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    threadId: integer('thread_id'),
    text: text('text').notNull(),
    options: jsonb('options').notNull().default({}),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('outbox_pending_idx')
      .on(t.createdAt)
      .where(sql`sent_at is null and failed_at is null`),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type ActorType = (typeof actorTypeEnum.enumValues)[number];
