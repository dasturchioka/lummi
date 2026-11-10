import { z } from 'zod';
import { CANCEL_REASONS, type OrderAction } from './order-machine';

/** A move that needs nothing: no payload, or an empty one. */
const nothing = z.object({}).strict().optional();
/** A reason typed by staff (a rejected receipt, a return), shown to the shopper as written. */
const typedReason = z.string().trim().min(1).max(500);

/**
 * What each move must carry (ADR 0011, 0006): the Receipt a submission brought, the tracking
 * number for «Передан в BTS», a reason for every cancel and for a rejected receipt, and for a
 * return its reason plus a back-to-stock flag for each line. Whoever calls `transition()` (the Mini App, the bot, the admin panel, a sweep)
 * is checked against the same schemas.
 */
export const transitionPayloadSchemas = {
  /** The Receipt that went in with this move (#28); a receipt never moves an order twice. */
  submit_receipt: z.object({ receiptId: z.number().int().positive() }).strict(),
  /**
   * Money on the card is ground truth (ADR 0012): a payment is confirmed only with the Credit that
   * paid it, plus the Receipt it confirms, or null for a credit that came with no receipt. Only
   * `PaymentConfirmation` makes this move: it checks and links the credit first.
   */
  confirm_payment: z
    .object({
      creditId: z.number().int().positive(),
      receiptId: z.number().int().positive().nullable(),
    })
    .strict(),
  reject_receipt: z.object({ reason: typedReason }).strict(),
  payment_not_found: nothing,
  accept: nothing,
  start_assembly: nothing,
  hand_to_bts: z.object({ trackingNumber: z.string().trim().min(1).max(64) }).strict(),
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
