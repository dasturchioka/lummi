import type { Discount } from '@lummi/contracts';
import {
  CAMPAIGN_SOURCES,
  LINE_KINDS,
  ORDER_ACTIONS,
  ORDER_ACTOR_TYPES,
  ORDER_STATUSES,
  RECEIPT_CHECK_OUTCOMES,
  RECEIPT_FILE_KINDS,
  RECEIPT_REVIEW_REASONS,
  RECEIPT_VERDICTS,
  UPGRADE_RIGHT_SOURCES,
  type CancelReason,
  type OrderStatus,
  type ReceiptRejectReason,
} from '@lummi/contracts/constants';
import { LANGUAGES } from '@lummi/i18n';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Internal keys are `bigint identity` (ADR 0016); money columns elsewhere are `integer` so'm. */
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const languageEnum = pgEnum('language', LANGUAGES);
export const staffRoleEnum = pgEnum('staff_role', ['owner', 'manager']);
export const themeEnum = pgEnum('theme', ['light', 'dark']);
export const writeAccessEnum = pgEnum('write_access', ['granted', 'refused']);
/** Who acted: the same list as an order move's actor (`ORDER_ACTOR_TYPES`). */
export const actorTypeEnum = pgEnum('actor_type', ORDER_ACTOR_TYPES);

export const broadcastAudienceEnum = pgEnum('broadcast_audience', ['all', 'ru', 'uz']);
export const broadcastDeliveryStatusEnum = pgEnum('broadcast_delivery_status', [
  'pending',
  'sent',
  'blocked',
  'failed',
]);

/** A Customer is a Telegram account (ADR 0004). */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    username: text('username'),
    language: languageEnum('language').notNull(),
    /** Light by default whatever Telegram says; dark is a Profile option (spec 2026-11-07). */
    theme: themeEnum('theme').notNull().default('light'),
    /** Telegram answered 403 to a send; /start clears it. Reports show such sends as "не доставлено". */
    botBlocked: boolean('bot_blocked').notNull().default(false),
    /** Account phone (ADR 0004): only from Telegram's signed shared contact, `+` and digits, unique. */
    phone: text('phone').unique(),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    /** The answer to requestWriteAccess; null = not asked yet. Refused also sets botBlocked. */
    writeAccess: writeAccessEnum('write_access'),
    /** Delivery city shown on Home (spec 2026-11-07): where, never what it costs. Set together or not at all. */
    deliveryRegionId: bigint('delivery_region_id', { mode: 'number' }).references(() => regions.id),
    deliveryCity: text('delivery_city'),
    /** Data-processing consent (TZ §3.6), given with the first order; null until then. */
    dataConsentAt: timestamp('data_consent_at', { withTimezone: true }),
    /** The first campaign link they ever opened: the acquisition source, never overwritten (ADR 0022). */
    acquisitionLinkId: bigint('acquisition_link_id', { mode: 'number' }).references(
      () => campaignLinks.id,
    ),
    /**
     * Date of birth (TZ §3.8), `YYYY-MM-DD`: entered once by the customer, in Profile or at checkout;
     * afterwards only staff correct it. `birth_date_set_at` starts the abuse guard (no coupon before
     * `birthday.firstCouponAfterDays`). Set together or not at all.
     */
    birthDate: date('birth_date', { mode: 'string' }),
    birthDateSetAt: timestamp('birth_date_set_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'customers_birth_date_check',
      sql`(${t.birthDate} is null) = (${t.birthDateSetAt} is null)`,
    ),
  ],
);

/**
 * The 14 delivery regions (spec §8). `delivery_tariff` is the per-region price in so'm (flat 25 000
 * for now, spec Changes 2026-11-06); only the owner edits it, audited as `region.tariff_changed`.
 */
