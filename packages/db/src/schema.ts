import type { Discount } from '@lummi/contracts';
import { ORDER_STATUSES, type OrderStatus } from '@lummi/contracts/client';
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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Internal keys are `bigint identity` (ADR 0016); money columns elsewhere are `integer` so'm. */
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const languageEnum = pgEnum('language', LANGUAGES);
export const staffRoleEnum = pgEnum('staff_role', ['owner', 'manager']);
export const themeEnum = pgEnum('theme', ['light', 'dark']);
export const writeAccessEnum = pgEnum('write_access', ['granted', 'refused']);
export const actorTypeEnum = pgEnum('actor_type', ['customer', 'staff', 'ai', 'system']);

/** A Customer is a Telegram account (ADR 0004). */
export const customers = pgTable('customers', {
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
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
 * did not fit the template ('not_an_operation', 'amount', 'time', 'card') and the owner was alerted. The raw text stays
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
    /**
     * The "credit recorded" event (ADR 0021 pattern): the row itself is the event. Queued: handed
     * to BullMQ (a marker, retaken after the requeue window). Handled: every subscriber ran.
     */
    eventQueuedAt: timestamp('event_queued_at', { withTimezone: true }),
    eventHandledAt: timestamp('event_handled_at', { withTimezone: true }),
  },
  (t) => [
    index('credits_event_pending_idx')
      .on(t.id)
      .where(sql`event_handled_at is null`),
    check('credits_amount_positive', sql`${t.amountTiyin} > 0`),
    check('credits_card_last4', sql`${t.cardLast4} ~ '^[0-9]{4}$'`),
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
/** The discount the customer switched to (ADR 0002); the pricing module's `DiscountChoice` has this same shape. */
export type StoredDiscountChoice =
  { type: 'upgrade_right' | 'birthday_coupon'; id: number } | { type: 'promo_code' };

export const carts = pgTable('carts', {
  customerId: bigint('customer_id', { mode: 'number' })
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  /** `{ type: 'upgrade_right' | 'birthday_coupon', id } | { type: 'promo_code' }`; cleared when a code is typed. */
  discountChoice: jsonb('discount_choice').$type<StoredDiscountChoice>(),
  /** An entered or link-prefilled promo code, upper-case; judged by the quote, never blocks the order. */
  promoCode: text('promo_code'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One volume x quantity in a cart. Quantity is what the customer asked for; the server caps it at available on read. */
export const cartLines = pgTable(
  'cart_lines',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    volumeId: bigint('volume_id', { mode: 'number' })
      .notNull()
      .references(() => volumes.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cart_lines_customer_volume_idx').on(t.customerId, t.volumeId),
    index('cart_lines_volume_idx').on(t.volumeId),
    check('cart_lines_qty_check', sql`${t.qty} > 0`),
  ],
);

export type CartRow = typeof carts.$inferSelect;
export type CartLineRow = typeof cartLines.$inferSelect;

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
/** A single volume, or a builder set (five 10 ml volumes, ADR 0009). The Discovery set comes with #22. */
export const orderLineKindEnum = pgEnum('order_line_kind', ['volume', 'builder_set']);

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
    /** The Mini App's key for one checkout attempt: a repeated request returns this order. */
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    uniqueIndex('orders_customer_idempotency_idx').on(t.customerId, t.idempotencyKey),
    index('orders_status_idx').on(t.status),
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
    /** A builder set's five 10 ml volumes: the reserve takes one of each per set unit. */
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
      sql`(${t.kind} = 'volume' and ${t.volumeId} is not null and ${t.setVolumeIds} is null) or (${t.kind} = 'builder_set' and ${t.volumeId} is null and cardinality(${t.setVolumeIds}) = 5)`,
    ),
    check(
      'order_lines_money_check',
      sql`${t.unitPrice} >= 0 and ${t.regularUnitPrice} >= 0 and ${t.lineTotal} >= 0`,
    ),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type { OrderStatus };
export type OrderLineRow = typeof orderLines.$inferSelect;
