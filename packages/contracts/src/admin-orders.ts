import { adminReviewSchema } from './reviews';
import { z } from 'zod';
import { auditEntrySchema, tashkentDaySchema } from './admin';
import { languageSchema } from './auth';
import { bilingualSchema } from './catalog';
import { ORDER_ACTIONS, ORDER_ACTOR_TYPES } from './order-machine';
import {
  charCount,
  rejectReceiptChoiceSchema,
  transitionPayloadSchemas,
  typedReason,
} from './order-transition-payloads';
import { orderSchema, orderStatusSchema } from './orders';
import { RECEIPT_FILE_KINDS } from './receipt-upload';
import {
  RECEIPT_CHECK_OUTCOMES,
  RECEIPT_REJECT_REASONS,
  RECEIPT_REVIEW_REASONS,
  RECEIPT_VERDICTS,
} from './receipt-review';

const som = z.number().int().nonnegative();
/** A row id the API carries exactly: a JSON 1e20 is a 400, never a database error. */
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const at = z.string().datetime();

/**
 * Where an order's money stands, beside its one status (ADR 0011), for the orders list:
 * - `unpaid`: no payment confirmed and no receipt under check (a cancelled unpaid order too);
 * - `checking`: a receipt is under check, waiting for its credit;
 * - `manual_review`: the receipt under check waits for a person (the AI could not confirm it);
 * - `paid`: the payment was confirmed, whatever happened after (a cancel then owes a Refund).
 */
export const PAYMENT_STATES = ['unpaid', 'checking', 'manual_review', 'paid'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];
export const paymentStateSchema = z.enum(PAYMENT_STATES);

/**
 * What the orders list's «Оплата» filter takes: a payment state, or `refund_owed`, a paid order
 * that ended (cancelled or returned) whose Refunds do not yet cover what paid it (#40, #48).
 */
export const ORDER_PAYMENT_FILTERS = [...PAYMENT_STATES, 'refund_owed'] as const;
export type OrderPaymentFilter = (typeof ORDER_PAYMENT_FILTERS)[number];

export const ADMIN_ORDERS_PAGE_SIZE = 25;
/** The largest order number the panel looks up (nine digits, like the search): beyond it, 404. */
export const ORDER_NUMBER_MAX = 999_999_999;

/** `GET /admin/orders`: newest first; every filter optional, dates are Tashkent days. */
export const adminOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_ORDERS_PAGE_SIZE),
  status: orderStatusSchema.optional(),
  payment: z.enum(ORDER_PAYMENT_FILTERS).optional(),
  /** First day, Tashkent, inclusive. */
  from: tashkentDaySchema.optional(),
  /** Last day, Tashkent, inclusive. */
  to: tashkentDaySchema.optional(),
  /**
   * Orders whose payment was first confirmed on this Tashkent day, a credit paying it: the orders
   * the admin Home's «Оплачено сегодня» cards count, which open the list with it.
   */
  paidOn: tashkentDaySchema.optional(),
  /**
   * An order number or part of a phone (the account phone or the Recipient's), as typed: only its
   * digits count. The order with that number comes first.
   */
  q: z.string().trim().min(1).max(40).optional(),
});
export type AdminOrdersQuery = z.input<typeof adminOrdersQuerySchema>;

/**
 * `GET /admin/orders/export` (#56): the list's filters without its paging, and the language of the
 * file's headers. The file holds every order the filters match, so it equals the list's pages together.
 */
export const adminOrdersExportQuerySchema = adminOrdersQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ lang: languageSchema.default('ru') });
export type AdminOrdersExportParams = z.output<typeof adminOrdersExportQuerySchema>;
/** The list's filters alone: what the export's audit entry records. */
export type AdminOrdersExportFilters = Omit<AdminOrdersExportParams, 'lang'>;