export const regions = pgTable('regions', {
  id: id(),
  /** Ours, stable. */
  code: text('code').notNull().unique(),
  /** bts.uz's own region id, used by the one-off import. */
  btsId: integer('bts_id').notNull().unique(),
  nameRu: text('name_ru').notNull(),
  nameUz: text('name_uz').notNull(),
  deliveryTariff: integer('delivery_tariff').notNull(),
  /** Order in the picker. */
  position: integer('position').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A BTS pickup point. `code` is bts.uz's office number (the import's idempotency key; staff-added
 * points use their own). `active = false` hides it from customers. `search_text` is the folded
 * lower-case text the search matches, kept in sync by the service. Text is as BTS publishes it.
 */
export const btsPoints = pgTable(
  'bts_points',
  {
    id: id(),
    code: text('code').notNull().unique(),
    regionId: bigint('region_id', { mode: 'number' })
      .notNull()
      .references(() => regions.id),
    city: text('city').notNull(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    landmark: text('landmark'),
    hours: text('hours'),
    active: boolean('active').notNull().default(true),
    searchText: text('search_text').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bts_points_region_city_idx').on(t.regionId, t.city)],
);

/**
 * Staff (ADR 0017, 0038): gates the admin panel and the orders-group buttons; audit entries point
 * here. A member signs in with a login and password, or with the Telegram account bound to the
 * record (the group buttons know them only by that). Every record keeps at least one way in.
 */
export const staff = pgTable(
  'staff',
  {
    id: id(),
    /** Bound through the bot's one-time link (ADR 0038); null until the member links it. */
    telegramId: bigint('telegram_id', { mode: 'number' }).unique(),
    /** Stored lower-case, so unique case-insensitively; null for a Telegram-only record. */
    login: text('login').unique(),
    /** argon2id as a PHC string; never logged or returned. Null until a password is set. */
    passwordHash: text('password_hash'),
    /** A temporary password (set by the owner or the CLI): nothing else works until it is changed. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    name: text('name').notNull(),
    role: staffRoleEnum('role').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('staff_login_format', sql`${t.login} ~ '^[a-z0-9._-]{3,32}$'`),
    check('staff_password_needs_login', sql`${t.passwordHash} is null or ${t.login} is not null`),
    check('staff_has_way_in', sql`${t.telegramId} is not null or ${t.login} is not null`),
  ],
);

/**
 * Failed password sign-ins (ADR 0038), one row per login and one per client address: the count
 * in the current window, and the lock it led to. The numbers are settings (`auth.password*`).
 */
export const loginThrottleScopeEnum = pgEnum('login_throttle_scope', ['login', 'ip']);
export const loginThrottles = pgTable(
  'login_throttles',
  {
    scope: loginThrottleScopeEnum('scope').notNull(),
    key: text('key').notNull(),
    failures: integer('failures').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/**
 * «Привязать Telegram» (ADR 0038): a one-time token behind `t.me/<bot>?start=staff_<token>`; only
 * its SHA-256 is stored. Opening it in Telegram binds that account to the staff record once.
 */
export const staffTelegramLinks = pgTable(
  'staff_telegram_links',
  {
    id: id(),
    staffId: bigint('staff_id', { mode: 'number' })
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('staff_telegram_links_staff_idx').on(t.staffId)],
);

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
 * What an outbox row does when delivered: send its message, or bring an order's card in the
 * orders group up to date (`ref` = the order id; rendered from the order at delivery, #37), or post
 * a review (#41), or bring a manual-review post up to date (`ref` = the receipt id, #51).
 */
export const OUTBOX_KINDS = ['message', 'order_card', 'review_post', 'manual_review_post'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export const outboxKindEnum = pgEnum('outbox_kind', OUTBOX_KINDS);

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
    kind: outboxKindEnum('kind').notNull().default('message'),
    /** What a task is about (the order id of an `order_card` row); null for a message. */
    ref: bigint('ref', { mode: 'number' }),
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
    // a message has its text and no ref; a task (text '') always says what it is about
    check('outbox_task_ref', sql`(${t.kind} = 'message') = (${t.ref} is null)`),
  ],
);

/**
 * Every Humo bot message the userbot posted (ADR 0014), keyed by its Telegram message id so a repeat
 * post changes nothing; the highest id is where the userbot's catch-up resumes. Debits (➖) are never
 * stored. `parse_error` is null when the message became a credit; otherwise it names the field that
 * did not fit the template ('not_an_operation', 'amount', 'time', 'card') and the owner was alerted,
 * or says the message was the Humo bot's own talk (#51): 'service' (no alert) or 'card_notice' (the
 * card blocked or a limit; the owner was alerted). The raw text stays here either way.
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
    /**
     * The "credit recorded" event (ADR 0021 pattern): the row itself is the event. Queued: handed
     * to BullMQ (a marker, retaken after the requeue window). Handled: every subscriber ran.
     */
    eventQueuedAt: timestamp('event_queued_at', { withTimezone: true }),
    eventHandledAt: timestamp('event_handled_at', { withTimezone: true }),
    /**
     * Not for an order (GLOSSARY, #49): staff marked this unlinked credit as money that is not
     * shop money (a personal transfer to the shop card). It is then never a Candidate credit and
     * leaves «Поступления без заказа»; linking it needs the mark taken off first. Set and cleared
     * under the credit's row lock (`CreditMarks`), so it never sits on a linked credit. Who set it
     * has no FK, like `refunds.staff_id`: a removed staff member's marks stay.
     */
    notForOrderAt: timestamp('not_for_order_at', { withTimezone: true }),
    notForOrderBy: bigint('not_for_order_by', { mode: 'number' }),
    /** The staff member's optional note, at most `payments.creditMarkNoteMaxLength` characters. */
    notForOrderNote: text('not_for_order_note'),
  },
  (t) => [
    index('credits_event_pending_idx')
      .on(t.id)
      .where(sql`event_handled_at is null`),
    check('credits_amount_positive', sql`${t.amountTiyin} > 0`),
    check('credits_card_last4', sql`${t.cardLast4} ~ '^[0-9]{4}$'`),
    // a mark has its time and its author; a note only with a mark
    check(
      'credits_not_for_order',
      sql`(${t.notForOrderAt} is null) = (${t.notForOrderBy} is null) and (${t.notForOrderNote} is null or ${t.notForOrderAt} is not null)`,
    ),
  ],
);

/** The userbot's last heartbeat, one row; feeds the Humo-silence guard (ADR 0012). */
export const userbotHeartbeat = pgTable(
  'userbot_heartbeat',
  {
    /** Always true: the primary key that keeps this table to one row. */
    id: boolean('id').primaryKey().default(true),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('userbot_heartbeat_one_row', sql`${t.id}`)],
);

/**
 * What paused the payment feed (ADR 0012, #36): the userbot's heartbeat went stale (or never
 * came), or no Humo credit arrived for too long while receipts waited.
 */
export const paymentPauseCauseEnum = pgEnum('payment_pause_cause', ['heartbeat', 'silence']);

/**
 * One payment pause (ADR 0012, #36, GLOSSARY). While a pause is open, no receipt gets «оплата не
 * найдена»; afterwards each receipt's wait window and its order's reserve are extended by the part
 * of every pause after the receipt was sent. A heartbeat pause starts at the userbot's last
 * heartbeat. `announced_at` marks the owner's alert, sent once the pause has lasted a few minutes;
 * only an announced pause has its end announced. At most one is open.
 */
export const paymentPauses = pgTable(
  'payment_pauses',
  {
    id: id(),
    cause: paymentPauseCauseEnum('cause').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Null while the pause lasts. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** When the owner was told of it; null for a pause too short to announce. */
    announcedAt: timestamp('announced_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payment_pauses_one_open_idx')
      .on(sql`(${t.endedAt} is null)`)
      .where(sql`${t.endedAt} is null`),
    check('payment_pauses_ends_after_start', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);
export type PaymentPauseRow = typeof paymentPauses.$inferSelect;

/*
 * Catalog (ADR 0018): translatable text is a pair of NOT NULL columns, names of fragrances and
 * their original brands are single fields. Money is integer so'm; stock is "on hand" only, the
 * reserve is derived from order lines (ADR 0010).
 */
export const fragranceTypeEnum = pgEnum('fragrance_type', ['homme', 'femme', 'unisex']);
export const sillageEnum = pgEnum('sillage', ['medium', 'noticeable', 'strong']);
export const seasonEnum = pgEnum('season', [
  'spring_summer',
  'autumn_winter',
  'all_year',
  'spring_autumn',
]);
export const timeOfDayEnum = pgEnum('time_of_day', ['day', 'evening', 'day_evening', 'everyday']);
export const noteLevelEnum = pgEnum('note_level', ['top', 'heart', 'base']);
export const VOLUMES_ML = [10, 30, 50] as const;

/** Fragrance families from the customer's guide (29 composite families), RU/UZ. */
export const families = pgTable('families', {
  id: id(),
  nameRu: text('name_ru').notNull().unique(),
  nameUz: text('name_uz').notNull().unique(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

/** Note dictionary (~145 notes), RU/UZ names; levels live on the link table. */
export const notes = pgTable('notes', {
  id: id(),
  nameRu: text('name_ru').notNull().unique(),
  nameUz: text('name_uz').notNull(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
});

export const fragrances = pgTable(
  'fragrances',
  {
    id: id(),
    /** Deep links use it (`p_<slug>`): the name in ASCII kebab case. */
    slug: text('slug').notNull().unique(),
    /** Internal product code (the guide id). Never shown to customers, never in a customer endpoint. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    originalBrand: text('original_brand').notNull(),
    type: fragranceTypeEnum('type').notNull(),
    familyId: bigint('family_id', { mode: 'number' }).references(() => families.id),
    season: seasonEnum('season').notNull(),
    timeOfDay: timeOfDayEnum('time_of_day').notNull(),
    /** An admin field; every fragrance reads «до 24 часов» (customer, 2026-11-07). */
    longevityRu: text('longevity_ru').notNull(),
    longevityUz: text('longevity_uz').notNull(),
    sillage: sillageEnum('sillage').notNull(),
    descriptionRu: text('description_ru').notNull(),
    descriptionUz: text('description_uz').notNull(),
    whenToWearRu: text('when_to_wear_ru').notNull(),
    whenToWearUz: text('when_to_wear_uz').notNull(),
    /** Exactly three, shown under the name and on list cards; not always the top notes. */
    keyNotesRu: text('key_notes_ru').array().notNull(),
    keyNotesUz: text('key_notes_uz').array().notNull(),
    /** Admin-only. Never leaves through a customer endpoint. */
    internalRemark: text('internal_remark'),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    uzumUrl: text('uzum_url'),
    isHit: boolean('is_hit').notNull().default(false),
    isNew: boolean('is_new').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'fragrances_three_key_notes',
      sql`cardinality(${t.keyNotesRu}) = 3 and cardinality(${t.keyNotesUz}) = 3`,
    ),
  ],
);

export const fragranceNotes = pgTable(
  'fragrance_notes',
  {
    fragranceId: bigint('fragrance_id', { mode: 'number' })
      .notNull()
      .references(() => fragrances.id, { onDelete: 'cascade' }),
    noteId: bigint('note_id', { mode: 'number' })
      .notNull()
      .references(() => notes.id),
    level: noteLevelEnum('level').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [uniqueIndex('fragrance_notes_pk').on(t.fragranceId, t.level, t.position)],
);

/** Curated similar fragrances, ordered; they come first in «Похожие ароматы». */
export const fragranceSimilar = pgTable(
  'fragrance_similar',
  {
    fragranceId: bigint('fragrance_id', { mode: 'number' })
      .notNull()
      .references(() => fragrances.id, { onDelete: 'cascade' }),
    similarId: bigint('similar_id', { mode: 'number' })
      .notNull()
      .references(() => fragrances.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
  },
  (t) => [uniqueIndex('fragrance_similar_pk').on(t.fragranceId, t.position)],
);

/** One sellable volume of a fragrance. */
export const volumes = pgTable(
  'volumes',
  {
    id: id(),
    fragranceId: bigint('fragrance_id', { mode: 'number' })
      .notNull()
      .references(() => fragrances.id, { onDelete: 'cascade' }),
    ml: smallint('ml').notNull(),
    /** Regular price, integer so'm. */
    price: integer('price').notNull(),
    /** A markdown is a price, not a discount (ADR 0008). Active while below `price` and not past its end. */
    salePrice: integer('sale_price'),
    saleEndsAt: timestamp('sale_ends_at', { withTimezone: true }),
    /** Physically in the warehouse; available = on hand - reserve (ADR 0010). */
    onHand: integer('on_hand').notNull().default(0),
    /** Content hash of the rendered photo set (`public/<hash>-<w>.webp`); null until uploaded. */
    photoHash: text('photo_hash'),
    /** Seed values that are ours, not the customer's; none may reach launch. */
    isPlaceholder: boolean('is_placeholder').notNull().default(false),
  },
  (t) => [
    uniqueIndex('volumes_fragrance_ml_idx').on(t.fragranceId, t.ml),
    check('volumes_ml_check', sql`${t.ml} in (10, 30, 50)`),
    check(
      'volumes_money_check',
      sql`${t.price} >= 0 and (${t.salePrice} is null or ${t.salePrice} >= 0) and ${t.onHand} >= 0`,
    ),
  ],
);

/**
 * The search document of one fragrance (ADR 0019), every field a Latin skeleton
 * (`apps/api/src/search/normalize.ts`). Written only by `reindexFragrances`
 * (`apps/api/src/search/search-index.ts`), called in the transaction of whatever changes the
 * catalog; `updatedAt` is when this document was built. There are no trigram indexes on purpose:
 * the ranking asks `word_similarity()` of every row, which a GIN index cannot serve, and the
 * catalog is a few dozen rows. If it ever grows to thousands, switch the match to the `<%`
 * operator and add GIN `gin_trgm_ops` indexes then.
 */
export const fragranceSearch = pgTable('fragrance_search', {
  fragranceId: bigint('fragrance_id', { mode: 'number' })
    .primaryKey()
    .references(() => fragrances.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** One skeleton per alias, so an exact alias match is a plain equality. */
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  brand: text('brand').notNull(),
  /** Notes of every level, RU and UZ. */
  notes: text('notes').notNull(),
  /** The family, RU and UZ. */
  family: text('family').notNull(),
  /** The three key notes on the card, RU and UZ: a match here outranks a deeper level. */
  keyNotes: text('key_notes').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FragranceRow = typeof fragrances.$inferSelect;
export type VolumeRow = typeof volumes.$inferSelect;

export type OutboxRow = typeof outbox.$inferSelect;
export type BroadcastRow = typeof broadcasts.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type RegionRow = typeof regions.$inferSelect;
export type BtsPointRow = typeof btsPoints.$inferSelect;
export type StaffRow = typeof staff.$inferSelect;
export type StaffRole = (typeof staffRoleEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];

/**
 * A Customer's cart (spec 2026-11-07): one row per customer, created with the first line. It holds
 * the discount the customer switched to and the link-prefilled promo code for the discount tickets
 * (ADR 0002); the lines are in `cart_lines`. The cart never expires.
 */
/**
 * The discount the customer switched to (ADR 0002), or `none` («Не применять», #39); the pricing
 * module's `DiscountChoice` has this same shape.
 */
export type StoredDiscountChoice =
  | { type: 'upgrade_right' | 'birthday_coupon'; id: number }
  | { type: 'promo_code' }
  | { type: 'none' };

export const carts = pgTable('carts', {
  customerId: bigint('customer_id', { mode: 'number' })
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  /** `{ type: 'upgrade_right' | 'birthday_coupon', id } | { type: 'promo_code' } | { type: 'none' }`; cleared when a code is typed (#39: see `CartService.chooseDiscount`). */
  discountChoice: jsonb('discount_choice').$type<StoredDiscountChoice>(),
  /** An entered or link-prefilled promo code, upper-case; judged by the quote, never blocks the order. */
  promoCode: text('promo_code'),
  /** Codes typed in the current window (settings `promo.attemptLimit` per `promo.attemptWindowSeconds`): codes are guessable. */
  promoAttempts: integer('promo_attempts').notNull().default(0),
  /** When the current attempt window opened; null before the first typed code. */
  promoAttemptsSince: timestamp('promo_attempts_since', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A customer's favourite (#45): one fragrance, or the Discovery set (`fragrance_id` null). Kept
 * once per customer and target; the list reads newest first. A hidden fragrance stays saved and
 * comes back when the owner shows it again; the list just leaves it out meanwhile.
 */
export const favourites = pgTable(
  'favourites',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['fragrance', 'discovery_set'] })
      .notNull()
      .default('fragrance'),
    fragranceId: bigint('fragrance_id', { mode: 'number' }).references(() => fragrances.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('favourites_customer_fragrance_idx').on(t.customerId, t.fragranceId),
    uniqueIndex('favourites_customer_set_idx')
      .on(t.customerId)
      .where(sql`kind = 'discovery_set'`),
    check(
      'favourites_target_check',
      sql`(${t.kind} = 'fragrance') = (${t.fragranceId} is not null)`,
    ),
  ],
);

/**
 * The Discovery set (ADR 0009): one row, true to its own `id` like the heartbeat. It is a product
 * with its own price, photo and stock; `on_hand` never touches 10 ml stock. A builder set has no
 * row of its own and costs `price` too (spec Changes 2026-11-10, sets). The composition is the
 * five ordered fragrances in `discovery_set_items`.
 */
export const discoverySet = pgTable(
  'discovery_set',
  {
    id: boolean('id').primaryKey().default(true),
    /** Integer so'm. */
    price: integer('price').notNull(),
    /** Boxes assembled and in the warehouse; available = on hand - reserve (ADR 0010). */
    onHand: integer('on_hand').notNull().default(0),
    /** Content hash of the rendered photo set; null falls back to the box photo shipped with the app. */
    photoHash: text('photo_hash'),
    /** The set's page on Uzum Market (https); null hides the «Купить на Uzum» button. */
    uzumUrl: text('uzum_url'),
    /** Seed price that is ours, not the customer's; none may reach launch. */
    isPlaceholder: boolean('is_placeholder').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('discovery_set_one_row', sql`${t.id}`),
    check('discovery_set_money_check', sql`${t.price} >= 0 and ${t.onHand} >= 0`),
  ],
);

/** The Discovery set's fragrances in the order the owner picked; exactly five when it is for sale. */
export const discoverySetItems = pgTable(
  'discovery_set_items',
  {
    position: smallint('position').primaryKey(),
    fragranceId: bigint('fragrance_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => fragrances.id),
  },
  (t) => [check('discovery_set_items_position', sql`${t.position} between 1 and 5`)],
);

export const cartLineKindEnum = pgEnum('cart_line_kind', LINE_KINDS);

/**
 * One cart line: a volume x quantity, the Discovery set x quantity, or a builder set x quantity.
 * Quantity is what the customer asked for; the server caps it at available on read. A builder
 * line keeps the five chosen fragrance ids (sorted, so the same five add up on one line); their
 * 10 ml volumes are resolved on read.
 */
export const cartLines = pgTable(
  'cart_lines',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    kind: cartLineKindEnum('kind').notNull().default('volume'),
    volumeId: bigint('volume_id', { mode: 'number' }).references(() => volumes.id, {
      onDelete: 'cascade',
    }),
    fragranceIds: bigint('fragrance_ids', { mode: 'number' }).array(),
    qty: integer('qty').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cart_lines_customer_volume_idx').on(t.customerId, t.volumeId),
    uniqueIndex('cart_lines_customer_discovery_idx')
      .on(t.customerId)
      .where(sql`kind = 'discovery_set'`),
    uniqueIndex('cart_lines_customer_builder_idx')
      .on(t.customerId, t.fragranceIds)
      .where(sql`kind = 'builder_set'`),
    index('cart_lines_volume_idx').on(t.volumeId),
    check('cart_lines_qty_check', sql`${t.qty} > 0`),
    // exactly five fragrance ids and none NULL (distinctness is judged by the builder's rules)
    check(
      'cart_lines_fragrance_ids_check',
      sql`${t.fragranceIds} is null or (cardinality(${t.fragranceIds}) = 5 and array_position(${t.fragranceIds}, null) is null)`,
    ),
    check(
      'cart_lines_kind_check',
      sql`(kind = 'volume' and volume_id is not null and fragrance_ids is null)
        or (kind = 'discovery_set' and volume_id is null and fragrance_ids is null)
        or (kind = 'builder_set' and volume_id is null and cardinality(fragrance_ids) = 5)`,
    ),
  ],
);

export type CartRow = typeof carts.$inferSelect;
export type CartLineRow = typeof cartLines.$inferSelect;
export type DiscoverySetRow = typeof discoverySet.$inferSelect;

/**
 * A broadcast (owner only, spec Changes 2026-11-07): the durable record of what was sent, to whom
 * and by whom. Both texts are required; each customer gets the one in their language. `image_key`
 * is a FileStore key; `button_target` a `startapp` parameter. Counts come from the deliveries.
 */
export const broadcasts = pgTable('broadcasts', {
  id: id(),
  audience: broadcastAudienceEnum('audience').notNull(),
  textRu: text('text_ru').notNull(),
  textUz: text('text_uz').notNull(),
  imageKey: text('image_key'),
  buttonTarget: text('button_target'),
  /** Telegram's file_id of the image after its first upload; later sends go by id. */
  photoFileId: text('photo_file_id'),
  createdBy: bigint('created_by', { mode: 'number' }).references(() => staff.id, {
    onDelete: 'set null',
  }),
  /** The sender's name as it was, so the history survives a removed staff row. */
  createdByName: text('created_by_name').notNull(),
  createdAt: createdAt(),
});

/**
 * One row per broadcast x customer: the primary key is the idempotency of a send (a retried job
 * finds its row no longer pending and sends nothing). Customers the bot may not write to are
 * inserted as `blocked` at once; the rest are `pending` until their job runs. `queued_at` and
 * `sending_at` work like the outbox's (ADR 0021): the queue stamp, and the claim taken before the Telegram call.
 */
export const broadcastDeliveries = pgTable(
  'broadcast_deliveries',
  {
    broadcastId: bigint('broadcast_id', { mode: 'number' })
      .notNull()
      .references(() => broadcasts.id, { onDelete: 'cascade' }),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    status: broadcastDeliveryStatusEnum('status').notNull().default('pending'),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    sendingAt: timestamp('sending_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.broadcastId, t.customerId] }),
    index('broadcast_deliveries_pending_idx')
      .on(t.broadcastId)
      .where(sql`status = 'pending'`),
  ],
);

/*
 * Orders (ADR 0001, 0010, 0011, 0012). An order is an immutable snapshot of what was bought, at
 * which prices, delivered where: later price, catalog or BTS point edits never change it. Its
 * status is the one linear status of ADR 0011; the status machine (#24) moves it after checkout.
 */
/** The one status list lives in the contracts (`ORDER_STATUSES`); the enum is built from it. */
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
/**
 * The statuses whose lines hold a Reserve (ADR 0010): not yet handed to BTS (on hand drops then)
 * and not cancelled. Delivered and returned orders hold none either.
 */
export const RESERVING_STATUSES = [
  'awaiting_payment',
  'receipt_review',
  'payment_confirmed',
  'accepted',
  'assembling',
] as const satisfies readonly OrderStatus[];
export const thresholdBaseEnum = pgEnum('threshold_base', ['before', 'after']);
/** A single volume, a builder set (five 10 ml volumes) or the Discovery set (its own stock), ADR 0009. */
export const orderLineKindEnum = pgEnum('order_line_kind', LINE_KINDS);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    /** The customer-facing number (ADR 0016): its own sequence, starting at 1001. */
    number: integer('number').notNull().unique().generatedAlwaysAsIdentity({ startWith: 1001 }),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    status: orderStatusEnum('status').notNull().default('awaiting_payment'),
    /** Without a receipt the reserve ends here (setting `orders.reserveTtlSeconds`, ADR 0012). */
    reserveUntil: timestamp('reserve_until', { withTimezone: true }).notNull(),
    /** The Recipient: who collects at the BTS point; the phone is E.164 and grants nothing (ADR 0004). */
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    /** The delivery region decides the fee; from the point, or chosen with a typed address. */
    regionId: bigint('region_id', { mode: 'number' })
      .notNull()
      .references(() => regions.id),
    regionNameRu: text('region_name_ru').notNull(),
    regionNameUz: text('region_name_uz').notNull(),
    /** The chosen BTS point and its text as it was then; all null when the address was typed. */
    btsPointId: bigint('bts_point_id', { mode: 'number' }).references(() => btsPoints.id),
    pointCode: text('point_code'),
    pointName: text('point_name'),
    pointCity: text('point_city'),
    pointAddress: text('point_address'),
    pointLandmark: text('point_landmark'),
    pointHours: text('point_hours'),
    /** «Не нашёл свой пункт»: the customer's own text; a manager picks the point (spec 2026-11-07). */
    typedAddress: text('typed_address'),
    comment: text('comment'),
    /** «Это подарок»: gift packaging, a greeting card, no receipt in the parcel; free of charge. */
    isGift: boolean('is_gift').notNull().default(false),
    giftMessage: text('gift_message'),
    itemsSubtotal: integer('items_subtotal').notNull(),
    /** The quote's one Discount (type, source, amount); its line key is the order line position. */
    discount: jsonb('discount').$type<Discount>(),
    discountAmount: integer('discount_amount').notNull().default(0),
    deliveryFee: integer('delivery_fee').notNull(),
    thresholdBase: thresholdBaseEnum('threshold_base').notNull(),
    thresholdBaseAmount: integer('threshold_base_amount').notNull(),
    total: integer('total').notNull(),
    /** What the customer transfers to the shop card; payment matching compares this (ADR 0012). */
    amountDue: integer('amount_due').notNull(),
    /**
     * The Credit that paid it, linked when the payment is confirmed (`PaymentConfirmation`, the
     * one door for the receipt AI and staff). Unique: a credit never pays two orders (ADR 0012).
     */
    creditId: bigint('credit_id', { mode: 'number' }).references(() => credits.id),
    /** The Mini App's key for one checkout attempt: a repeated request returns this order. */
    idempotencyKey: uuid('idempotency_key').notNull(),
    /** The last campaign link the customer opened within `campaigns.attributionWindowDays` before ordering (ADR 0022). */
    campaignLinkId: bigint('campaign_link_id', { mode: 'number' }).references(
      () => campaignLinks.id,
    ),
    /** BTS's tracking number, required by «Передан в BTS» (ADR 0011). */
    trackingNumber: text('tracking_number'),
    /** The reserve reminder's marker (ADR 0021): stamped with the message, so it goes once. */
    reserveReminderSentAt: timestamp('reserve_reminder_sent_at', { withTimezone: true }),
    /**
     * The review request's marker (ADR 0021, #41): stamped with the message, so it goes once.
     * `review_request` says what came of it: `sent`, or `not_delivered` when the customer had
     * blocked the bot (nothing is sent then, and never later).
     */
    reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
    reviewRequest: text('review_request', { enum: ['sent', 'not_delivered'] }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    uniqueIndex('orders_customer_idempotency_idx').on(t.customerId, t.idempotencyKey),
    index('orders_status_idx').on(t.status),
    uniqueIndex('orders_credit_idx').on(t.creditId),
    // the reserve sweeps read unpaid orders by when their reserve ends
    index('orders_awaiting_reserve_idx')
      .on(t.reserveUntil)
      .where(sql`${t.status} = 'awaiting_payment'`),
    // A chosen point is all there (code, name, city, address), or the address was typed instead.
    check(
      'orders_point_or_typed',
      sql`(${t.typedAddress} is null and ${t.pointCode} is not null and ${t.pointName} is not null and ${t.pointCity} is not null and ${t.pointAddress} is not null) or (${t.typedAddress} is not null and ${t.btsPointId} is null and ${t.pointCode} is null and ${t.pointName} is null and ${t.pointCity} is null and ${t.pointAddress} is null and ${t.pointLandmark} is null and ${t.pointHours} is null)`,
    ),
    check('orders_gift_message', sql`${t.isGift} or ${t.giftMessage} is null`),
    check(
      'orders_money',
      sql`${t.itemsSubtotal} >= 0 and ${t.discountAmount} >= 0 and ${t.deliveryFee} >= 0 and ${t.thresholdBaseAmount} >= 0 and ${t.total} >= 0 and ${t.amountDue} >= 0 and ${t.amountDue} <= ${t.total}`,
    ),
    // «Итого» = items − the one discount + delivery (ADR 0001), whatever wrote the row.
    check(
      'orders_total_adds_up',
      sql`${t.total} = ${t.itemsSubtotal} - ${t.discountAmount} + ${t.deliveryFee}`,
    ),
    // the review sweep reads delivered orders not yet asked
    index('orders_review_due_idx')
      .on(t.id)
      .where(sql`${t.status} = 'delivered' and ${t.reviewRequestedAt} is null`),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** 0-based place in the order; the discount's line key. */
    position: smallint('position').notNull(),
    kind: orderLineKindEnum('kind').notNull().default('volume'),
    volumeId: bigint('volume_id', { mode: 'number' }).references(() => volumes.id),
    fragranceId: bigint('fragrance_id', { mode: 'number' }).references(() => fragrances.id),
    slug: text('slug'),
    nameRu: text('name_ru').notNull(),
    nameUz: text('name_uz').notNull(),
    brand: text('brand'),
    ml: smallint('ml').notNull(),
    photo: text('photo'),
    unitPrice: integer('unit_price').notNull(),
    regularUnitPrice: integer('regular_unit_price').notNull(),
    markedDown: boolean('marked_down').notNull().default(false),
    qty: integer('qty').notNull(),
    lineTotal: integer('line_total').notNull(),
    /** A gift code's free item (ADR 0039): unit price 0, `regular_unit_price` its value, quantity 1. */
    promoGift: boolean('promo_gift').notNull().default(false),
    /** A set's five 10 ml volumes. A builder set's reserve takes one of each per set unit; the Discovery set only records them (its own stock is the reserve). */
    setVolumeIds: bigint('set_volume_ids', { mode: 'number' }).array(),
    /** A set's five fragrances as bought: `[{ fragranceId, name, brand }]` (ADR 0009). */
    setComposition:
      jsonb('set_composition').$type<{ fragranceId: number; name: string; brand: string }[]>(),
  },
  (t) => [
    uniqueIndex('order_lines_order_position_idx').on(t.orderId, t.position),
    index('order_lines_volume_idx').on(t.volumeId),
    check('order_lines_qty_check', sql`${t.qty} > 0`),
    check(
      'order_lines_kind_check',
      sql`(${t.kind}::text = 'volume' and ${t.volumeId} is not null and ${t.setVolumeIds} is null) or (${t.kind}::text = 'builder_set' and ${t.volumeId} is null and cardinality(${t.setVolumeIds}) = 5 and jsonb_array_length(${t.setComposition}) = 5) or (${t.kind}::text = 'discovery_set' and ${t.volumeId} is null and ${t.setVolumeIds} is null and jsonb_array_length(${t.setComposition}) = 5)`,
    ),
    check(
      'order_lines_money_check',
      sql`${t.unitPrice} >= 0 and ${t.regularUnitPrice} >= 0 and ${t.lineTotal} >= 0`,
    ),
    check(
      'order_lines_promo_gift_check',
      sql`not ${t.promoGift} or (${t.unitPrice} = 0 and ${t.lineTotal} = 0 and ${t.qty} = 1)`,
    ),
  ],
);

/** Every way an order changes status (the transition table lives in the contracts). */
export const orderActionEnum = pgEnum('order_action', ORDER_ACTIONS);

/**
 * The order's history (ADR 0011): one row per status change, written by `transition()` in the
 * same transaction as the change, its audit entry and its customer message. `reason` is the
 * cancel reason code, a rejected receipt's preset code (`RECEIPT_REJECT_REASONS`), a staff link's
 * typed reason, or the text staff typed for a return; `payload` keeps the rest (a receipt id, a
 * staff note, a tracking number, per-line back-to-stock flags, the on-hand changes).
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum('from_status').notNull(),
    toStatus: orderStatusEnum('to_status').notNull(),
    action: orderActionEnum('action').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    /** Customer or staff id; null for ai/system. */
    actorId: bigint('actor_id', { mode: 'number' }),
    reason: text('reason'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_events_order_idx').on(t.orderId, t.id),
    // the admin Home's money in today reads payment confirmations by time (#48)
    index('order_events_confirmed_idx')
      .on(t.createdAt)
      .where(sql`${t.action} = 'confirm_payment'`),
  ],
);

export const upgradeRightSourceEnum = pgEnum('upgrade_right_source', UPGRADE_RIGHT_SOURCES);

/**
 * An Upgrade right (ADR 0003, ticket #38): opened when its source order reaches «Доставлен», one
 * per set unit (covering the set's five fragrances as bought, ADR 0009) or, while that source is
 * switched on, one per fragrance bought as a single 10 ml bottle. It discounts one Full size
 * bottle of a covered fragrance once. Percent and the end are fixed when it opens. Its state is
 * derived (ADR 0005): active while no order holds it (`used_by_order_id`), it is not closed and
 * `expires_at` (00:00 Tashkent the day after its last day, exclusive) has not come. An order holds
 * it with a conditional update; a cancel or return of that order clears the link while within
 * validity. A returned source order closes it (`closed_at`); one already spent stays with the
 * order that used it. The reminder markers are stamped once each, sent or not (a blocked bot).
 */
export const upgradeRights = pgTable(
  'upgrade_rights',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    source: upgradeRightSourceEnum('source').notNull(),
    sourceOrderId: bigint('source_order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id),
    /** The source order line, and which unit of it (a set line of qty 2 opens units 0 and 1). */
    sourcePosition: smallint('source_position').notNull(),
    sourceUnit: smallint('source_unit').notNull(),
    /** The covered fragrances as bought: a set's five, or the one 10 ml bottle's. */
    fragrances: jsonb('fragrances')
      .$type<{ fragranceId: number; name: string; brand: string }[]>()
      .notNull(),
    percent: smallint('percent').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedByOrderId: bigint('used_by_order_id', { mode: 'number' }).references(() => orders.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    firstReminderAt: timestamp('first_reminder_at', { withTimezone: true }),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('upgrade_rights_source_idx').on(t.sourceOrderId, t.sourcePosition, t.sourceUnit),
    uniqueIndex('upgrade_rights_used_by_order_idx')
      .on(t.usedByOrderId)
      .where(sql`${t.usedByOrderId} is not null`),
    index('upgrade_rights_customer_idx').on(t.customerId, t.expiresAt),
    check(
      'upgrade_rights_terms_check',
      sql`${t.percent} between 1 and 100 and ${t.expiresAt} > ${t.openedAt} and jsonb_array_length(${t.fragrances}) between 1 and 5 and ${t.sourceUnit} >= 0`,
    ),
  ],
);

export type UpgradeRightRow = typeof upgradeRights.$inferSelect;

/**
 * A Refund (ADR 0006, #40): money sent back to the shopper's card for a paid order, as staff
 * record it: whole so'm, the Tashkent day it was sent, the reason and who recorded it (no FK, like
 * `order_events.actor_id`: a removed staff member's refunds stay). It may be partial; an order's
 * refunds together never exceed what paid it (its Credit, whole so'm), checked under the order's
 * row lock. It never changes the order's status or a discount source; reports subtract it (#42).
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id),
    amount: integer('amount').notNull(),
    /** The Tashkent day the money was sent, `YYYY-MM-DD`. */
    refundedOn: date('refunded_on', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    staffId: bigint('staff_id', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('refunds_order_idx').on(t.orderId, t.id),
    // the sales report reads refunds by day (#42)
    index('refunds_day_idx').on(t.refundedOn),
    check('refunds_amount_check', sql`${t.amount} > 0`),
  ],
);

export type RefundRow = typeof refunds.$inferSelect;

/**
 * The shop card shoppers transfer to (spec §4, #28): one row, owner-only, every change audited
 * with the number masked. No row means no card: checkout is closed («Оплата временно недоступна»).
 * Its own record, not a setting: it is the shop's payment detail, not a rule value, and the
 * settings audit keeps raw values.
 */
export const shopCard = pgTable(
  'shop_card',
  {
    /** Always true: the primary key that keeps this table to one row. */
    id: boolean('id').primaryKey().default(true),
    /** 16 digits, no spaces. */
    number: text('number').notNull(),
    /** The holder as the bank shows it (a person, an IP or an LLC). */
    holder: text('holder').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('shop_card_one_row', sql`${t.id}`),
    check('shop_card_number', sql`${t.number} ~ '^[0-9]{16}$'`),
  ],
);

/**
 * A Receipt's verdict (ADR 0011, 0012): it waits (`pending`) until the AI or a manager confirms
 * it, a manager sends it to manual review or rejects it with a reason, or the wait window ends
 * with `payment_not_found`. The order's status is separate.
 */
export const receiptVerdictEnum = pgEnum('receipt_verdict', RECEIPT_VERDICTS);
/**
 * Why a receipt went to manual review (#32): the same file as another receipt (`duplicate`, #36
 * adds the perceptual hash), the AI's answer did not confirm it (`not_confirmed`), or the AI could
 * not be asked, attempt after attempt (`judge_failed`).
 */
export const receiptReviewReasonEnum = pgEnum('receipt_review_reason', RECEIPT_REVIEW_REASONS);
/** Where the shopper sent it from: the payment screen, or the chat with the bot (#31). */
export const receiptSourceEnum = pgEnum('receipt_source', ['miniapp', 'bot']);
/** The original's kind, by its first bytes (ADR 0020). */
export const receiptFileKindEnum = pgEnum('receipt_file_kind', RECEIPT_FILE_KINDS);

/**
 * A Receipt (GLOSSARY): one upload for an order; an order may hold several (ADR 0011). The files
 * live in the private FileStore (`/media/private`, ADR 0020) under random UUID names, served only
 * through the API: the original as evidence, and a PNG/JPEG normalised for the AI (first PDF page
 * rasterised, WebP converted, each side 280-1568 px). `sha256` is the original's, `phash` the
 * normalised image's 64-bit difference hash (16 hex digits), both for duplicate checks (#36).
 */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id),
    source: receiptSourceEnum('source').notNull(),
    verdict: receiptVerdictEnum('verdict').notNull().default('pending'),
    /** Why it last went to manual review; null until it did. */
    reviewReason: receiptReviewReasonEnum('review_reason'),
    /** The name the shopper's device gave the file, if any. */
    fileName: text('file_name'),
    kind: receiptFileKindEnum('kind').notNull(),
    size: integer('size').notNull(),
    originalKey: text('original_key').notNull().unique(),
    normalizedKey: text('normalized_key').notNull().unique(),
    normalizedMime: text('normalized_mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sha256: text('sha256').notNull(),
    phash: text('phash').notNull(),
    /**
     * The «Повторный чек» marker (#36): the receipt this repeat receipt repeats (the same file, or
     * a look-alike image, accepted or sent earlier for another order), set when it took the
     * payment-not-found path at once.
     */
    duplicateOf: bigint('duplicate_of', { mode: 'number' }).references(
      (): AnyPgColumn => receipts.id,
    ),
    /**
     * When the owner was alerted that this receipt waited longer than the setting
     * `payments.uncheckedReceiptAlertSeconds` (#36); the marker that keeps it to one alert.
     */
    uncheckedAlertAt: timestamp('unchecked_alert_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('receipts_order_idx').on(t.orderId, t.id),
    index('receipts_sha256_idx').on(t.sha256),
    index('receipts_phash_idx').on(t.phash),
    // the admin Home's «Чеки на проверке» reads the receipts held for a person, oldest first (#48)
    index('receipts_held_idx')
      .on(t.createdAt)
      .where(sql`${t.verdict} = 'manual_review'`),
    // an order may hold several receipts, but at most one is accepted (ADR 0011)
    uniqueIndex('receipts_one_accepted_idx')
      .on(t.orderId)
      .where(sql`${t.verdict} in ('ai_confirmed', 'manager_confirmed')`),
    check('receipts_size', sql`${t.size} > 0`),
    check('receipts_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('receipts_phash', sql`${t.phash} ~ '^[0-9a-f]{16}$'`),
    check('receipts_normalized_mime', sql`${t.normalizedMime} in ('image/png', 'image/jpeg')`),
    check(
      'receipts_judge_size',
      sql`${t.width} between 280 and 1568 and ${t.height} between 280 and 1568`,
    ),
  ],
);

/** What the receipt AI answered (ADR 0013), kept for the audit trail and threshold tuning only. */
export interface StoredJudgement {
  isReceipt: number;
  amountMatches: number;
  recipientMatches: number;
  chosenCreditId: number | null;
  choiceConfidence: number;
  /** The judge's own verdict; only this ever confirmed anything. */
  confirmed: boolean;
  /** The provider that answered; 'none' when none could (no answer, only a failure). */
  provider: 'typesafe' | 'openai' | 'none';
  reason?: string;
}

/**
 * What became of one look at a receipt: the order was paid with the chosen credit (`confirmed`),
 * a person must decide (`manual_review`), the chosen credit had just paid another order
 * (`credit_taken`, the receipt keeps waiting for its own money), or the receipt was decided
 * while the AI was answering (`stale`).
 */
export const receiptCheckOutcomeEnum = pgEnum('receipt_check_outcome', RECEIPT_CHECK_OUTCOMES);

/**
 * Every answer the receipt AI gave about a Receipt (ADR 0013, #32): the candidate credits it was
 * shown, its answer and what came of it. A receipt is asked again only when a candidate it was
 * never shown appears, so a repeated event, job or retry asks nothing twice. A judge that could
 * not answer leaves no row until its last attempt.
 */
export const receiptChecks = pgTable(
  'receipt_checks',
  {
    id: id(),
    receiptId: bigint('receipt_id', { mode: 'number' })
      .notNull()
      .references(() => receipts.id),
    /** The Candidate credits shown to the judge, oldest first. */
    candidateCreditIds: bigint('candidate_credit_ids', { mode: 'number' }).array().notNull(),
    judgement: jsonb('judgement').$type<StoredJudgement>().notNull(),
    /**
     * Null from the moment the answer is stored (in its own transaction, right after the judge
     * answered) until it is acted on, so a crash in between acts on it again without asking twice.
     */
    outcome: receiptCheckOutcomeEnum('outcome'),
    createdAt: createdAt(),
  },
  (t) => [
    index('receipt_checks_receipt_idx').on(t.receiptId, t.id),
    check('receipt_checks_candidates', sql`cardinality(${t.candidateCreditIds}) > 0`),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type { OrderStatus };
export type OrderLineRow = typeof orderLines.$inferSelect;
export type ShopCardRow = typeof shopCard.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type CreditRow = typeof credits.$inferSelect;
export type ReceiptCheckRow = typeof receiptChecks.$inferSelect;

/**
 * «Мои пункты BTS» (spec Changes 2026-11-07 BTS point selection, 2026-11-11): a Recipient and BTS
 * point pair the customer ordered to, remembered by checkout. One row per recipient phone (E.164)
 * and point; a later order with the same pair renames it and moves it first (`last_used_at`).
 * Removing one is a hard delete: every order keeps its own snapshot, so nothing else points here.
 * The setting `delivery.savedPointsMax` caps how many a customer keeps.
 */
export const savedPoints = pgTable(
  'saved_points',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    btsPointId: bigint('bts_point_id', { mode: 'number' })
      .notNull()
      .references(() => btsPoints.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('saved_points_customer_pair_idx').on(t.customerId, t.recipientPhone, t.btsPointId),
    index('saved_points_customer_used_idx').on(t.customerId, t.lastUsedAt),
  ],
);
export type SavedPointRow = typeof savedPoints.$inferSelect;

/**
 * A receipt the shopper sent to the bot (#31), kept until it is dealt with: the Telegram `file_id`
 * (never the bytes), written in the update's own transaction so a restart cannot lose it (ADR 0021).
 * With `order_number` null it waits for the shopper's choice among several orders (valid for the
 * setting `receipts.botChoiceSeconds` after `created_at`; the worker sweep deletes older ones).
 * With an order it is in flight: a BullMQ job (`bot-receipt-<id>`, re-queued by a sweep if the
 * queue entry was lost) downloads the file and calls the receipt intake, and the row is deleted
 * only when the outcome is final (attached, or refused and answered).
 */
export const botPendingReceipts = pgTable(
  'bot_pending_receipts',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull(),
    /** The document's own name; null for a photo. */
    fileName: text('file_name'),
    /** The order it goes to; null until the shopper chooses. */
    orderNumber: bigint('order_number', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('bot_pending_receipts_created_idx').on(t.createdAt)],
);
export type BotPendingReceiptRow = typeof botPendingReceipts.$inferSelect;

/** The keyboard under an order's card: the next step, the cancel reasons, or one reason to confirm. */
export type OrderCardPanel =
  { kind: 'steps' } | { kind: 'cancel' } | { kind: 'confirm_cancel'; reason: CancelReason };

/**
 * An order's one card in the orders group's «Заказы» topic (#37, spec Changes 2026-11-07),
 * created in the transaction that confirms its payment; the primary key keeps it to one. The row
 * is the card's state, and Telegram catches up with it: every change bumps `version` and queues
 * an `order_card` outbox row, whose delivery renders the card from the order as it is then and
 * posts it (no `message_id` yet) or edits it (only when `shown_hash` differs). `syncing_at` is the
 * lease one delivery holds meanwhile, so two never race on one message; the holder goes round
 * again while `version` moved. The receipt goes once, as a reply to the card.
 */
export const orderCards = pgTable('order_cards', {
  orderId: bigint('order_id', { mode: 'number' })
    .primaryKey()
    .references(() => orders.id, { onDelete: 'cascade' }),
  /** The orders group and its «Заказы» topic when the card was posted (settings `bot.*`). */
  chatId: bigint('chat_id', { mode: 'number' }).notNull(),
  threadId: integer('thread_id'),
  /** Telegram's id of the card message; null until it is posted. */
  messageId: bigint('message_id', { mode: 'number' }),
  /** The receipt the payment was confirmed with; null for a credit that came without one. */
  receiptId: bigint('receipt_id', { mode: 'number' }).references(() => receipts.id),
  /** When the receipt went as a reply to the card (or turned out to be gone from storage). */
  receiptPostedAt: timestamp('receipt_posted_at', { withTimezone: true }),
  panel: jsonb('panel').$type<OrderCardPanel>().notNull().default({ kind: 'steps' }),
  version: integer('version').notNull().default(1),
  /** A hash of the text and keyboard Telegram shows. */
  shownHash: text('shown_hash'),
  syncingAt: timestamp('syncing_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export type OrderCardRow = typeof orderCards.$inferSelect;

/**
 * The keyboard under a manual-review post (#51): «Оплата подтверждена» (one per Candidate credit)
 * and «Чек не принят»; one credit to confirm with; the reject reasons; or one reason to confirm.
 */
export type ManualReviewPanel =
  | { kind: 'choices' }
  | { kind: 'confirm'; creditId: number }
  | { kind: 'reject' }
  | { kind: 'confirm_reject'; reason: ReceiptRejectReason };

/**
 * A receipt held for a person (Manual review, GLOSSARY) and its post in the orders group's
 * «Заказы» topic (#51, TZ §4): the receipt, the order, its Candidate credits and the reason, with
 * «Оплата подтверждена» and «Чек не принят». Opened in the transaction that holds the receipt, so
 * the primary key keeps it to one per hold. Telegram catches up with the row the way it does with
 * the order card (ADR 0034): `version`, `shown_hash` and the `syncing_at` lease, the receipt once
 * as a reply. `decided_at` is stamped by the move that takes the order out of «Чек на проверке»
 * (whoever made it); the post then shows the decision without buttons, and later moves leave it.
 */
export const manualReviewPosts = pgTable(
  'manual_review_posts',
  {
    receiptId: bigint('receipt_id', { mode: 'number' })
      .primaryKey()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** The orders group and its «Заказы» topic when the post was opened (settings `bot.*`). */
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    threadId: integer('thread_id'),
    /** Telegram's id of the post; null until it is posted. */
    messageId: bigint('message_id', { mode: 'number' }),
    /** When the receipt went as a reply to the post (or turned out to be gone from storage). */
    receiptPostedAt: timestamp('receipt_posted_at', { withTimezone: true }),
    panel: jsonb('panel').$type<ManualReviewPanel>().notNull().default({ kind: 'choices' }),
    version: integer('version').notNull().default(1),
    /** A hash of the text and keyboard Telegram shows. */
    shownHash: text('shown_hash'),
    syncingAt: timestamp('syncing_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('manual_review_posts_order_idx').on(t.orderId)],
);
export type ManualReviewPostRow = typeof manualReviewPosts.$inferSelect;

/**
 * «Передан в BTS» pressed on a card (#37): the bot asks the staff member who pressed it for the
 * tracking number by ForceReply. Their reply to that message (found through the outbox row's
 * Telegram message id) makes the handover from `expected_status`; a bad number asks again with
 * a new prompt. At most one is open per order: answered, or replaced by a newer question (a
 * re-ask, another press), it is closed; a reply to a closed one changes nothing.
 */
export const orderCardPrompts = pgTable(
  'order_card_prompts',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    staffId: bigint('staff_id', { mode: 'number' })
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    expectedStatus: orderStatusEnum('expected_status').notNull(),
    /** The question as sent: its row holds the chat and, once sent, the Telegram message id. */
    outboxId: bigint('outbox_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => outbox.id, { onDelete: 'cascade' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('order_card_prompts_order_idx').on(t.orderId)],
);
export type OrderCardPromptRow = typeof orderCardPrompts.$inferSelect;

/**
 * The Home promo banners (ticket #21; a slider since #62). Every active banner is a slide of the
 * Home banner slider, after the Discovery set slide, in `position` order (ties by id); at most
 * `ACTIVE_BANNERS_MAX` are active at once. Switching one on puts it last; the owner moves it
 * up or down. An inactive banner's `position` means nothing until it is switched on again.
 * `image_hash` names a rendition set of the photo pipeline (`public/<hash>-<w>.webp`).
 */
export const promoBanners = pgTable('promo_banners', {
  id: id(),
  imageHash: text('image_hash'),
  titleRu: text('title_ru').notNull(),
  titleUz: text('title_uz').notNull(),
  subtitleRu: text('subtitle_ru').notNull(),
  subtitleUz: text('subtitle_uz').notNull(),
  priceLineRu: text('price_line_ru'),
  priceLineUz: text('price_line_uz'),
  /** A `startapp` value (`catalog`, `p_<slug>`, ...); the Mini App maps it to a route. */
  target: text('target').notNull().default('catalog'),
  active: boolean('active').notNull().default(false),
  /** The slide's place among the active banners (ascending). */
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Editable one-line texts by key (today only `home.slogan`), RU/UZ. */
export const contentTexts = pgTable('content_texts', {
  key: text('key').primaryKey(),
  ru: text('ru').notNull(),
  uz: text('uz').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Info pages (about, delivery and payment, returns, FAQ, contacts, public offer): limited Markdown, RU/UZ. */
export const infoPages = pgTable('info_pages', {
  id: id(),
  slug: text('slug').notNull().unique(),
  sort: smallint('sort').notNull(),
  titleRu: text('title_ru').notNull(),
  titleUz: text('title_uz').notNull(),
  bodyRu: text('body_ru').notNull(),
  bodyUz: text('body_uz').notNull(),
  /** A draft is text pending the customer's approval; customers still read it (marked internally). */
  draft: boolean('draft').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PromoBannerRow = typeof promoBanners.$inferSelect;
export type InfoPageRow = typeof infoPages.$inferSelect;

export const promoKindEnum = pgEnum('promo_kind', ['percent', 'fixed', 'gift']);

/**
 * A Promo code (ticket #29; ADR 0002, 0005, 0007, 0008; spec Changes 2026-11-07 promo counting):
 * a percentage (optionally capped) or a fixed amount off the eligible items, never delivery.
 * The code is stored trimmed and upper-case, so a lookup by the upper-cased entry is
 * case-insensitive and the unique constraint is too. `expires_at` is the last valid instant,
 * 23:59:59 Asia/Tashkent of the chosen day. Limits count non-voided uses (`promo_code_uses`).
 */
export const promoCodes = pgTable(
  'promo_codes',
  {
    id: id(),
    code: text('code').notNull().unique(),
    kind: promoKindEnum('kind').notNull(),
    /** Whole percent, 1-100 (a percent code). */
    percent: smallint('percent'),
    /** So'm off the eligible items (a fixed code). */
    amount: integer('amount'),
    /** A percent code's cap, so'm. */
    maxDiscount: integer('max_discount'),
    /** A gift code's free item (ADR 0039): one volume, or the Discovery set (`gift_discovery_set`). */
    giftVolumeId: bigint('gift_volume_id', { mode: 'number' }).references(() => volumes.id),
    giftDiscoverySet: boolean('gift_discovery_set').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Compared with items before discount, without delivery (ADR 0007). */
    minOrderTotal: integer('min_order_total'),
    totalLimit: integer('total_limit'),
    perCustomerLimit: integer('per_customer_limit'),
    /** Only for a customer with no other non-cancelled order. */
    newCustomersOnly: boolean('new_customers_only').notNull().default(false),
    /** TZ «применять к уценённым»; off: marked-down items are not discounted (ADR 0008). */
    appliesToMarkedDown: boolean('applies_to_marked_down').notNull().default(false),
    active: boolean('active').notNull().default(true),
    /** Its automatic campaign link was made (#35); a link the owner deleted is never made again. */
    campaignLinkMade: boolean('campaign_link_made').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('promo_codes_code_check', sql`${t.code} = upper(btrim(${t.code})) and ${t.code} <> ''`),
    check(
      'promo_codes_terms_check',
      sql`(${t.kind} = 'percent' and ${t.percent} between 1 and 100 and ${t.amount} is null) or (${t.kind} = 'fixed' and ${t.amount} > 0 and ${t.percent} is null and ${t.maxDiscount} is null) or (${t.kind}::text = 'gift' and ${t.percent} is null and ${t.amount} is null and ${t.maxDiscount} is null)`,
    ),
    // a gift code names exactly one item; the other kinds name none (text: the enum value is new)
    check(
      'promo_codes_gift_check',
      sql`case when ${t.kind}::text = 'gift' then (${t.giftVolumeId} is not null) <> ${t.giftDiscoverySet} else ${t.giftVolumeId} is null and not ${t.giftDiscoverySet} end`,
    ),
    check(
      'promo_codes_limits_check',
      sql`coalesce(${t.maxDiscount}, 1) > 0 and coalesce(${t.minOrderTotal}, 0) >= 0 and coalesce(${t.totalLimit}, 1) > 0 and coalesce(${t.perCustomerLimit}, 1) > 0`,
    ),
  ],
);

/**
 * A promo code held by an order (ADR 0005): written in the order's own transaction under a lock on
 * the code's row, voided (`voided_at`) when the order is cancelled or returned, so it stops counting
 * against the code's limits. One per order.
 */
export const promoCodeUses = pgTable(
  'promo_code_uses',
  {
    id: id(),
    promoCodeId: bigint('promo_code_id', { mode: 'number' })
      .notNull()
      .references(() => promoCodes.id),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (t) => [
    index('promo_code_uses_counted_idx')
      .on(t.promoCodeId, t.customerId)
      .where(sql`${t.voidedAt} is null`),
  ],
);

export type PromoCodeRow = typeof promoCodes.$inferSelect;
export type PromoCodeUseRow = typeof promoCodeUses.$inferSelect;

export const campaignSourceEnum = pgEnum('campaign_source', CAMPAIGN_SOURCES);

/**
 * A Campaign link (ticket #35, ADR 0022): `startapp=l_<code>` opens `target` (a start target from
 * `@lummi/contracts/constants`) and prefills `promo_code_id`'s code in the cart. The code's case is
 * kept (Telegram keeps it) but two links never differ only by case. Every promo code gets one.
 */
export const campaignLinks = pgTable(
  'campaign_links',
  {
    id: id(),
    code: text('code').notNull(),
    target: text('target').notNull(),
    promoCodeId: bigint('promo_code_id', { mode: 'number' }).references(() => promoCodes.id),
    source: campaignSourceEnum('source').notNull(),
    sourceLabel: text('source_label'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_links_code_idx').on(sql`lower(${t.code})`),
    index('campaign_links_promo_idx').on(t.promoCodeId),
    check('campaign_links_code_check', sql`${t.code} ~ '^[A-Za-z0-9_-]{3,40}$'`),
  ],
);

/** One row per open: customer, link, time. "Opens" in reports count distinct customers (ADR 0022). */
export const campaignOpens = pgTable(
  'campaign_opens',
  {
    id: id(),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => campaignLinks.id),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_opens_customer_idx').on(t.customerId, t.openedAt),
    index('campaign_opens_link_idx').on(t.linkId, t.customerId),
  ],
);

export type CampaignLinkRow = typeof campaignLinks.$inferSelect;
export type CampaignOpenRow = typeof campaignOpens.$inferSelect;
/**
 * A birthday coupon (TZ §3.8, ticket #30): issued by the daily job at 10:00 Asia/Tashkent,
 * `birthday.daysBefore` days before the customer's birthday, one per customer per birthday year
 * (the year of the birthday it celebrates; a 29 February birthday is celebrated on 28 February in a
 * common year). Percent and cap are fixed at issue, as the bot message announced them. Its state is
 * derived (ADR 0005): active while `used_by_order_id` is null and `expires_at` (00:00 Tashkent the
 * day after its last day, exclusive) has not come; an order holds it with a conditional update and a
 * cancel or return clears the link. `outbox_id` is its message; null when the customer could not be
 * messaged (bot blocked, write access refused), which reports show as «не доставлено».
 */
export const birthdayCoupons = pgTable(
  'birthday_coupons',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    birthdayYear: integer('birthday_year').notNull(),
    /** The day it celebrates, `YYYY-MM-DD`. */
    birthday: date('birthday', { mode: 'string' }).notNull(),
    percent: smallint('percent').notNull(),
    maxAmount: integer('max_amount').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedByOrderId: bigint('used_by_order_id', { mode: 'number' }).references(() => orders.id),
    /** The outbox row of its message (no FK: the outbox may be pruned). */
    outboxId: bigint('outbox_id', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('birthday_coupons_customer_year_idx').on(t.customerId, t.birthdayYear),
    uniqueIndex('birthday_coupons_used_by_order_idx')
      .on(t.usedByOrderId)
      .where(sql`${t.usedByOrderId} is not null`),
    check(
      'birthday_coupons_terms_check',
      sql`${t.percent} between 1 and 100 and ${t.maxAmount} >= 0 and ${t.expiresAt} > ${t.issuedAt}`,
    ),
  ],
);

export type BirthdayCouponRow = typeof birthdayCoupons.$inferSelect;

/**
 * A review (#41): the customer's rating of one delivered order (one per order), with an optional
 * comment and photos. It starts private; staff publish it, and a published one shows on the cards
 * of every fragrance and set in its order. `step` is where the bot conversation is: waiting for the
 * comment, for photos, or done. A review is released (a low one posted to «Отзывы») once its step
 * is done and no photo is still being fetched; `post_queued_at` is that claim, taken once.
 * `step_at` is the last message, for the sweep that closes an abandoned review.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    orderId: bigint('order_id', { mode: 'number' })
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    step: text('step', { enum: ['comment', 'photos', 'done'] })
      .notNull()
      .default('comment'),
    stepAt: timestamp('step_at', { withTimezone: true }).notNull().defaultNow(),
    /** Taken when the review is finished and has no photo in flight; a low rating's follow-up is queued with it. */
    postQueuedAt: timestamp('post_queued_at', { withTimezone: true }),
    /** A low rating's card in «Отзывы» was queued (the sweep queues it again if it never lands). */
    topicQueuedAt: timestamp('topic_queued_at', { withTimezone: true }),
    /** The card is out, and its Telegram message (the follow-up replies to it). */
    topicPostedAt: timestamp('topic_posted_at', { withTimezone: true }),
    topicMessageId: bigint('topic_message_id', { mode: 'number' }),
    /** The follow-up (comment and photos as a reply to the card) is out, or there was nothing to add. */
    followUpPostedAt: timestamp('follow_up_posted_at', { withTimezone: true }),
    /** One delivery posts to the topic at a time: its claim, expiring after a few minutes. */
    postLeaseAt: timestamp('post_lease_at', { withTimezone: true }),
    /** «Можно приложить до N фото» was said once. */
    photoLimitNoticeAt: timestamp('photo_limit_notice_at', { withTimezone: true }),
    published: boolean('published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reviews_order_idx').on(t.orderId),
    index('reviews_created_idx').on(t.createdAt),
    index('reviews_published_idx')
      .on(t.publishedAt)
      .where(sql`${t.published}`),
    check('reviews_rating_check', sql`${t.rating} between 1 and 5`),
  ],
);
export type ReviewRow = typeof reviews.$inferSelect;

/**
 * A photo of a review. The row is written in the update's transaction with Telegram's `file_id`;
 * a BullMQ job fetches it, checks it by its first bytes, and stores it through `FileStore`
 * (`file_key`, private); null `file_key` means still being fetched. `public_key` is the unguessable
 * name of its public URL, which serves the photo only while its review is published.
 */
export const reviewPhotos = pgTable(
  'review_photos',
  {
    id: id(),
    reviewId: bigint('review_id', { mode: 'number' })
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    fileId: text('file_id').notNull(),
    fileKey: text('file_key'),
    publicKey: uuid('public_key').notNull().defaultRandom(),
    /** Sent to the topic. */
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_photos_review_idx').on(t.reviewId, t.id),
    uniqueIndex('review_photos_public_key_idx').on(t.publicKey),
  ],
);
export type ReviewPhotoRow = typeof reviewPhotos.$inferSelect;

/**
 * One row per distinct error (ADR 0036). The fingerprint hashes the error class, the route and the
 * top stack frames, so a repeat only raises `count` and `last_seen_at`. No message, no query string,
 * no parameter: nothing in this table can hold personal data.
 */
export const errorEvents = pgTable(
  'error_events',
  {
    id: id(),
    fingerprint: text('fingerprint').notNull(),
    errorClass: text('error_class').notNull(),
    /** `GET /orders/:id`, or `worker:<sweep>`: ids and query strings are already stripped. */
    route: text('route').notNull(),
    /** The first application frames, file and function only (no line numbers, no node_modules). */
    frames: text('frames').notNull(),
    count: integer('count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('error_events_fingerprint_key').on(t.fingerprint)],
);

/** What the backup script last reported, one row (ADR 0036): the API alerts when `last_success_at` gets too old. */
export const backupStatus = pgTable(
  'backup_status',
  {
    /** Always true: the primary key that keeps this table to one row. */
    id: boolean('id').primaryKey().default(true),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** Set when the "no backup" alert went out, cleared by the next report: one alert per gap. */
    staleAlertedAt: timestamp('stale_alerted_at', { withTimezone: true }),
    /** When skipped steps were last alerted: at most once a day. */
    skipAlertedAt: timestamp('skip_alerted_at', { withTimezone: true }),
  },
  (t) => [check('backup_status_one_row', sql`${t.id}`)],
);

/**
 * The worker's last tick, one row, written by the worker and read by the API's watch (ADR 0036).
 * `outage_alerted_at` is set when the "worker is silent" alert went out and cleared on recovery,
 * so an outage alerts once and its end once.
 */
export const workerHeartbeat = pgTable(
  'worker_heartbeat',
  {
    /** Always true: the primary key that keeps this table to one row. */
    id: boolean('id').primaryKey().default(true),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
    outageAlertedAt: timestamp('outage_alerted_at', { withTimezone: true }),
  },
  (t) => [check('worker_heartbeat_one_row', sql`${t.id}`)],
);
