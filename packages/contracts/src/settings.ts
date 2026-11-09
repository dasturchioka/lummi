import { z } from 'zod';
import { thresholdBaseSchema, type UpgradeRightSource } from './quote';

/**
 * Every rule value is a setting (CLAUDE.md invariant). Add a key here with its zod schema
 * and default; services read it through SettingsService, admins change it through
 * SettingsService.set (which writes the audit entry).
 */
export const settingDefinitions = {
  'auth.initDataMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
  },
  'auth.initDataMaxFutureSkewSeconds': {
    schema: z.number().int().min(0).max(300),
    default: 30,
  },
  'auth.sessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86_400),
    default: 3600,
  },
  // Orders group (spec Changes 2026-11-07). Null until the group is set up; the bot follows migrate_to_chat_id.
  'bot.groupChatId': { schema: z.number().int().nullable(), default: null },
  'bot.topics': {
    schema: z.object({
      orders: z.number().int().nullable(),
      payments: z.number().int().nullable(),
      reviews: z.number().int().nullable(),
      system: z.number().int().nullable(),
    }),
    default: { orders: null, payments: null, reviews: null, system: null },
  },
  /** Telegram ids (owner, developer) who get alerts in DM as well as in the Системные topic. */
  'bot.alertRecipients': { schema: z.array(z.number().int()), default: [] as number[] },
  /** A queued outbox row that was not sent within this window is handed to the queue again. */
  'outbox.requeueAfterSeconds': { schema: z.number().int().min(30).max(86_400), default: 300 },
  /** After this many consecutive failed ticks a sweep alerts the owner once (not every minute). */
  'worker.sweepFailureAlertAfter': { schema: z.number().int().min(1).max(1000), default: 3 },
  /** Delivery is free once the threshold base reaches this many so'm (TZ §8). */
  'pricing.freeDeliveryThreshold': {
    schema: z.number().int().min(0).max(100_000_000),
    default: 250_000,
  },
  /** The delivery fee before the free-delivery threshold when the customer has no delivery city; a region's own tariff wins (spec Changes 2026-11-10). */
  'delivery.defaultTariff': {
    schema: z.number().int().min(0).max(100_000_000),
    default: 25_000,
  },
  /** How many 10 ml suggestions the cart's free-delivery thread offers (spec Changes 2026-11-10). */
  'cart.suggestionsLimit': { schema: z.number().int().min(0).max(12), default: 3 },
  /** Per discount source: is the threshold compared with items before or after the discount (spec Changes 2026-11-07). */
  'pricing.thresholdBase': {
    schema: z.object({
      upgradeRight: z.object({
        set: thresholdBaseSchema,
        single_10ml: thresholdBaseSchema,
      } satisfies Record<UpgradeRightSource, typeof thresholdBaseSchema>),
      promoCode: thresholdBaseSchema,
      birthdayCoupon: thresholdBaseSchema,
    }),
    default: {
      upgradeRight: { set: 'before', single_10ml: 'before' },
      promoCode: 'after',
      birthdayCoupon: 'after',
    } as const,
  },
  /** Whether upgrade rights and birthday coupons also discount marked-down items; promo codes carry their own flag (ADR 0008). */
  'pricing.discountsApplyToMarkedDown': {
    schema: z.object({ upgradeRight: z.boolean(), birthdayCoupon: z.boolean() }),
    default: { upgradeRight: false, birthdayCoupon: false },
  },
  /** The volumes an upgrade right can discount: Full size (TZ §3.4 «Полный объём»); never 10 ml. */
  'pricing.fullSizeVolumesMl': {
    schema: z.array(z.number().int().gt(10, 'Full size is above 10 ml')).min(1),
    default: [30, 50] as number[],
  },
  'auth.loginWidgetMaxAgeSeconds': {
    schema: z.number().int().min(10).max(86_400),
    default: 300,
  },
  'auth.loginWidgetMaxFutureSkewSeconds': {
    schema: z.number().int().min(0).max(300),
    default: 30,
  },
  'auth.staffSessionTtlSeconds': {
    schema: z
      .number()
      .int()
      .min(300)
      .max(30 * 86_400),
    default: 7 * 86_400,
  },
  // Receipt AI (ADR 0013). Defaults tuned later on 20-30 real receipts with the eval script.
  /** Every predicate (is a receipt, amount, recipient) must reach this probability to confirm. */
  'ai.receipt.probabilityThreshold': { schema: z.number().min(0).max(1), default: 0.8 },
  /** The receipt's date-time choice must reach this confidence (and not be "none of these"). */
  'ai.receipt.confidenceThreshold': { schema: z.number().min(0).max(1), default: 0.6 },
  /** Per-call timeouts; on expiry TypeSafe falls back to OpenAI, OpenAI means "failed". */
  'ai.receipt.typesafeTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 20_000,
  },
  'ai.receipt.openaiTimeoutMs': {
    schema: z.number().int().min(1000).max(120_000),
    default: 30_000,
  },
  // Search (ADR 0019).
  /** Ranking weights of the trigram score: name and aliases, original brand, notes, family. */
  'search.weights': {
    schema: z.object({
      name: z.number().min(0).max(100),
      brand: z.number().min(0).max(100),
      notes: z.number().min(0).max(100),
      family: z.number().min(0).max(100),
      /** Added to a fragrance whose card key notes contain the query word, within its tier. */
      keyNotes: z.number().min(0).max(100),
    }),
    default: { name: 3, brand: 1.5, notes: 1, family: 1, keyNotes: 10 },
  },
  /** A field only counts when its trigram word similarity with the query reaches this (0..1). */
  'search.minSimilarity': { schema: z.number().min(0).max(1), default: 0.3 },
  /** Suggestions and results start at this many characters. */
  'search.minQueryLength': { schema: z.number().int().min(1).max(10), default: 2 },
  'search.suggestLimit': { schema: z.number().int().min(1).max(20), default: 5 },
  'search.resultsLimit': { schema: z.number().int().min(1).max(100), default: 30 },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;
export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];
