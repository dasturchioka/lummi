import { z } from 'zod';
import { tashkentDaySchema } from './admin';
import { bilingualSchema } from './catalog';
import { RECEIPT_REVIEW_REASONS } from './receipt-review';

/*
 * The admin Home (#48): the work queue both roles see, the one most urgent item lifted out of it
 * (the Now item), and for the owner the money-in-today strip and the system line. One call,
 * `GET /admin/home`; the rules are in docs/spec.md → Changes 2026-11-14 (admin Home).
 */

/**
 * The queue «В работе», in its fixed order: the Now item comes from the first one that is not
 * empty. Each links to a list filtered to exactly its items.
 */
export const HOME_QUEUES = [
  /** Receipts a person must decide (payment state `manual_review`). */
  'receipts',
  /** «Принять»: payment confirmed. */
  'accept',
  /** «Собрать»: accepted. */
  'assemble',
  /** «Передать в BTS»: assembling. */
  'bts',
  /** Credits no order holds. */
  'credits',
  /** Paid orders that ended (cancelled, returned) with money still owed back. */
  'refunds',
  /**
   * Fragrances whose free concentrate is gone or at most `stock.lowConcentrateMl`, and the Discovery
   * sets with no boxes or at most `stock.lowAvailableThreshold` (ADR 0043).
   */
  'stock',
  /**
   * Reviews waiting for a decision: finished by the customer, never published or hidden, within
   * `reviews.homeQueueDays` of being finished.
   */
  'reviews',
] as const;
export type HomeQueue = (typeof HOME_QUEUES)[number];

/** A moment on the Tashkent wall clock: its day and `HH:MM`. */
export const tashkentMomentSchema = z.object({
  day: tashkentDaySchema,
  time: z.string().regex(/^\d{2}:\d{2}$/),
});
export type TashkentMoment = z.infer<typeof tashkentMomentSchema>;

const count = z.number().int().nonnegative();
const som = z.number().int().nonnegative();
const seconds = z.number().int().nonnegative();
const number = z.number().int().positive();

/** A queue's size and its oldest item: since when it waits, and for how long now. */
const queueSchema = z.object({
  count,
  since: tashkentMomentSchema.nullable(),
  waitedSeconds: seconds.nullable(),
});
export type HomeQueueHead = z.infer<typeof queueSchema>;

/**
 * A stock row that needs a delivery: a fragrance's ready concentrate (`available` in whole ml, no
 * `ml`), a Discovery set (its `ml` is its vial size, `available` boxes), or the gift sample's 5 ml
 * stock (#79, `available` samples).
 */
export const homeStockItemSchema = z.object({
  kind: z.enum(['fragrance', 'discovery', 'sample']),
  name: z.string().nullable(),
  ml: z.number().int().nullable(),
  available: count,
  level: z.enum(['zero', 'low']),
});
export type HomeStockItem = z.infer<typeof homeStockItemSchema>;

export const homeQueuesSchema = z.object({
  receipts: queueSchema,
  accept: queueSchema,
  assemble: queueSchema,
  bts: queueSchema,
  /** The oldest unlinked credit's exact amount (tiyin) beside its time. */
  credits: queueSchema.extend({ oldestAmountTiyin: z.number().int().positive().nullable() }),
  refunds: queueSchema,
  /** Stock has no age: nothing left (`out`) and running low (`low`), the first of them named. */
  stock: z.object({ count, out: count, low: count, first: homeStockItemSchema.nullable() }),
  reviews: queueSchema,
});
export type HomeQueues = z.infer<typeof homeQueuesSchema>;

/** An order as the Now block names it: who, how much, its first line and where it goes. */
const orderFacts = {
  number,
  customer: z.string(),
  total: som,
  line: z.object({ name: bilingualSchema, ml: z.number().int(), qty: z.number().int() }),
  /** Lines after the first. */
  moreLines: count,
  region: bilingualSchema,
};

const confirmerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ai') }),
  z.object({ type: z.literal('staff'), name: z.string().nullable() }),
]);

/**
 * The Now item: the shop card missing (owner only), an open payment pause, the oldest item of the
 * first queue that is not empty, or `clear` when every queue is empty.
 */