/** A row of the orders list: enough to find the order and see what it waits for. */
export const adminOrderListItemSchema = z.object({
  number: z.number().int(),
  status: orderStatusSchema,
  payment: paymentStateSchema,
  createdAt: at,
  total: som,
  /** Bottles and sets, counted by quantity. */
  itemCount: z.number().int().nonnegative(),
  /** The first line as bought, for a glance at what it is; `lineCount` says how many lines in all. */
  firstLine: z.object({ name: bilingualSchema, ml: z.number().int(), qty: z.number().int() }),
  lineCount: z.number().int().positive(),
  customer: z.object({ id, name: z.string(), phone: z.string().nullable() }),
  recipient: z.object({ name: z.string(), phone: z.string() }),
  region: bilingualSchema,
  isGift: z.boolean(),
  /** What its Refunds sent back, whole so'm: 0 when none («Возврат N сум» beside the status). */
  refunded: som,
});
export type AdminOrderListItemDto = z.infer<typeof adminOrderListItemSchema>;

export const adminOrdersPageSchema = z.object({
  items: z.array(adminOrderListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminOrdersPageDto = z.infer<typeof adminOrdersPageSchema>;

/** A staff member as an entry names them; `name` is null once they were removed. */
const staffRefSchema = z.object({ id, name: z.string().nullable() });
/** Who confirmed a payment: the receipt AI, or a staff member (null name once removed). */
const confirmerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ai') }),
  z.object({ type: z.literal('staff'), id, name: z.string().nullable() }),
]);

/**
 * A Credit as the admin shows it (GLOSSARY): the exact amount in tiyin, the whole so'm matching
 * compares (null when it has tiyin, so it never pays an order to the so'm), the card it came to,
 * and the order it paid, if any («Не привязано» when none), or staff's «Не для заказа» mark (#49).
 */
export const adminCreditSchema = z.object({
  id,
  occurredAt: at,
  amountTiyin: z.number().int().positive(),
  amountSom: som.nullable(),
  cardMask: z.string(),
  cardLast4: z.string(),
  /** The current shop card's last four digits are the same: the account may hold other cards. */
  onShopCard: z.boolean(),
  counterparty: z.string().nullable(),
  order: z.object({ number: z.number().int() }).nullable(),
  /**
   * Not for an order (#49): who marked it, when, and their note. Never on a linked credit; a
   * marked credit is never a Candidate credit and is offered to no order until the mark is off.
   */
  notForOrder: z.object({ at, by: staffRefSchema, note: z.string().nullable() }).nullable(),
});
export type AdminCreditDto = z.infer<typeof adminCreditSchema>;

/**
 * A credit the link dialog offers for an order: the credit, and how it differs from the order's
 * Amount due (in tiyin: 0 fits, above 0 more was sent, below 0 less). Another card shows as
 * `onShopCard: false`. Staff may link one that differs only with a reason (#32).
 */
export const creditOptionSchema = adminCreditSchema.extend({ differenceTiyin: z.number().int() });
export type CreditOptionDto = z.infer<typeof creditOptionSchema>;

/** At most this many credits of each list (candidates, others) come with the options. */
export const CREDIT_OPTIONS_LIMIT = 50;

/**
 * `GET /admin/orders/:number/credit-options`: the Candidate credits first (unlinked, the Amount
 * due to the so'm, on the shop card, no earlier than the order's minute), oldest first; then the
 * other unlinked credits from the order's minute on («показать другие»), newest first.
 */
export const creditOptionsSchema = z.object({
  amountDue: som,
  candidates: z.array(creditOptionSchema),
  others: z.array(creditOptionSchema),
  /** How many others there are in all, past the limit. */
  othersTotal: z.number().int().nonnegative(),
});
export type CreditOptionsDto = z.infer<typeof creditOptionsSchema>;

/**
 * The credits list's «Привязка» filter: `unlinked` («Не привязано») is a credit no order holds and
 * nobody marked not for an order, the admin Home's «Поступления без заказа»; `not_for_order` is a
 * marked one (#49).
 */
export const CREDIT_LINK_FILTERS = ['all', 'unlinked', 'linked', 'not_for_order'] as const;
export type CreditLinkFilter = (typeof CREDIT_LINK_FILTERS)[number];

/** `GET /admin/credits`: newest first. */
export const adminCreditsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_ORDERS_PAGE_SIZE),
  linked: z.enum(CREDIT_LINK_FILTERS).default('all'),
  /** Whole so'm, as an order's amount due reads. */
  amount: z.coerce.number().int().positive().optional(),
  from: tashkentDaySchema.optional(),
  to: tashkentDaySchema.optional(),
});
export type AdminCreditsQuery = z.input<typeof adminCreditsQuerySchema>;

