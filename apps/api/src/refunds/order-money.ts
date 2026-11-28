import {
  formatLocalDate,
  tashkentDay,
  type AdminOrderDto,
  type OrderStatus,
} from '@lummi/contracts';
import {
  asc,
  credits,
  eq,
  orders,
  refunds,
  sql,
  staff,
  type DbOrTx,
  type OrderRow,
} from '@lummi/db';

/**
 * A paid order that ended here owes its money back (ADR 0006): a cancel after payment, or the
 * whole order returned. Until the refunds cover it, staff are reminded to send it.
 */
const ENDED: readonly OrderStatus[] = ['cancelled', 'returned'];

/**
 * What an order's Refunds sent back, whole so'm, 0 with none: a subquery for a select over
 * `orders` (not aliased), one value per order row. The page's money and the list's «Возврат N сум»
 * both read it. The outer row is named in full: drizzle leaves a lone table's columns unqualified,
 * and a bare `id` in here would be the refund's own.
 */
export const refundedSum = () =>
  sql<number>`(select coalesce(sum(rf.amount), 0) from ${refunds} rf where rf.order_id = "orders"."id")`.mapWith(
    Number,
  );

/**
 * The order owes money back (`orderMoney`'s `owed` above 0): it ended cancelled or returned, a
 * Credit paid it, and its Refunds sent back less than that Credit in whole so'm. A condition for
 * a select over `orders` (not aliased): the orders list's `refund_owed` filter and the admin
 * Home's «Возврат денег» queue (#48) read it.
 */
export const refundOwed = () =>
  sql`("orders"."status" in (${sql.join(
    ENDED.map((s) => sql`${s}`),
    sql`, `,
  )}) and "orders"."credit_id" is not null and (select c.amount_tiyin / 100 from ${credits} c where c.id = "orders"."credit_id") > ${refundedSum()})`;

/** Where an order's money stands against its Refunds (the page's `money`). */
export type OrderMoney = AdminOrderDto['money'];

/**
 * What paid the order and what its Refunds sent back. Paid is the Credit linked when the payment
 * was confirmed (money on the card is ground truth, ADR 0012), in whole so'm: a credit of another
 * amount that staff linked with a reason is what came in, and what may go back. Null while unpaid.
 */
export async function orderMoney(db: DbOrTx, order: OrderRow): Promise<OrderMoney> {
  const [{ refunded } = { refunded: 0 }] = await db
    .select({ refunded: refundedSum() })
    .from(orders)
    .where(eq(orders.id, order.id));
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
