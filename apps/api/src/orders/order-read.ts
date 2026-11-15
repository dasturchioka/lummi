import type { OrderAction, OrderStatus, PaymentState, ReceiptVerdict } from '@lummi/contracts';
import { orderEvents, orders, sql } from '@lummi/db';

/*
 * How staff read an order, shared by the orders panel (#33), the admin Home (#48) and the orders
 * board (#52): where its money stands, since when it is in its status, and who its customer is.
 */

/** The words of the one payment-state rule, typed against their enums. */
export const PAID_BY: OrderAction = 'confirm_payment';
const UNDER_CHECK: OrderStatus = 'receipt_review';
const HELD: ReceiptVerdict = 'manual_review';
const STATE = {
  paid: 'paid',
  manual_review: 'manual_review',
  checking: 'checking',
  unpaid: 'unpaid',
} as const satisfies Record<PaymentState, PaymentState>;

/**
 * Where an order's money stands (contracts `PAYMENT_STATES`, the one definition): paid once a
 * payment was confirmed, whatever came after; otherwise what its receipt under check waits for.
 * The columns are named with their table: in a one-table select Drizzle leaves the table out, and
 * a bare `id` inside the subqueries would be theirs.
 */
export const paymentState = sql<PaymentState>`case
  when exists (select 1 from order_events pe where pe.order_id = "orders"."id" and pe.action = ${PAID_BY}) then ${STATE.paid}
  when "orders"."status" = ${UNDER_CHECK} and exists (select 1 from receipts pr where pr.order_id = "orders"."id" and pr.verdict = ${HELD}) then ${STATE.manual_review}
  when "orders"."status" = ${UNDER_CHECK} then ${STATE.checking}
  else ${STATE.unpaid}
end`;

/** A customer as staff read them: first and last name, or the first alone. */
export const customerName = (c: { firstName: string; lastName: string | null }) =>
  c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;

/**
 * When the order last entered its current status (its history, ADR 0011); its creation if none.
 * A select over `orders` (not aliased): the Home's queues and the board's «time in this status».
 */
export const enteredStatus =
  sql<Date>`coalesce((select max(ev.created_at) from ${orderEvents} ev where ev.order_id = "orders"."id" and ev.to_status = "orders"."status"), "orders"."created_at")`.mapWith(
    orders.createdAt,
  );