export const adminCreditsPageSchema = z.object({
  items: z.array(adminCreditSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** The «Не для заказа» note's limit: the setting `payments.creditMarkNoteMaxLength`. */
  limits: z.object({ markNoteMax: z.number().int().positive() }),
});
export type AdminCreditsPageDto = z.infer<typeof adminCreditsPageSchema>;

/** The technical bound of a «Не для заказа» note; the setting `payments.creditMarkNoteMaxLength` is at most this. */
export const CREDIT_MARK_NOTE_MAX = 1000;

/** `/admin/credits/:id/not-for-order`: the credit's row id; past the safe integers is a 400. */
export const creditIdParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/**
 * `POST /admin/credits/:id/not-for-order` (#49): mark an unlinked credit as not for an order, with
 * an optional note in the staff member's words (trimmed; empty is none). The server holds it to
 * the setting `payments.creditMarkNoteMaxLength` (`note_too_long` with `max`).
 */
export const creditMarkBodySchema = z
  .object({
    note: z
      .string()
      .trim()
      .refine(
        (v) => charCount(v) <= CREDIT_MARK_NOTE_MAX,
        `at most ${CREDIT_MARK_NOTE_MAX} characters`,
      )
      .optional(),
  })
  .strict();
export type CreditMarkBody = z.input<typeof creditMarkBodySchema>;

/**
 * 409 on a mark or unmark: the credit moved on meanwhile, and comes along as it is now.
 * `credit_taken`: an order holds it (a credit that paid an order is never marked). `credit_changed`:
 * it is already marked (a mark), or no longer marked (an unmark).
 */
export const creditMarkConflictSchema = z.object({
  code: z.enum(['credit_taken', 'credit_changed']),
  credit: adminCreditSchema,
});
export type CreditMarkConflict = z.infer<typeof creditMarkConflictSchema>;

/** 422 on a mark: the note is longer than the setting allows (`max`). */
export const creditMarkInvalidSchema = z.object({
  code: z.literal('note_too_long'),
  max: z.number().int().positive(),
});

/** One answer of the receipt AI about a receipt (`receipt_checks`, #32): read-only, for staff. */
export const receiptCheckSchema = z.object({
  id,
  at,
  /** How many candidate credits it was shown. */
  candidates: z.number().int().positive(),
  provider: z.enum(['typesafe', 'openai', 'none']),
  /** The probabilities in 0..1 (ADR 0013). */
  isReceipt: z.number(),
  amountMatches: z.number(),
  recipientMatches: z.number(),
  choiceConfidence: z.number(),
  chosenCreditId: z.number().int().nullable(),
  /** The judge's own verdict; only this ever confirmed anything. */
  confirmed: z.boolean(),
  /** Why it did not confirm, as the judge put it (a failure, a refusal, below threshold). */
  reason: z.string().nullable(),
  /** What came of it; null while it waits to be acted on. */
  outcome: z.enum(RECEIPT_CHECK_OUTCOMES).nullable(),
});
export type ReceiptCheckDto = z.infer<typeof receiptCheckSchema>;

/**
 * One Receipt on the order page. The image is served only by the private staff endpoint
 * (`/admin/receipts/:id/file`, ADR 0020); `width` and `height` are the normalised image's.
 */
export const adminReceiptSchema = z.object({
  id,
  createdAt: at,
  source: z.enum(['miniapp', 'bot']),
  verdict: z.enum(RECEIPT_VERDICTS),
  fileName: z.string().nullable(),
  kind: z.enum(RECEIPT_FILE_KINDS),
  size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Why it last went to manual review (#32): a duplicate file, the AI unsure, the AI unreachable. */
  reviewReason: z.enum(RECEIPT_REVIEW_REASONS).nullable(),
  /** The receipt AI's answers about it, newest first. */
  checks: z.array(receiptCheckSchema),
  /** Who confirmed the payment with it, and when. */
  confirmation: z.object({ by: confirmerSchema, at }).nullable(),
  /** Who turned it down, when, why (the preset) and in what words (the note). */
  rejection: z
    .object({
      reason: z.enum(RECEIPT_REJECT_REASONS),
      note: z.string().nullable(),
      by: staffRefSchema,
      at,
    })
    .nullable(),
});
export type AdminReceiptDto = z.infer<typeof adminReceiptSchema>;

/** One step of the order's history (`order_events`, ADR 0011), oldest first. */
export const adminOrderEventSchema = z.object({
  id,
  at,
  from: orderStatusSchema,
  to: orderStatusSchema,
  action: z.enum(ORDER_ACTIONS),
  actor: z.object({
    type: z.enum(ORDER_ACTOR_TYPES),
    id: z.number().int().nullable(),
    /** Staff or customer name while they exist; null for the AI and the system. */
    name: z.string().nullable(),
  }),
  /** A cancel's or a rejection's reason code, or a return's typed reason. */
  reason: z.string().nullable(),
  /** The staff note added to a cancel or a rejection. */
  note: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  receiptId: z.number().int().nullable(),
});
export type AdminOrderEventDto = z.infer<typeof adminOrderEventSchema>;

/** One line of a Return: its position and whether its bottles went back on hand (ADR 0010). */
const returnLineSchema = transitionPayloadSchemas.return.shape.lines.element;

/**
 * A Refund (ADR 0006): money sent back to the shopper's card for a paid order, as staff recorded
 * it: whole so'm, the Tashkent day it was sent, the reason and who recorded it.
 */
export const adminRefundSchema = z.object({
  id,
  amount: z.number().int().positive(),
  /** The Tashkent day the money was sent. */
  date: tashkentDaySchema,
  reason: z.string(),
  by: staffRefSchema,
  at,
});
export type AdminRefundDto = z.infer<typeof adminRefundSchema>;

/**
 * The order page: the snapshot as the shopper sees it, then what staff need around it: the
 * customer, every receipt with its verdict, the credit that paid it, the history and the audit.
 */
export const adminOrderSchema = z.object({
  order: orderSchema,
  /** The shop card's last four digits now, for «К переводу … · карта магазина *7364»; null without one. */
  shopCardLast4: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  payment: paymentStateSchema,
  customer: z.object({
    id,
    telegramId: z.number().int(),
    name: z.string(),
    username: z.string().nullable(),
    phone: z.string().nullable(),
    /** The language the shopper reads their messages in. */
    language: languageSchema,
  }),
  /** Newest first. */
  receipts: z.array(adminReceiptSchema),
  /**
   * The Credit linked to the order when its payment was confirmed, with how it was linked: the
   * difference from the Amount due (tiyin), whether it went to another card, the staff reason for
   * either, who linked it and when.
   */
  credit: adminCreditSchema
    .extend({
      link: z.object({
        differenceTiyin: z.number().int(),
        offShopCard: z.boolean(),
        reason: z.string().nullable(),
        by: confirmerSchema,
        at,
      }),
    })
    .nullable(),
  /**
   * Where the money stands against its Refunds: `paid` is the Credit that paid the order, whole
   * so'm (null while unpaid), `paidOn` the Tashkent day it arrived (no refund dates before it),
   * `refunded` what the refunds sent back, `refundable` what a new refund may be at most, and
   * `owed` what is still to go back because the paid order ended (cancelled or returned).
   */
  money: z.object({
    paid: som.nullable(),
    paidOn: tashkentDaySchema.nullable(),
    refunded: som,
    refundable: som,
    owed: som,
  }),
  /** The order's Refunds, oldest first. */
  refunds: z.array(adminRefundSchema),
  /**
   * The Return (ADR 0006): why, when and by whom the delivered order came back, and each line's
   * back-to-stock flag in the order of `order.lines`; null unless «Возвращён».
   */
  returned: z
    .object({
      reason: z.string(),
      at,
      by: staffRefSchema,
      lines: z.array(returnLineSchema),
    })
    .nullable(),
  /**
   * What «Оформить возврат товара» would do now, for its dialog; null unless «Доставлен». `lines`
   * names each line's position in the order of `order.lines`, for its back-to-stock flag.
   */
  returnPreview: z
    .object({
      lines: z.array(z.object({ position: z.number().int().nonnegative() })),
      /**
       * The discount source the order holds (ADR 0005): a promo-code use is voided; a birthday
       * coupon or an upgrade right comes back to the customer (`lost: null`) while within its term
       * and, for a right, not closed. Otherwise it is lost: `expired` past its term, `closed` when
       * the order that opened the right was returned (#38). Null when the order had no discount.
       */
      discount: z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('promo_code'), code: z.string() }),
          z.object({
            type: z.enum(['birthday_coupon', 'upgrade_right']),
            lost: z.enum(['expired', 'closed']).nullable(),
            lastDay: tashkentDaySchema,
          }),
        ])
        .nullable(),
      /**
       * The upgrade rights the order opened (a set, #38): a return closes each. One another order
       * spent (`usedBy`) stays with it, discount and all; an `ended` one changes nothing.
       */
      rights: z.array(
        z.object({
          percent: z.number().int().positive(),
          lastDay: tashkentDaySchema,
          usedBy: z.object({ number: z.number().int() }).nullable(),
          ended: z.boolean(),
        }),
      ),
    })
    .nullable(),
  /** The order's review (#41), whether published or not; null when the shopper has not rated it. */
  review: adminReviewSchema.nullable(),
  events: z.array(adminOrderEventSchema),
  /** The audit entries about this order, newest first. */
  audit: z.array(auditEntrySchema),
  /** What the dialogs check before sending (settings). */
  limits: z.object({
    rejectNoteMax: z.number().int().positive(),
    /** A staff reason for linking a credit that differs: at least `min`, at most `max` characters. */
    linkReasonMin: z.number().int().positive(),
    linkReasonMax: z.number().int().positive(),
  }),
});
export type AdminOrderDto = z.infer<typeof adminOrderSchema>;

