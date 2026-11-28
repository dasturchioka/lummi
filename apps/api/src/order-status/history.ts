import { CANCEL_REASONS, PAID_STATUSES, type CancelReason, type OrderDto } from '@lummi/contracts';
import { and, desc, eq, orderEvents, type DbOrTx } from '@lummi/db';

/** Why and when the order was cancelled, and whether it had been paid; null when it never was. */
export async function cancellationOf(
  db: DbOrTx,
  orderId: number,
): Promise<OrderDto['cancellation']> {
  const [event] = await db
    .select({ reason: orderEvents.reason, at: orderEvents.createdAt, from: orderEvents.fromStatus })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toStatus, 'cancelled')))
    .orderBy(desc(orderEvents.id))
    .limit(1);
  if (!event) return null;
  if (!CANCEL_REASONS.includes(event.reason as CancelReason))
    throw new Error(`order ${orderId}: a cancel without a known reason`);
  return {
    reason: event.reason as CancelReason,
    at: event.at.toISOString(),
    afterPayment: PAID_STATUSES.includes(event.from),
  };
}
