import { formatLocalDate, tashkentDay, tashkentDayStart, type Discount } from '@lummi/contracts';
import { and, eq, gte, inArray, lte, or, orders, refunds, sql, type DbOrTx } from '@lummi/db';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';

/** Tashkent days `YYYY-MM-DD`, both inclusive. */
export interface TashkentRange {
  from: string;
  to: string;
}

/**
 * What every report reads off a Fulfilled order: its snapshot's money, who placed it and when,
 * and the campaign link it took (ADR 0022).
 */
export interface ReportOrder {
  id: number;
  customerId: number;
  createdAt: Date;
  campaignLinkId: number | null;
  /** When it reached «Доставлен» (`fulfilledAt`): the reports count it on this Tashkent day. */
  deliveredAt: Date;
  items: number;
  discount: Discount | null;
  discountAmount: number;
  delivery: number;
}

/** A Refund as a report counts it: the order's refunds sent on one day, on the day they count. */
export interface CountedRefund {
  orderId: number;
  /** greatest(the day it was sent, the order's delivery day): never before the order counts. */
  day: string;
  amount: number;
}

const columns = {
  id: orders.id,
  customerId: orders.customerId,
  createdAt: orders.createdAt,
  campaignLinkId: orders.campaignLinkId,
  at: fulfilledAt,
  items: orders.itemsSubtotal,
  discount: orders.discount,
  discountAmount: orders.discountAmount,
  delivery: orders.deliveryFee,
};

function reportOrder({ at, ...o }: { at: Date | null } & Omit<ReportOrder, 'deliveredAt'>) {
  if (!at) throw new Error(`order ${o.id} is Fulfilled without a delivery`);
  return { ...o, deliveredAt: at };
}

/*
 * The reads every report shares (#42, #43), so the sales report and the marketing reports count
 * the same orders on the same days and the same Refunds on the same days:
 * - an order counts while it is Fulfilled (`FULFILLED_STATUSES`: «Доставлен», not returned), on
 *   the Tashkent day it reached «Доставлен» (`fulfilledAt`), not the day it was placed;
 * - a Refund counts only for an order that is Fulfilled (a cancelled or returned order's sale is
 *   not counted, so neither is its money back), on the day it was sent (`refunded_on`) or, for
 *   money sent back before delivery, on the delivery day: never on a day before the order counts.
 * Call them inside one read-only snapshot.
 */

/** Fulfilled orders that reached «Доставлен» on a day of the range. */
export async function deliveredIn(db: DbOrTx, range: TashkentRange): Promise<ReportOrder[]> {
  const start = tashkentDayStart(range.from);
  const end = tashkentDayStart(range.to, 1);
  const rows = await db
    .select(columns)
    .from(orders)
    .where(
      and(
        fulfilledOrder,
        sql`${fulfilledAt} >= ${start.toISOString()}`,
        sql`${fulfilledAt} < ${end.toISOString()}`,
      ),
    );
  return rows.map(reportOrder);
}

/** These orders while they are Fulfilled (an order a refund names, delivered before the range). */
export async function fulfilledOrdersById(db: DbOrTx, ids: number[]): Promise<ReportOrder[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(columns)
    .from(orders)
    .where(and(fulfilledOrder, inArray(orders.id, ids)));
  return rows.map(reportOrder);
}

/**
 * The Refunds the range counts, summed per order and day sent (in SQL, as `bigint`). A refund
 * counts on greatest(its day, its order's delivery day), so the range takes those sent by its end
 * for orders delivered by its end, and sent or delivered on or after its start.
 */
export async function countedRefunds(db: DbOrTx, range: TashkentRange): Promise<CountedRefund[]> {
  const start = tashkentDayStart(range.from);
  const end = tashkentDayStart(range.to, 1);
  const rows = await db
    .select({
      orderId: orders.id,
      on: refunds.refundedOn,
      delivered: fulfilledAt,
      amount: sql<number>`sum(${refunds.amount})::bigint`.mapWith(Number),
    })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .where(
      and(
        fulfilledOrder,
        lte(refunds.refundedOn, range.to),
        sql`${fulfilledAt} < ${end.toISOString()}`,
        or(gte(refunds.refundedOn, range.from), sql`${fulfilledAt} >= ${start.toISOString()}`),
      ),
    )
    .groupBy(refunds.refundedOn, orders.id);
  return rows.map((r) => {
    const delivered = formatLocalDate(tashkentDay(r.delivered!));
    return { orderId: r.orderId, day: r.on > delivered ? r.on : delivered, amount: r.amount };
  });
}
