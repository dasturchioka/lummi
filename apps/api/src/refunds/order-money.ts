import {
  formatLocalDate,
  tashkentDay,
  type AdminOrderDto,
  type OrderStatus,
} from '@lummi/contracts';
import { asc, credits, eq, refunds, sql, staff, type DbOrTx, type OrderRow } from '@lummi/db';

/**
 * A paid order that ended here owes its money back (ADR 0006): a cancel after payment, or the
 * whole order returned. Until the refunds cover it, staff are reminded to send it.
 */
const ENDED: readonly OrderStatus[] = ['cancelled', 'returned'];

/** Where an order's money stands against its Refunds (the page's `money`). */
export type OrderMoney = AdminOrderDto['money'];

/**
 * What paid the order and what its Refunds sent back. Paid is the Credit linked when the payment
 * was confirmed (money on the card is ground truth, ADR 0012), in whole so'm: a credit of another
 * amount that staff linked with a reason is what came in, and what may go back. Null while unpaid.
 */
export async function orderMoney(db: DbOrTx, order: OrderRow): Promise<OrderMoney> {
  const [{ refunded } = { refunded: 0 }] = await db
    .select({ refunded: sql<number>`coalesce(sum(${refunds.amount}), 0)`.mapWith(Number) })
    .from(refunds)
    .where(eq(refunds.orderId, order.id));
  if (order.creditId === null)
    return { paid: null, paidOn: null, refunded, refundable: 0, owed: 0 };
  const [credit] = await db
    .select({ amountTiyin: credits.amountTiyin, occurredAt: credits.occurredAt })
    .from(credits)
    .where(eq(credits.id, order.creditId));
  if (!credit) throw new Error(`order ${order.number}: its credit is gone`);
  const paid = Math.floor(credit.amountTiyin / 100);
  const refundable = Math.max(0, paid - refunded);
  return {
    paid,
    paidOn: formatLocalDate(tashkentDay(credit.occurredAt)),
    refunded,
    refundable,
    owed: ENDED.includes(order.status) ? refundable : 0,
  };
}

/** The order's Refunds, oldest first, with the name of who recorded each (null once removed). */
export async function refundsOf(db: DbOrTx, orderId: number): Promise<AdminOrderDto['refunds']> {
  const rows = await db
    .select({ r: refunds, name: staff.name })
    .from(refunds)
    .leftJoin(staff, eq(staff.id, refunds.staffId))
    .where(eq(refunds.orderId, orderId))
    .orderBy(asc(refunds.id));
  return rows.map(({ r, name }) => ({
    id: r.id,
    amount: r.amount,
    date: r.refundedOn,
    reason: r.reason,
    by: { id: r.staffId, name },
    at: r.createdAt.toISOString(),
  }));
}
