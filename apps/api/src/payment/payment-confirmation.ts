import type { OrderStatus, TransitionRefusal } from '@lummi/contracts';
import {
  and,
  credits,
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
import { retryTransientOnce, TryAgainError } from '../util/transient';
import { readShopCard } from './shop-card.service';

/** Who confirms a payment (ADR 0011): the receipt AI, or a staff member (owner or manager) by id. */
export type PaymentActor = { type: 'ai' } | { type: 'staff'; id: number };

export interface ConfirmPaymentInput {
  orderId: number;
  /** The Credit that paid the order. */
  creditId: number;
  /**
   * The Receipt this confirms, which must be the order's waiting one; null for a credit that came
   * with no receipt (staff only, the order still «Ожидает оплаты»).
   */
  receiptId: number | null;
  actor: PaymentActor;
}

type ReceiptVerdict = ReceiptRow['verdict'];

/**
 * Receipt verdicts still open (ADR 0012): `pending` waits for a fitting credit, `manual_review`
 * for a person after the AI could not confirm. Either may still be confirmed.
 */
export const WAITING_VERDICTS: readonly ReceiptVerdict[] = ['pending', 'manual_review'];

export type ConfirmPaymentOutcome =
  | { kind: 'confirmed'; order: OrderRow; event: OrderEventRow }
  | { kind: 'not_found'; what: 'order' | 'credit' | 'receipt' }
  /**
   * The order is not in the status this confirmation needs («Чек на проверке» with a receipt,
   * «Ожидает оплаты» without): a stale screen or a second press. Nothing changed.
   */
  | { kind: 'conflict'; order: OrderRow }
  /** The credit already paid an order (this one or another); a credit pays one order only. */
  | { kind: 'credit_taken'; orderId: number }
  /** The receipt was decided meanwhile (confirmed, rejected, payment not found). */
  | { kind: 'receipt_not_waiting'; verdict: ReceiptVerdict }
  /**
   * The credit cannot pay this order: another amount (a credit with tiyin never can), it arrived
   * before the order was created, or (for the AI) it is not on the shop card.
   */
  | { kind: 'credit_mismatch'; reason: 'amount' | 'before_order' | 'card' }
  /** Not this actor: the AI confirms only a receipt under check. */
  | { kind: 'refused'; code: TransitionRefusal }
  /** The database gave up twice on a deadlock or serialization failure (`confirmPayment` only). */
  | { kind: 'try_again' };

/** The HTTP status each outcome answers (#33's «привязать платёж» and «подтвердить чек»). */
export const CONFIRM_PAYMENT_HTTP = {
  confirmed: 200,
  not_found: 404,
  conflict: 409,
  credit_taken: 409,
  receipt_not_waiting: 409,
  credit_mismatch: 422,
  refused: 403,
  try_again: 409,
} as const satisfies Record<ConfirmPaymentOutcome['kind'], number>;

/** Humo keeps only the minute (spec Changes 2026-11-09): a payment in the order's own minute counts. */
export const minuteOf = (at: Date) => new Date(Math.floor(at.getTime() / 60_000) * 60_000);

/**
 * The one door that links a Credit to an order and confirms its payment (ADR 0011, 0012). The
 * receipt AI (`PaymentMatching`) and staff in the admin panel (#33: «привязать платёж»,
 * «подтвердить чек») both come here; nothing else makes the `confirm_payment` move.
 *
 * Under locks taken in a fixed order (the order row, then the credit row, then the receipt) it
 * checks that the credit is unlinked, equals the order's Amount due to the so'm, and arrived no
 * earlier than the order's minute; then, in the caller's transaction, it links the credit, moves
 * the order to «Оплата подтверждена» through `transitionIn()` (its history, the audit entry with
 * the actor, the shopper's message through the outbox) and gives the receipt its verdict. A
 * refusal writes nothing. The DB backs the link: `orders_credit_idx` (one order per credit) and
 * `receipts_one_accepted_idx` (one accepted receipt per order).
 */
@Injectable()
export class PaymentConfirmation {
  constructor(
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** In its own transaction, retried once on a deadlock; the message is queued after the commit. */
  async confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentOutcome> {
    try {
      return await retryTransientOnce(() =>
        this.outbox.withTx((tx) => this.confirmPaymentWithCredit(tx, input)),
      );
    } catch (e) {
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      throw e;
    }
  }

  /** Inside the caller's transaction (the matching job records its check alongside). */
  async confirmPaymentWithCredit(
    tx: DbOrTx,
    input: ConfirmPaymentInput,
  ): Promise<Exclude<ConfirmPaymentOutcome, { kind: 'try_again' }>> {
    const expected: OrderStatus = input.receiptId === null ? 'awaiting_payment' : 'receipt_review';
    const payload = { creditId: input.creditId, receiptId: input.receiptId };
    const plan = planTransition(expected, 'confirm_payment', input.actor.type, payload);
    if (!plan.ok) return { kind: 'refused', code: plan.code };

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for('update');
    if (!order) return { kind: 'not_found', what: 'order' };
    if (order.status !== expected) return { kind: 'conflict', order };

    const [credit] = await tx
      .select()
      .from(credits)
      .where(eq(credits.id, input.creditId))
      .for('update');
    if (!credit) return { kind: 'not_found', what: 'credit' };
    // re-checked under the credit's lock: a racing confirmation has committed its link by now
    const [payer] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.creditId, credit.id));
    if (payer) return { kind: 'credit_taken', orderId: payer.id };
    if (credit.amountSom !== order.amountDue) return { kind: 'credit_mismatch', reason: 'amount' };
    if (credit.occurredAt < minuteOf(order.createdAt))
      return { kind: 'credit_mismatch', reason: 'before_order' };
    if (input.actor.type === 'ai') {
      // staff may link a credit to an earlier card (the card was replaced); the AI only the shop card's
      const card = await readShopCard(tx);
      if (!card || card.number.slice(-4) !== credit.cardLast4)
        return { kind: 'credit_mismatch', reason: 'card' };
    }

    let receipt: ReceiptRow | undefined;
    if (input.receiptId !== null) {
      [receipt] = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.id, input.receiptId), eq(receipts.orderId, order.id)))
        .for('update');
      if (!receipt) return { kind: 'not_found', what: 'receipt' };
      if (!WAITING_VERDICTS.includes(receipt.verdict))
        return { kind: 'receipt_not_waiting', verdict: receipt.verdict };
    }

    const moved = await this.status.transitionIn(
      tx,
      order.id,
      'confirm_payment',
      input.actor,
      expected,
      payload,
    );
    // the order is locked in `expected` and the payload fits it: any refusal here is a bug, and rolls back
    if (moved.kind !== 'done')
      throw new Error(`order ${order.number}: confirm_payment answered ${moved.kind}`);
    if (receipt) {
      await tx
        .update(receipts)
        .set({ verdict: input.actor.type === 'ai' ? 'ai_confirmed' : 'manager_confirmed' })
        .where(eq(receipts.id, receipt.id));
    }
    return { kind: 'confirmed', order: moved.order, event: moved.event };
  }
}
