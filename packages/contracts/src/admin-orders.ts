import { z } from 'zod';
import { auditEntrySchema, tashkentDaySchema } from './admin';
import { languageSchema } from './auth';
import { bilingualSchema } from './catalog';
import {
  CANCEL_REASONS,
  ORDER_ACTIONS,
  ORDER_ACTOR_TYPES,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
} from './order-machine';
import { orderSchema, orderStatusSchema } from './orders';
import { RECEIPT_FILE_KINDS } from './receipt-upload';
import {
  RECEIPT_REJECT_NOTE_HARD_MAX,
  RECEIPT_REJECT_REASONS,
  RECEIPT_VERDICTS,
} from './receipt-review';

const som = z.number().int().nonnegative();
const id = z.number().int().positive();
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

export const ADMIN_ORDERS_PAGE_SIZE = 25;
/** The largest order number the panel looks up (nine digits, like the search): beyond it, 404. */
export const ORDER_NUMBER_MAX = 999_999_999;

/** `GET /admin/orders`: newest first; every filter optional, dates are Tashkent days. */
export const adminOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_ORDERS_PAGE_SIZE),
  status: orderStatusSchema.optional(),
  payment: paymentStateSchema.optional(),
  /** First day, Tashkent, inclusive. */
  from: tashkentDaySchema.optional(),
  /** Last day, Tashkent, inclusive. */
  to: tashkentDaySchema.optional(),
  /**
   * An order number or part of a phone (the account phone or the Recipient's), as typed: only its
   * digits count. The order with that number comes first.
   */
  q: z.string().trim().min(1).max(40).optional(),
});
export type AdminOrdersQuery = z.input<typeof adminOrdersQuerySchema>;

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

/**
 * A Credit as the admin shows it (GLOSSARY): the exact amount in tiyin, the whole so'm matching
 * compares (null when it has tiyin, so it never pays an order to the so'm), the card it came to,
 * and the order it paid, if any («Не привязано» when none).
 */
export const adminCreditSchema = z.object({
  id,
  occurredAt: at,
  amountTiyin: z.number().int().positive(),
  amountSom: som.nullable(),
  cardMask: z.string(),
  /** The current shop card's last four digits are the same: the account may hold other cards. */
  onShopCard: z.boolean(),
  counterparty: z.string().nullable(),
  order: z.object({ number: z.number().int() }).nullable(),
});
export type AdminCreditDto = z.infer<typeof adminCreditSchema>;

export const CREDIT_LINK_FILTERS = ['all', 'unlinked', 'linked'] as const;

/** `GET /admin/credits`: newest first. */
export const adminCreditsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_ORDERS_PAGE_SIZE),
  /** `unlinked` is «Не привязано»: credits no order holds. */
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
});
export type AdminCreditsPageDto = z.infer<typeof adminCreditsPageSchema>;

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

/**
 * The order page: the snapshot as the shopper sees it, then what staff need around it: the
 * customer, every receipt with its verdict, the credit that paid it, the history and the audit.
 */
export const adminOrderSchema = z.object({
  order: orderSchema,
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
  /** The Credit linked to the order when its payment was confirmed. */
  credit: adminCreditSchema.nullable(),
  events: z.array(adminOrderEventSchema),
  /** The audit entries about this order, newest first. */
  audit: z.array(auditEntrySchema),
  /** What the dialogs check before sending (settings). */
  limits: z.object({ rejectNoteMax: z.number().int().positive() }),
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
    trackingNumber: z.string().trim().min(TRACKING_NUMBER_MIN).max(TRACKING_NUMBER_MAX),
  }),
  z.object({ action: z.literal('deliver'), expectedStatus }),
]);
export type FulfilBody = z.input<typeof fulfilBodySchema>;

/** `POST /admin/orders/:number/cancel`: a staff reason (TZ §6) and an optional note. */
export const staffCancelBodySchema = z.object({
  expectedStatus,
  reason: z.enum(CANCEL_REASONS),
  note: z.string().trim().min(1).max(500).optional(),
});
export type StaffCancelBody = z.input<typeof staffCancelBodySchema>;

/**
 * `POST /admin/orders/:number/reject-receipt`: the receipt the manager looked at, a preset reason
 * and a note (required for `other`; its limit is the setting `receipts.rejectNoteMaxLength`).
 */
export const rejectReceiptBodySchema = z
  .object({
    receiptId: id,
    reason: z.enum(RECEIPT_REJECT_REASONS),
    note: z.string().trim().min(1).max(RECEIPT_REJECT_NOTE_HARD_MAX).optional(),
  })
  .refine((b) => b.reason !== 'other' || b.note !== undefined, { path: ['note'] });
export type RejectReceiptBody = z.input<typeof rejectReceiptBodySchema>;

export const adminOrderErrorSchema = z.object({
  code: z.enum(['unauthorized', 'forbidden', 'not_found']),
});

/**
 * 409: the order moved on meanwhile (another manager, the AI, the shopper, a sweep), or the
 * receipt was decided: nothing changed, and the order page as it is now comes along. Or the
 * database gave up twice on a deadlock.
 */
export const adminOrderConflictSchema = z.union([
  z.object({ code: z.enum(['status_changed', 'receipt_changed']), order: adminOrderSchema }),
  z.object({ code: z.literal('try_again') }),
]);
export type AdminOrderConflict = z.infer<typeof adminOrderConflictSchema>;

/**
 * 422: no such move from the status the manager saw, a payload that does not fit (a reason staff
 * may not give from there), or a note over the setting (`max` comes along).
 */
export const adminOrderRefusalSchema = z.object({
  code: z.enum(['not_allowed', 'invalid_payload', 'note_too_long']),
  max: z.number().int().positive().optional(),
});
export type AdminOrderRefusal = z.infer<typeof adminOrderRefusalSchema>;