export const homeNowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no_card') }),
  z.object({
    kind: z.literal('humo_pause'),
    /** Since Humo's last sign of life (its last heartbeat or credit, by the pause's cause). */
    silentSeconds: seconds,
    lastSignal: tashkentMomentSchema.nullable(),
  }),
  z.object({
    kind: z.literal('receipt'),
    number,
    customer: z.string(),
    amountDue: som,
    waitedSeconds: seconds,
    /** The setting `payments.uncheckedReceiptAlertSeconds`: the owner is alerted at this wait. */
    alertSeconds: z.number().int().positive(),
    /** The owner was alerted about this receipt. */
    alerted: z.boolean(),
    reviewReason: z.enum(RECEIPT_REVIEW_REASONS).nullable(),
    /** The order's first Candidate credit, if any: what the manager compares the receipt with. */
    credit: z
      .object({
        amountTiyin: z.number().int().positive(),
        at: tashkentMomentSchema,
        cardLast4: z.string(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal('accept'),
    ...orderFacts,
    since: tashkentMomentSchema,
    waitedSeconds: seconds,
    confirmedBy: confirmerSchema,
  }),
  z.object({
    kind: z.literal('assemble'),
    ...orderFacts,
    since: tashkentMomentSchema,
    waitedSeconds: seconds,
  }),
  z.object({
    kind: z.literal('bts'),
    ...orderFacts,
    since: tashkentMomentSchema,
    waitedSeconds: seconds,
  }),
  z.object({
    kind: z.literal('credit'),
    /** The credit's id: the Now item stays the same while this credit waits. */
    id: number,
    amountTiyin: z.number().int().positive(),
    at: tashkentMomentSchema,
    waitedSeconds: seconds,
    cardLast4: z.string(),
    onShopCard: z.boolean(),
    counterparty: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('refund'),
    number,
    customer: z.string(),
    status: z.enum(['cancelled', 'returned']),
    /** Still to send back, whole so'm. */
    owed: som,
    since: tashkentMomentSchema,
    waitedSeconds: seconds,
  }),
  z.object({ kind: z.literal('stock'), item: homeStockItemSchema }),
  z.object({
    kind: z.literal('review'),
    number,
    customer: z.string(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().nullable(),
    since: tashkentMomentSchema,
    waitedSeconds: seconds,
  }),
  z.object({ kind: z.literal('clear') }),
]);
export type HomeNow = z.infer<typeof homeNowSchema>;
export type HomeNowKind = HomeNow['kind'];

/**
 * Payments confirmed in a stretch of time and the credits that paid them: a cash measure (the
 * money on the card), not net sales. `received` is their linked credits in whole so'm, `average`
 * is `received ÷ orders` to the so'm, halves up, null without orders.
 */
export const paidFiguresSchema = z.object({
  orders: count,
  received: som,
  average: som.nullable(),
});
export type PaidFigures = z.infer<typeof paidFiguresSchema>;

const netSalesSchema = z.object({
  from: tashkentDaySchema,
  to: tashkentDaySchema,
  net: z.number().int(),
});

/** The owner's strip: money in today, and #42's net sales (`salesSummary`) over 7 and 14 days. */
export const homeSalesSchema = z.object({
  /** Payments confirmed today (Tashkent), up to now. */
  paidToday: paidFiguresSchema,
  /** The same weekday a week ago, from its midnight up to the same time of day. */
  paidWeekAgo: paidFiguresSchema,
  /** Net sales of the last 7 Tashkent days, today included… */
  week: netSalesSchema,
  /** …and of the 7 days before them. */
  previousWeek: netSalesSchema,
  /** Net sales by day over those 14 days, oldest first; the last is today. */
  days: z.array(z.object({ day: tashkentDaySchema, net: z.number().int() })),
});
export type HomeSales = z.infer<typeof homeSalesSchema>;

/** The owner's system line: the userbot's heartbeat, the last backup, errors in 24 hours. */
export const homeSystemSchema = z.object({
  humo: z.object({
    /** Seconds since the userbot's last heartbeat; null before the first. */
    beatSeconds: seconds.nullable(),
    /** A payment pause is open. */
    paused: z.boolean(),
  }),
  backup: z.object({
    at: tashkentMomentSchema.nullable(),
    /** Older than `ops.backupStaleSeconds`, or none yet. */
    stale: z.boolean(),
  }),
  /** Distinct errors (`error_events`) seen in the last 24 hours. */
  errors24h: count,
});
export type HomeSystem = z.infer<typeof homeSystemSchema>;

const homeBase = {
  /** When the server answered, Tashkent («обновлено HH:MM»). */
  at: tashkentMomentSchema,
  /** No shop card: checkout is closed. */
  cardMissing: z.boolean(),
  now: homeNowSchema,
  queues: homeQueuesSchema,
};

/** A manager's Home carries no owner data: no sales, no system line. */
export const adminHomeSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('owner'),
    ...homeBase,
    sales: homeSalesSchema,
    system: homeSystemSchema,
  }),
  z.object({ role: z.literal('manager'), ...homeBase }),
]);
export type AdminHome = z.infer<typeof adminHomeSchema>;
export type OwnerHome = Extract<AdminHome, { role: 'owner' }>;
