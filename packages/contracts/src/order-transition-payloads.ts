import { z } from 'zod';
import {
  CANCEL_NOTE_MAX,
  CANCEL_REASONS,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
  type OrderAction,
} from './order-machine';
import { RECEIPT_REJECT_NOTE_HARD_MAX, RECEIPT_REJECT_REASONS } from './receipt-review';

/** The shortest reason staff may give for linking a credit that differs from its order (#32). */
export const PAYMENT_LINK_REASON_MIN = 3;
/** The technical bound of that reason; the setting `payments.linkReasonMaxLength` is at most this. */
export const PAYMENT_LINK_REASON_MAX = 1000;

/**
 * Characters as a person counts them (an emoji is one), the one count for every text limit, in
 * the panel's counters and on the server alike (#33).
 */
export const charCount = (s: string) => [...s].length;

/** Trimmed text of `min` to `max` characters (`charCount`). */
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => charCount(v) >= min && charCount(v) <= max, `${min}-${max} characters`);

/** A row id: a positive integer the API can carry exactly (no JSON 1e20 reaches the database). */
const rowId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A move that needs nothing: no payload, or an empty one. */
const nothing = z.object({}).strict().optional();
/** A reason typed by staff (a return), kept as written. */
const typedReason = text(1, 500);

/**
 * What each move must carry (ADR 0011, 0006): the Receipt a submission brought, the tracking
 * number for «Передан в BTS», a reason for every cancel, the Receipt a rejection turns down with
 * its reason (`other` needs the manager's note), and for a return its reason plus a back-to-stock
 * flag for each line. Whoever calls `transition()` (the Mini App, the bot, the admin panel, a
 * sweep) is checked against the same schemas.
 */
export const transitionPayloadSchemas = {
  /** The Receipt that went in with this move (#28); a receipt never moves an order twice. */
  submit_receipt: z.object({ receiptId: rowId }).strict(),
  /**
   * Money on the card is ground truth (ADR 0012): a payment is confirmed only with the Credit that
   * paid it, plus the Receipt it confirms (null for a credit that came with no receipt), and the
   * move records what that credit was against the order. Only `PaymentConfirmation` makes it.
   */
  confirm_payment: z
    .object({
      creditId: rowId,
      receiptId: rowId.nullable(),
      amountDue: z.number().int().nonnegative(),
      creditAmountTiyin: z.number().int().positive(),
      /** The credit minus the Amount due, in tiyin: above 0 overpaid, below 0 underpaid. */
      differenceTiyin: z.number().int(),
      cardLast4: z.string().regex(/^[0-9]{4}$/),
      /** The credit went to a card other than the shop card. */
      offShopCard: z.boolean(),
      /** Why staff linked a credit that differs (another amount or card); required then. */
      reason: text(PAYMENT_LINK_REASON_MIN, PAYMENT_LINK_REASON_MAX).optional(),
    })
    .strict(),
  /**
   * The Receipt a manager turns down (the one they looked at, so a newer upload is never rejected
   * by a stale screen), a preset reason the shopper reads in their language, and an optional note
   * in the manager's words, required for `other` (#33). Only `ReceiptRejection` makes this move.
   */
  reject_receipt: z
    .object({
      receiptId: rowId,
      reason: z.enum(RECEIPT_REJECT_REASONS),
      note: text(1, RECEIPT_REJECT_NOTE_HARD_MAX).optional(),
    })
    .strict()
    .refine((p) => p.reason !== 'other' || p.note !== undefined, { path: ['note'] }),
  /**
   * The wait window ended with no fitting credit, or the receipt repeats one sent before
   * (ADR 0012, #36). Only `PaymentNotFound` makes it: it names the Receipt it decides (so a newer
   * upload is never the one marked), the receipt it repeats, the time the payment feed was paused
   * while it waited (the reserve is extended by it), and whether the reserve has ended even so
   * (the order is then cancelled by the system right after).
   */
  payment_not_found: z
    .object({
      receiptId: rowId,
      duplicateOf: rowId.nullable(),
      pausedSeconds: z.number().int().nonnegative(),
      reserveEnded: z.boolean(),
    })
    .strict(),
  accept: nothing,
  start_assembly: nothing,
  hand_to_bts: z
    .object({
      trackingNumber: text(TRACKING_NUMBER_MIN, TRACKING_NUMBER_MAX),
    })
    .strict(),
  deliver: nothing,
  return: z
    .object({
      reason: typedReason,
      lines: z
        .array(
          z.object({ position: z.number().int().nonnegative(), backToStock: z.boolean() }).strict(),
        )
        .min(1),
    })
    .strict(),
  cancel: z
    .object({
      reason: z.enum(CANCEL_REASONS),
      /** Staff may add a word to their reason; it stays in the order history. */
      note: text(1, CANCEL_NOTE_MAX).optional(),
    })
    .strict(),
} satisfies Record<OrderAction, z.ZodTypeAny>;

/** What a caller passes for `action`. */
export type TransitionPayloadInput<A extends OrderAction> = z.input<
  (typeof transitionPayloadSchemas)[A]
>;
/** The payload after validation (trimmed). */
export type TransitionPayload<A extends OrderAction> = z.output<
  (typeof transitionPayloadSchemas)[A]
>;