/** The fulfilment moves a manager makes one step at a time (ADR 0011). */
export const FULFIL_ACTIONS = ['accept', 'start_assembly', 'hand_to_bts', 'deliver'] as const;
export type FulfilAction = (typeof FULFIL_ACTIONS)[number];

/** The status the manager saw: a stale screen or a second manager's press is caught by it. */
const expectedStatus = orderStatusSchema;

/** `POST /admin/orders/:number/fulfil`: one step on; «Передан в BTS» carries the tracking number. */
export const fulfilBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), expectedStatus }),
  z.object({ action: z.literal('start_assembly'), expectedStatus }),
  z.object({
    action: z.literal('hand_to_bts'),
    expectedStatus,
    trackingNumber: transitionPayloadSchemas.hand_to_bts.shape.trackingNumber,
  }),
  z.object({ action: z.literal('deliver'), expectedStatus }),
]);
export type FulfilBody = z.input<typeof fulfilBodySchema>;

/** `POST /admin/orders/:number/cancel`: a staff reason (TZ §6) and an optional note. */
export const staffCancelBodySchema = transitionPayloadSchemas.cancel.extend({ expectedStatus });
export type StaffCancelBody = z.input<typeof staffCancelBodySchema>;

/**
 * `POST /admin/orders/:number/reject-receipt`: the manager's part of the `reject_receipt` payload,
 * the receipt they looked at, a preset reason and a note (required for `other`; its working limit
 * is the setting `receipts.rejectNoteMaxLength`). The server adds the paused time (#36).
 */
