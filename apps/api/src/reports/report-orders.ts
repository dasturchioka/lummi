import { formatLocalDate, promoGiftValue, tashkentDay, type Discount } from '@lummi/contracts';
import { and, eq, gte, inArray, lte, or, orders, refunds, sql, type DbOrTx } from '@lummi/db';
import { fulfilledAt, fulfilledOrder } from '../orders/fulfilled';
import { rangeBounds, within, type TashkentRange } from './report-range';

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
  /** Items before discount, a gift code's gift at its regular price included (ADR 0039). */
  items: number;
  discount: Discount | null;
  /** The discount as reports count it: a gift code's gift is its regular price (ADR 0039). */
  discountAmount: number;
  /** A gift code's gift value, in both figures above; 0 otherwise. Its line costs 0 in the snapshot. */
  giftValue: number;
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

/**
 * When a Fulfilled order reached «Доставлен». Every Fulfilled order has that move in its history
 * (ADR 0011); one without is a broken history and fails loudly rather than count on no day.
 */
export function deliveredAt(at: Date | null, orderId: number): Date {
  if (!at) throw new Error(`order ${orderId} is Fulfilled without a delivery`);
  return at;
}

/**
 * The one place a report reads an order's money: a gift code's gift (ADR 0039) is counted at its
 * regular price in «Сумма до скидки» and in «Скидка», so «Чистые продажи» stays what was paid.
 */
function reportOrder({
  at,
  ...o
}: { at: Date | null } & Omit<ReportOrder, 'deliveredAt' | 'giftValue'>): ReportOrder {
  const giftValue = promoGiftValue(o.discount);
  return {
    ...o,
    items: o.items + giftValue,
    discountAmount: o.discountAmount + giftValue,
    giftValue,
    deliveredAt: deliveredAt(at, o.id),
  };
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
  const rows = await db
    .select(columns)
    .from(orders)
    .where(and(fulfilledOrder, within(fulfilledAt, range)));
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
  const { start, end } = rangeBounds(range);
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
        sql`${fulfilledAt} < ${end}`,
        or(gte(refunds.refundedOn, range.from), sql`${fulfilledAt} >= ${start}`),
      ),
    )
    .groupBy(refunds.refundedOn, orders.id);
  return rows.map((r) => {
    const delivered = formatLocalDate(tashkentDay(deliveredAt(r.delivered, r.orderId)));
    return { orderId: r.orderId, day: r.on > delivered ? r.on : delivered, amount: r.amount };
  });
}
