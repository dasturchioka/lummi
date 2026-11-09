import { LANGUAGES } from '@lummi/i18n';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
  /** Telegram answered 403 to a send; /start clears it. Reports show such sends as "не доставлено". */
  botBlocked: boolean('bot_blocked').notNull().default(false),
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

/** Telegram updates already handled, keyed by update_id (dedup for polling and webhook). Pruned by a sweep. */
export const processedUpdates = pgTable('processed_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  createdAt: createdAt(),
});

/**
 * Transactional outbox (ADR 0021): callers insert in the same transaction as the state change.
 * Pending = neither sent_at nor failed_at. queued_at is the marker stamped when the worker hands the
 * row to BullMQ; a row stuck queued past the requeue window is handed over again (jobId = id dedups).
 * sending_at is the claim taken just before the Telegram call, so a slow retry cannot race a re-queue.
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
    /** Claimed by a delivery attempt; a crashed attempt's claim expires after the requeue window. */
    sendingAt: timestamp('sending_at', { withTimezone: true }),
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

/**
 * Every Humo bot message the userbot posted (ADR 0014), keyed by its Telegram message id so a repeat
 * post changes nothing; the highest id is where the userbot's catch-up resumes. Debits (➖) are never
 * stored. `parse_error` is null when the message became a credit; otherwise it names the field that
 * did not fit the template ('amount', 'time', 'card') and the owner was alerted. The raw text stays
 * here either way.
 */
export const humoMessages = pgTable('humo_messages', {
  messageId: bigint('message_id', { mode: 'number' }).primaryKey(),
  text: text('text').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  parseError: text('parse_error'),
});

/**
 * A Credit (GLOSSARY): an incoming transfer to the shop card, from a ➕ Humo notification.
 * `amount_tiyin` is exact. `amount_som` is what payment matching compares with an order's amount
 * due, in whole so'm; it is null when the credit has tiyin, which then can never match exactly.
 * Payment matching adds the link to an order.
 */
export const credits = pgTable(
  'credits',
  {
    id: id(),
    humoMessageId: bigint('humo_message_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => humoMessages.messageId),
    amountTiyin: bigint('amount_tiyin', { mode: 'number' }).notNull(),
    amountSom: bigint('amount_som', { mode: 'number' }).generatedAlwaysAs(
      sql`case when amount_tiyin % 100 = 0 then amount_tiyin / 100 end`,
    ),
    /**
     * The notification's Asia/Tashkent time as UTC. Minute precision (Humo shows no seconds), so a
     * transfer in the same minute as the order reads as up to 59 s before it.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** The card line as Humo writes it, e.g. «HUMOCARD *1234». */
    cardMask: text('card_mask').notNull(),
    cardLast4: text('card_last4').notNull(),
    /** The «📍» line, e.g. «CLICK P2P HUMO2UZCAR»; not used for matching. */
    counterparty: text('counterparty'),
  },
  (t) => [
    check('credits_amount_positive', sql`${t.amountTiyin} > 0`),
    check('credits_card_last4', sql`${t.cardLast4} ~ '^[0-9]{4}$'`),
  ],
);

/** Last time a background process reported in, by name ('userbot'); feeds the Humo-silence guard (ADR 0012). */
export const heartbeats = pgTable('heartbeats', {
  component: text('component').primaryKey(),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
});

export type OutboxRow = typeof outbox.$inferSelect;
export type CreditRow = typeof credits.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type StaffRow = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRoleEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];
