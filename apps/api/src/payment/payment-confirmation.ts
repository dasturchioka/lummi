import {
  charCount,
  findTransition,
  PAYMENT_LINK_REASON_MIN,
  type OrderStatus,
  type TransitionPayloadInput,
  type TransitionRefusal,
} from '@lummi/contracts';
import {
  and,
  credits,
  eq,
  orders,
  receipts,
  shopCard,
  sql,
  type Db,
  type DbOrTx,
  type OrderEventRow,
  type OrderRow,
  type ReceiptRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { OrderStatusService } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';
import { retryTransientOnce, TryAgainError, uniqueViolation } from '../util/transient';
import {
  AMOUNT_FITS,
  FREE_CREDIT,
  IN_ORDER_TIME,
  isDuplicateReceipt,
  ON_SHOP_CARD,
  WAITING_VERDICTS,
} from './rules';

export { WAITING_VERDICTS } from './rules';

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
  /**
   * Staff only: why a credit that differs from the order pays it anyway (another amount, tiyin
   * included, or another card). Required then; at least `PAYMENT_LINK_REASON_MIN` characters and
   * at most the setting `payments.linkReasonMaxLength`. Recorded with the move.
   */
  reason?: string;
}

type ReceiptVerdict = ReceiptRow['verdict'];
/** What makes a credit differ from its order, which staff may accept with a reason. */
export type CreditMisfit = 'amount' | 'card';

export type ConfirmPaymentOutcome =
  | {
      kind: 'confirmed';
      order: OrderRow;
      event: OrderEventRow;
      /** The credit went to a card other than the shop card (staff, with a reason). */
      offShopCard: boolean;
      /** The credit minus the Amount due, in tiyin (staff, with a reason, when not 0). */
      differenceTiyin: number;
    }
  | { kind: 'not_found'; what: 'order' | 'credit' | 'receipt' }
  /**
   * The order is not in the status this confirmation needs («Чек на проверке» with a receipt,
   * «Ожидает оплаты» without): a stale screen or a second press. Nothing changed.
   */
  | { kind: 'conflict'; order: OrderRow }
  /**
   * The credit already paid an order (a credit pays one order only), or staff marked it «Не для
   * заказа» (#49; `orderId` null): either way it is not free to pay this one.
   */
  | { kind: 'credit_taken'; orderId: number | null }
  /** The receipt was decided meanwhile (confirmed, rejected, payment not found). */
  | { kind: 'receipt_not_waiting'; verdict: ReceiptVerdict }
  /** AI: the receipt is the same file as one accepted or sent for another order; a person decides. */
  | { kind: 'duplicate_receipt' }
  /**
   * The credit cannot pay this order: it arrived before the order was created (for anyone), or,
   * for the AI, it is another amount (a credit with tiyin always is) or on another card.
   */
  | { kind: 'credit_mismatch'; what: CreditMisfit | 'before_order' }
  /** Staff: the credit differs from the order (`mismatch`); say why in `reason`. */
  | { kind: 'reason_required'; mismatch: CreditMisfit[] }
  /** The reason is shorter than `min` or longer than `max` characters. */
  | { kind: 'reason_invalid'; min: number; max: number }
  /** Not this actor: the AI confirms only a receipt under check. */
  | { kind: 'refused'; code: TransitionRefusal }
  /** The database gave up twice on a deadlock or serialization failure (`confirmPayment` only). */
  | { kind: 'try_again' };

/** The HTTP status of each outcome but `refused`, whose status depends on its code. */
export const CONFIRM_PAYMENT_HTTP = {
  confirmed: 200,
  not_found: 404,
  conflict: 409,
  credit_taken: 409,
  receipt_not_waiting: 409,
  duplicate_receipt: 409,
  credit_mismatch: 422,
  reason_required: 422,
  reason_invalid: 422,
  try_again: 409,
} as const satisfies Record<Exclude<ConfirmPaymentOutcome['kind'], 'refused'>, number>;

/** A refused move: no such move from that status, not this actor, or a payload that does not fit. */
export const TRANSITION_REFUSAL_HTTP = {
  not_allowed: 409,
  forbidden: 403,
  invalid_payload: 422,
} as const satisfies Record<TransitionRefusal, number>;

/** The HTTP status #33's «привязать платёж» and «подтвердить чек» answer for an outcome. */
export function confirmPaymentHttpStatus(out: ConfirmPaymentOutcome): number {
  return out.kind === 'refused'
    ? TRANSITION_REFUSAL_HTTP[out.code]
    : CONFIRM_PAYMENT_HTTP[out.kind];
}