export const rejectReceiptBodySchema = rejectReceiptChoiceSchema;
export type RejectReceiptBody = z.input<typeof rejectReceiptBodySchema>;

/**
 * `POST /admin/orders/:number/confirm-payment`: link the credit the manager picked and confirm the
 * payment through #32's `PaymentConfirmation` (actor: that staff member). With the order's waiting
 * receipt («Чек на проверке») or, for a credit that came with no receipt, `receiptId: null` while
 * the order is «Ожидает оплаты» (TZ §4). A credit of another amount or card needs `reason`.
 */
export const staffConfirmBodySchema = z.object({
  creditId: id,
  receiptId: id.nullable(),
  reason: transitionPayloadSchemas.confirm_payment.shape.reason,
});
export type StaffConfirmBody = z.input<typeof staffConfirmBodySchema>;

/**
 * `POST /admin/orders/:number/return`: the whole delivered order came back (ADR 0006). A reason
 * and a back-to-stock flag for every line; flagged lines go back on hand (ADR 0010), the order's
 * discount source comes back while within validity and the rights it opened close (ADR 0005).
 */
export const staffReturnBodySchema = transitionPayloadSchemas.return.extend({ expectedStatus });
export type StaffReturnBody = z.input<typeof staffReturnBodySchema>;

/**
 * `POST /admin/orders/:number/refund`: record a Refund (ADR 0006) on a paid order. It never
 * changes the status or a discount source. The amount is at most what paid the order minus its
 * earlier refunds; the date is a Tashkent day from the day the money arrived to today.
 * `expectedRefunded` is what the manager saw refunded: another refund recorded meanwhile (a
 * colleague, a second press) is a conflict, so one transfer is never recorded twice.
 */
