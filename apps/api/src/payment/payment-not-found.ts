import {
  credits,
  eq,
  orders,
  receipts,
  shopCard,
  sql,
  type Db,
  type DbOrTx,
  type ReceiptRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { OrderStatusService } from '../order-status/order-status.service';
import { AlertService } from '../outbox/alert.service';
import { OutboxService } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { retryTransientOnce } from '../util/transient';
import { WorkerRuntime } from '../worker/runtime';
import { at, PAUSED, PaymentPauses, pausedSecondsAfter } from './payment-pauses';
import { CANDIDATE, sqlList, WAITING_VERDICTS } from './rules';
import { paymentNotFoundPost, repeatedReceiptPost, uncheckedReceiptAlert } from './staff-posts';

/** How many receipts one tick decides at most; the next tick takes the rest. */
const BATCH = 200;

/** Why a receipt is decided: its wait window ended, or it repeats `duplicateOf` (#36). */
export type NotFoundReason =
  { kind: 'window' } | { kind: 'repeat'; duplicateOf: number; sameFile: boolean };

/**
 * Payment not found (ADR 0012, #36): a receipt never waits forever and is never rejected by a
 * machine. Only this class makes the `payment_not_found` move, and it always gives the receipt
 * it decides the verdict `payment_not_found`, so the order's next upload is its only waiting one.
 *
 * - **The wait window.** A waiting receipt (pending or manual review, its order «Чек на проверке»)
 *   is due once `payments.notFoundAfterSeconds` have passed since it was sent and its order has no
 *   Candidate credit at all ("no fitting credit arrived", GLOSSARY): a candidate the AI did not
 *   confirm may be the shopper's money, so a person decides that one.
 * - **The move.** Under the order's lock the order goes back to «Ожидает оплаты», the shopper is
 *   asked to check the amount and card and upload again (with «Написать менеджеру»), and the
 *   «Системные» topic gets an informational post. If the reserve has ended, the system then
 *   cancels the order (`reserve_expired`; the stock returns through `EFFECTS`).
 * - **Idempotent.** The verdict is the marker: a decided receipt is never due again.
 */
@Injectable()
export class PaymentNotFound {
  /** The capability for `payment_not_found`: this class is the only holder. */
  private readonly door: symbol;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(PaymentPauses) private readonly pauses: PaymentPauses,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    this.door = status.issueDoor('payment_not_found');
    runtime.register({ name: 'payment-not-found', run: () => this.sweep() });
  }

  /**
   * The worker's minute: first the payment feed's pause (opened or closed as the feed stands),
   * then, unless paused, every receipt whose wait window ended with no fitting credit.
   */
  async sweep(): Promise<void> {
    const now = this.edges.clock.now();
    const paused = await this.outbox.withTx((tx) => this.pauses.check(tx, now));
    if (!paused) await this.decideDue(now);
    await this.alertUnchecked(now);
  }

  /** Every receipt whose wait window ended with no fitting credit. */
  private async decideDue(now: Date): Promise<void> {
    const window = await this.windowSeconds(this.db);
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select r.id from ${receipts} r join ${orders} o on o.id = r.order_id
      where ${due(window, now)}
      order by r.id
      limit ${BATCH}`);
    let failure: unknown = null;
    for (const { id } of rows) {
      try {
        await this.decide(Number(id), { kind: 'window' });
      } catch (e) {
        // one receipt that fails does not hold up the others; the sweep still reports the failure
        failure ??= e;
      }
    }
    if (failure) throw failure;
  }

  /**
   * Decide one receipt in its own transaction; false when it is no longer due (decided meanwhile,
   * a credit arrived, its order moved on).
   */
  decide(receiptId: number, reason: NotFoundReason): Promise<boolean> {
    return retryTransientOnce(() =>
      this.outbox.withTx((tx) => this.decideIn(tx, receiptId, reason)),
    );
  }

  private async decideIn(tx: DbOrTx, receiptId: number, reason: NotFoundReason): Promise<boolean> {
    const [ref] = await tx
      .select({ orderId: receipts.orderId })
      .from(receipts)
      .where(eq(receipts.id, receiptId));
    if (!ref) return false;
    // the order first, then the receipt: the lock order of every payment door
    const [order] = await tx.select().from(orders).where(eq(orders.id, ref.orderId)).for('update');
    const [receipt] = await tx
      .select()
      .from(receipts)
      .where(eq(receipts.id, receiptId))
      .for('update');
    if (!order || !receipt) return false;
    if (order.status !== 'receipt_review' || !WAITING_VERDICTS.includes(receipt.verdict))
      return false;

    const now = this.edges.clock.now();
    const window = await this.windowSeconds(tx);
    if (reason.kind === 'window') {
      // re-checked under the lock: a credit may have arrived since the sweep's select
      const { rows } = await tx.execute<{ due: boolean }>(sql`
        select ${due(window, now)} as due
        from ${receipts} r join ${orders} o on o.id = r.order_id
        where r.id = ${receiptId}`);
      if (rows[0]?.due !== true) return false;
    }

    const pausedSeconds = await this.pauses.pausedSeconds(tx, receipt.createdAt, now);
    const reserveUntil = new Date(order.reserveUntil.getTime() + pausedSeconds * 1000);
    const reserveEnded = reserveUntil <= now;
    const duplicateOf = reason.kind === 'repeat' ? reason.duplicateOf : null;

    const moved = await this.status.transitionIn(
      tx,
      order.id,
      'payment_not_found',
      { type: 'system' },
      'receipt_review',
      { receiptId, duplicateOf, pausedSeconds, reserveEnded },
      this.door,
    );
    // the order is locked «Чек на проверке»: any refusal here is a bug, and rolls back
    if (moved.kind !== 'done')
      throw new Error(`order ${order.number}: payment_not_found answered ${moved.kind}`);
    await tx
      .update(receipts)
      .set({
        verdict: 'payment_not_found',
        // the «Повторный чек» tag, and which receipt it repeats
        ...(reason.kind === 'repeat'
          ? { reviewReason: 'duplicate' as const, duplicateOf: reason.duplicateOf }
          : {}),
      })
      .where(eq(receipts.id, receiptId));
    if (reserveEnded) {
      const cancelled = await this.status.transitionIn(
        tx,
        order.id,
        'cancel',
        { type: 'system' },
        'awaiting_payment',
        { reason: 'reserve_expired' },
      );
      if (cancelled.kind !== 'done')
        throw new Error(`order ${order.number}: the system cancel answered ${cancelled.kind}`);
    }

    const after = { reserveUntil, cancelled: reserveEnded };
    if (reason.kind === 'repeat') {
      const [twin] = await tx
        .select({ number: orders.number })
        .from(receipts)
        .innerJoin(orders, eq(orders.id, receipts.orderId))
        .where(eq(receipts.id, reason.duplicateOf));
      await this.alerts.postSystem(
        tx,
        repeatedReceiptPost({
          number: order.number,
          twinNumber: twin?.number ?? 0,
          sameFile: reason.sameFile,
          ...after,
        }),
      );
    } else {
      await this.alerts.postSystem(
        tx,
        paymentNotFoundPost({
          number: order.number,
          amountDue: order.amountDue,
          receiptAt: receipt.createdAt,
          windowSeconds: window,
          pausedSeconds,
          ...after,
        }),
      );
    }
    return true;
  }

  /**
   * A receipt waiting (pending or manual review, its order under check) longer than the setting
   * `payments.uncheckedReceiptAlertSeconds` alerts the owner once; `unchecked_alert_at` is the
   * marker, stamped in the transaction that queues the alert.
   */
  private async alertUnchecked(now: Date): Promise<void> {
    await this.outbox.withTx(async (tx) => {
      const { 'payments.uncheckedReceiptAlertSeconds': after } = await readSettings(tx, [
        'payments.uncheckedReceiptAlertSeconds',
      ]);
      const { rows } = await tx.execute<{
        number: string;
        amount_due: string;
        created_at: string | Date;
        review_reason: ReceiptRow['reviewReason'];
      }>(sql`
        update ${receipts} r set unchecked_alert_at = ${at(now)}
        from ${orders} o
        where o.id = r.order_id
          and o.status = 'receipt_review'
          and r.verdict in (${sqlList(WAITING_VERDICTS)})
          and r.unchecked_alert_at is null
          and r.created_at + make_interval(secs => ${after}) <= ${at(now)}
        returning o.number, o.amount_due, r.created_at, r.review_reason`);
      for (const row of rows) {
        const receiptAt = new Date(row.created_at);
        await this.alerts.alertOwner(
          tx,
          uncheckedReceiptAlert({
            number: Number(row.number),
            amountDue: Number(row.amount_due),
            receiptAt,
            waitedSeconds: Math.floor((now.getTime() - receiptAt.getTime()) / 1000),
            reviewReason: row.review_reason,
          }),
        );
      }
    });
  }

  private async windowSeconds(db: DbOrTx): Promise<number> {
    return (await readSettings(db, ['payments.notFoundAfterSeconds']))[
      'payments.notFoundAfterSeconds'
    ];
  }
}

/**
 * Receipt `r` of order `o` is due for payment not found at `now`: still waiting while its order is
 * under check, the payment feed not paused, its wait window over (extended by the pauses since it
 * was sent), a shop card set (without one there are no candidates to judge by), and no Candidate
 * credit for the order at all.
 */
function due(windowSeconds: number, now: Date) {
  return sql`(
    o.status = 'receipt_review'
    and r.verdict in (${sqlList(WAITING_VERDICTS)})
    and not ${PAUSED}
    and r.created_at + make_interval(secs => ${windowSeconds} + ${pausedSecondsAfter(sql`r.created_at`, now)}) <= ${at(now)}
    and exists (select 1 from ${shopCard})
    and not exists (select 1 from ${shopCard} sc join ${credits} c on ${CANDIDATE})
  )`;
}