/**
 * The one door that links a Credit to an order and confirms its payment (ADR 0011, 0012). The
 * receipt AI (`PaymentMatching`) and staff in the admin panel (#33: «привязать платёж»,
 * «подтвердить чек») both come here; nothing else makes the `confirm_payment` move.
 *
 * Under locks taken in a fixed order (the order row, then the credit row, then the receipt) it
 * checks that the credit is unlinked and not marked «Не для заказа» (#49, `CreditMarks` takes the
 * same credit lock) and arrived no earlier than the order's minute, and asks the
 * Candidate rule's own pieces (`rules.ts`) whether it is the Amount due to the so'm and on the
 * shop card. The AI takes only an exact credit on the shop card; staff may take another amount or
 * another card with a typed reason. Then, in the caller's transaction, it links the credit, moves
 * the order to «Оплата подтверждена» through `transitionIn()` (its history and the audit entry
 * with the actor, the amounts, the card and the reason; the shopper's message through the outbox)
 * and gives the receipt its verdict. A refusal writes nothing. The DB backs the link:
 * `orders_credit_idx` (one order per credit) and `receipts_one_accepted_idx`.
 */
@Injectable()
export class PaymentConfirmation {
  /** The capability for `confirm_payment`: this class is the only holder. */
  private readonly door: symbol;

  constructor(
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DB) private readonly db: Db,
  ) {
    this.door = status.issueDoor('confirm_payment');
  }

  /** In its own transaction, retried once on a deadlock; the message is queued after the commit. */
  async confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentOutcome> {
    try {
      return await retryTransientOnce(() =>
        this.outbox.withTx((tx) => this.confirmPaymentWithCredit(tx, input)),
      );
    } catch (e) {
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      // the DB's own guard against a second link, should a writer outside this door get there first
      const index = uniqueViolation(e);
      if (index === 'orders_credit_idx' || index === 'receipts_one_accepted_idx') {
        const [payer] = await this.db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.creditId, input.creditId));
        return { kind: 'credit_taken', orderId: payer?.id ?? null };
      }
      throw e;
    }
  }

  /** Inside the caller's transaction (the matching job settles its answer alongside). */
  async confirmPaymentWithCredit(
    tx: DbOrTx,
    input: ConfirmPaymentInput,
  ): Promise<Exclude<ConfirmPaymentOutcome, { kind: 'try_again' }>> {
    const expected: OrderStatus = input.receiptId === null ? 'awaiting_payment' : 'receipt_review';
    if (!findTransition(expected, 'confirm_payment')?.actors.includes(input.actor.type))
      return { kind: 'refused', code: 'forbidden' };

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

    const { rows } = await tx.execute<{
      free: boolean;
      amount: boolean | null;
      in_time: boolean;
      on_card: boolean | null;
    }>(sql`
      select ${FREE_CREDIT} as free, ${AMOUNT_FITS} as amount, ${IN_ORDER_TIME} as in_time,
        ${ON_SHOP_CARD} as on_card
      from ${orders} o join ${credits} c on c.id = ${credit.id} left join ${shopCard} sc on true
      where o.id = ${order.id}`);
    const fit = rows[0]!;
    // marked «Не для заказа» (#49), read under the credit's lock: a mark that won the race is in
    if (!fit.free) return { kind: 'credit_taken', orderId: null };
    if (!fit.in_time) return { kind: 'credit_mismatch', what: 'before_order' };
    const misfits: CreditMisfit[] = [];
    if (!fit.amount) misfits.push('amount');
    if (!fit.on_card) misfits.push('card');

    let reason: string | undefined;
    if (input.actor.type === 'ai') {
      if (misfits.length > 0) return { kind: 'credit_mismatch', what: misfits[0]! };
    } else {
      if (input.reason !== undefined) {
        const max = (await readSettings(tx, ['payments.linkReasonMaxLength']))[
          'payments.linkReasonMaxLength'
        ];
        reason = input.reason.trim();
        // characters as a person counts them, as the panel's counter and the payload schema do
        if (charCount(reason) < PAYMENT_LINK_REASON_MIN || charCount(reason) > max)
          return { kind: 'reason_invalid', min: PAYMENT_LINK_REASON_MIN, max };
      }
      if (misfits.length > 0 && !reason) return { kind: 'reason_required', mismatch: misfits };
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
      if (input.actor.type === 'ai') {
        // a duplicate never confirms itself (spec 2026-11-07); a manager may still decide
        if (await isDuplicateReceipt(tx, receipt.id)) return { kind: 'duplicate_receipt' };
      }
    }

    const differenceTiyin = credit.amountTiyin - order.amountDue * 100;
    const offShopCard = !fit.on_card;
    const payload: TransitionPayloadInput<'confirm_payment'> = {
      creditId: credit.id,
      receiptId: input.receiptId,
      amountDue: order.amountDue,
      creditAmountTiyin: credit.amountTiyin,
      differenceTiyin,
      cardLast4: credit.cardLast4,
      offShopCard,
      ...(reason ? { reason } : {}),
    };
    const moved = await this.status.transitionIn(
      tx,
      order.id,
      'confirm_payment',
      input.actor,
      expected,
      payload,
      this.door,
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
    return {
      kind: 'confirmed',
      order: moved.order,
      event: moved.event,
      offShopCard,
      differenceTiyin,
    };
  }
}