export const refundBodySchema = z
  .object({
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    date: tashkentDaySchema,
    reason: typedReason,
    expectedRefunded: som.max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type RefundBody = z.input<typeof refundBodySchema>;

export const adminOrderErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found']),
});

/**
 * 409: the order moved on meanwhile (another manager, the AI, the shopper, a sweep), or the
 * receipt was decided: nothing changed, and the order page as it is now comes along. Or the
 * database gave up twice on a deadlock.
 */
export const adminOrderConflictSchema = z.union([
  z.object({
    code: z.enum(['status_changed', 'receipt_changed', 'credit_taken', 'refunds_changed']),
    order: adminOrderSchema,
  }),
  z.object({ code: z.literal('try_again') }),
]);
export type AdminOrderConflict = z.infer<typeof adminOrderConflictSchema>;

/**
 * 422: no such move from the status the manager saw, a payload that does not fit (a reason staff
 * may not give from there), a note over the setting (`max` comes along); or, linking a credit,
 * one that differs from the order without a reason (`mismatch` names what differs), a reason out
 * of bounds (`min`, `max`), or a credit from before the order (`credit_mismatch`). A Refund on an
 * order never paid is `not_paid`; one larger than what is left to refund is `refund_too_large`
 * (`max` is what is left, 0 included); a date before the money arrived or after today, `invalid_date`.
 */
export const adminOrderRefusalSchema = z.object({
  code: z.enum([
    'not_allowed',
    'invalid_payload',
    'note_too_long',
    'reason_required',
    'reason_invalid',
    'credit_mismatch',
    'not_paid',
    'refund_too_large',
    'invalid_date',
  ]),
  min: z.number().int().positive().optional(),
  max: z.number().int().nonnegative().optional(),
  mismatch: z.array(z.enum(['amount', 'card'])).optional(),
  /** With `credit_mismatch`: what rules the credit out (one from before the order, for staff). */
  what: z.enum(['before_order', 'amount', 'card']).optional(),
});
export type AdminOrderRefusal = z.infer<typeof adminOrderRefusalSchema>;
