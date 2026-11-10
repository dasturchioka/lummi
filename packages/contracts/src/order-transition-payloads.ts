import { z } from 'zod';
import {
  CANCEL_REASONS,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
  type OrderAction,
} from './order-machine';
import { RECEIPT_REJECT_NOTE_HARD_MAX, RECEIPT_REJECT_REASONS } from './receipt-review';

/** A move that needs nothing: no payload, or an empty one. */
const nothing = z.object({}).strict().optional();
/** A reason typed by staff (a return), kept as written. */
const typedReason = z.string().trim().min(1).max(500);

/**
 * What each move must carry (ADR 0011, 0006): the Receipt a submission brought, the tracking
 * number for «Передан в BTS», a reason for every cancel, the Receipt a rejection turns down with
 * its reason (`other` needs the manager's note), and for a return its reason plus a back-to-stock
 * flag for each line. Whoever calls `transition()` (the Mini App, the bot, the admin panel, a
 * sweep) is checked against the same schemas.
 */
export const transitionPayloadSchemas = {
  /** The Receipt that went in with this move (#28); a receipt never moves an order twice. */
  submit_receipt: z.object({ receiptId: z.number().int().positive() }).strict(),
  confirm_payment: nothing,
  /**
   * The Receipt a manager turns down (the one they looked at, so a newer upload is never rejected
   * by a stale screen), a preset reason the shopper reads in their language, and an optional note
   * in the manager's words, required for `other` (#33). Only `ReceiptRejection` makes this move.
   */
  reject_receipt: z
    .object({
      receiptId: z.number().int().positive(),
      reason: z.enum(RECEIPT_REJECT_REASONS),
      note: z.string().trim().min(1).max(RECEIPT_REJECT_NOTE_HARD_MAX).optional(),
    })
    .strict()
    .refine((p) => p.reason !== 'other' || p.note !== undefined, { path: ['note'] }),
  payment_not_found: nothing,
  accept: nothing,
  start_assembly: nothing,
  hand_to_bts: z
    .object({
      trackingNumber: z.string().trim().min(TRACKING_NUMBER_MIN).max(TRACKING_NUMBER_MAX),
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
      note: z.string().trim().min(1).max(500).optional(),
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
