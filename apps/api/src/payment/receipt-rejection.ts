import {
  WAITING_RECEIPT_VERDICTS,
  type ReceiptRejectReason,
  type TransitionRefusal,
} from '@lummi/contracts';
import {
  and,
  desc,
  eq,
  orders,
  receipts,
  type DbOrTx,
  type OrderEventRow,
  type OrderRow,
  type ReceiptRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { planTransition } from '../order-status/machine';
import { OrderStatusService } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { retryTransientOnce, TryAgainError } from '../util/transient';

export interface RejectReceiptInput {
  orderId: number;
  /** The Receipt the manager looked at: it must be the order's one under check. */
  receiptId: number;
  reason: ReceiptRejectReason;
  /** The manager's own words; required for `other`, at most `receipts.rejectNoteMaxLength`. */
  note?: string;
  /** Only a manager (or the owner) rejects (ADR 0013). */
  staffId: number;
}

export type RejectReceiptOutcome =
  | { kind: 'rejected'; order: OrderRow; event: OrderEventRow }
  | { kind: 'not_found'; what: 'order' | 'receipt' }
  /** The order is no longer «Чек на проверке» (confirmed, cancelled, payment not found): nothing changed. */
  | { kind: 'conflict'; order: OrderRow }
  /** The receipt was decided meanwhile, or a newer one is under check: nothing changed. */
  | { kind: 'receipt_changed'; order: OrderRow; verdict: ReceiptRow['verdict'] }
  | { kind: 'note_too_long'; max: number }
  | { kind: 'refused'; code: TransitionRefusal }
  /** The database gave up twice on a deadlock or serialization failure (`reject` only). */
  | { kind: 'try_again' };

/**
 * The one door that rejects a Receipt (ADR 0011, 0013): only staff, always with a reason; the
 * admin panel and the orders group (#37) both come here, and `transition()` refuses the move from
 * anyone else. Under the order's lock, then the receipt's (the order `PaymentConfirmation` takes
 * them in), it checks that the order is still «Чек на проверке» and that this receipt is the
 * order's latest and still waiting, moves the
 * order back to «Ожидает оплаты» through `transitionIn()` (its history, the audit entry naming
 * the manager, the shopper's message with the reason in their language) and marks the receipt
 * rejected, in one transaction. The shopper may then send another receipt.
 */
@Injectable()
export class ReceiptRejection {
  /** The capability for `reject_receipt`: this class is the only holder. */
  private readonly door: symbol;

  constructor(
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {
    this.door = status.issueDoor('reject_receipt');
  }

  /** In its own transaction, retried once on a deadlock; the message is queued after the commit. */
  async reject(input: RejectReceiptInput): Promise<RejectReceiptOutcome> {
    try {
      return await retryTransientOnce(() => this.outbox.withTx((tx) => this.rejectIn(tx, input)));
    } catch (e) {
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      throw e;
    }
  }

  async rejectIn(
    tx: DbOrTx,
    input: RejectReceiptInput,
  ): Promise<Exclude<RejectReceiptOutcome, { kind: 'try_again' }>> {
    const payload = { receiptId: input.receiptId, reason: input.reason, note: input.note };
    const plan = planTransition('receipt_review', 'reject_receipt', 'staff', payload);
    if (!plan.ok) return { kind: 'refused', code: plan.code };
    const { note } = plan.payload;
    if (note !== undefined) {
      const max = (await readSettings(tx, ['receipts.rejectNoteMaxLength']))[
        'receipts.rejectNoteMaxLength'
      ];
      if ([...note].length > max) return { kind: 'note_too_long', max };
    }

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for('update');
    if (!order) return { kind: 'not_found', what: 'order' };
    if (order.status !== 'receipt_review') return { kind: 'conflict', order };

    const [receipt] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, input.receiptId), eq(receipts.orderId, order.id)))
      .for('update');
    if (!receipt) return { kind: 'not_found', what: 'receipt' };
    // the receipt under check is the order's latest: an older one is never it, whatever its verdict
    const [latest] = await tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(eq(receipts.orderId, order.id))
      .orderBy(desc(receipts.id))
      .limit(1);
    if (!WAITING_RECEIPT_VERDICTS.includes(receipt.verdict) || latest?.id !== receipt.id)
      return { kind: 'receipt_changed', order, verdict: receipt.verdict };

    const moved = await this.status.transitionIn(
      tx,
      order.id,
      'reject_receipt',
      { type: 'staff', id: input.staffId },
      'receipt_review',
      payload,
      this.door,
    );
    // the order is locked in «Чек на проверке» and the payload fits: any refusal is a bug
    if (moved.kind !== 'done')
      throw new Error(`order ${order.number}: reject_receipt answered ${moved.kind}`);
    await tx.update(receipts).set({ verdict: 'rejected' }).where(eq(receipts.id, receipt.id));
    return { kind: 'rejected', order: moved.order, event: moved.event };
  }
}
