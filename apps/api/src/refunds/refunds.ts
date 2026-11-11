import { formatLocalDate, tashkentDay, type RefundBody } from '@lummi/contracts';
import { eq, orders, refunds, type Db, type DbOrTx, type OrderRow } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { OrderCards } from '../orders-group/order-cards';
import { OutboxService } from '../outbox/outbox.service';
import { DB, EDGES } from '../tokens';
import { retryTransientOnce, TryAgainError } from '../util/transient';
import { orderMoney } from './order-money';

/** The refund a staff member records on an order: the admin's body, validated. */
export type RefundInput = { orderId: number; staffId: number } & RefundBody;

export type RecordRefundOutcome =
  | { kind: 'recorded'; order: OrderRow }
  | { kind: 'not_found' }
  /** No payment was ever confirmed: there is no money to send back. */
  | { kind: 'not_paid' }
  /** Another refund was recorded since the manager looked: nothing changed. */
  | { kind: 'refunds_changed'; order: OrderRow }
  /** More than what is left to refund (`max`, 0 once it all went back). */
  | { kind: 'too_large'; max: number }
  /** Before the money arrived, or after today (Tashkent). */
  | { kind: 'invalid_date' }
  | { kind: 'try_again' };

/**
 * Refunds (ADR 0006, #40): staff record the money they sent back for a paid order. A Refund is a
 * money record only: it never moves the status (no `transition()`, no history row, no shopper
 * message) and never touches a discount source. The order's row lock serialises refunds, so their
 * sum never passes what paid the order, however many staff press at once.
 */
@Injectable()
export class Refunds {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(OrderCards) private readonly cards: OrderCards,
  ) {}

  async record(input: RefundInput): Promise<RecordRefundOutcome> {
    try {
      return await retryTransientOnce(() => this.outbox.withTx((tx) => this.recordIn(tx, input)));
    } catch (e) {
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      throw e;
    }
  }

  private async recordIn(tx: DbOrTx, input: RefundInput): Promise<RecordRefundOutcome> {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for('update');
    if (!order) return { kind: 'not_found' };
    const money = await orderMoney(tx, order);
    if (money.paid === null || money.paidOn === null) return { kind: 'not_paid' };
    if (money.refunded !== input.expectedRefunded) return { kind: 'refunds_changed', order };
    if (input.amount > money.refundable) return { kind: 'too_large', max: money.refundable };
    const now = this.edges.clock.now();
    const today = formatLocalDate(tashkentDay(now));
    // `YYYY-MM-DD` compares as text in calendar order
    if (input.date < money.paidOn || input.date > today) return { kind: 'invalid_date' };

    await tx.insert(refunds).values({
      orderId: order.id,
      amount: input.amount,
      refundedOn: input.date,
      reason: input.reason,
      staffId: input.staffId,
      createdAt: now,
    });
    await this.audit.record(tx, {
      actor: { type: 'staff', id: input.staffId },
      action: 'order.refunded',
      targetType: 'order',
      targetId: order.id,
      payload: {
        number: order.number,
        amount: input.amount,
        date: input.date,
        reason: input.reason,
        paid: money.paid,
        refundedBefore: money.refunded,
      },
    });
    // the orders group's card says what went back (#37)
    await this.cards.touch(tx, order.id);
    return { kind: 'recorded', order };
  }
}
