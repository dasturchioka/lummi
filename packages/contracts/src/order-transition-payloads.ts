import { z } from 'zod';
import { CANCEL_REASONS, type OrderAction } from './order-machine';

/** The shortest reason staff may give for linking a credit that differs from its order (#32). */
export const PAYMENT_LINK_REASON_MIN = 3;
/** The technical bound of that reason; the setting `payments.linkReasonMaxLength` is at most this. */
export const PAYMENT_LINK_REASON_MAX = 1000;

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
   * paid it, plus the Receipt it confirms (null for a credit that came with no receipt), and the
   * move records what that credit was against the order. Only `PaymentConfirmation` makes it.
   */
  confirm_payment: z
    .object({
      creditId: z.number().int().positive(),
      receiptId: z.number().int().positive().nullable(),
      amountDue: z.number().int().nonnegative(),
      creditAmountTiyin: z.number().int().positive(),
      /** The credit minus the Amount due, in tiyin: above 0 overpaid, below 0 underpaid. */
      differenceTiyin: z.number().int(),
      cardLast4: z.string().regex(/^[0-9]{4}$/),
      /** The credit went to a card other than the shop card. */
      offShopCard: z.boolean(),
      /** Why staff linked a credit that differs (another amount or card); required then. */
      reason: z
        .string()
        .trim()
        .min(PAYMENT_LINK_REASON_MIN)
        .max(PAYMENT_LINK_REASON_MAX)
        .optional(),
    })
    .strict(),
  reject_receipt: z.object({ reason: typedReason }).strict(),
  /**
   * The wait window ended with no fitting credit, or the receipt repeats one sent before
   * (ADR 0012, #36). Only `PaymentNotFound` makes it: it names the Receipt it decides (so a newer
   * upload is never the one marked), the receipt it repeats, the time the payment feed was paused
   * while it waited (the reserve is extended by it), and whether the reserve has ended even so
   * (the order is then cancelled by the system right after).
   */
  payment_not_found: z
    .object({
      receiptId: z.number().int().positive(),
      duplicateOf: z.number().int().positive().nullable(),
      pausedSeconds: z.number().int().nonnegative(),
      reserveEnded: z.boolean(),
    })
    .strict(),
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
