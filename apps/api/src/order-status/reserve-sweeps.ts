import {
  and,
  asc,
  customers,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  orders,
  sql,
  type DbOrTx,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '../env';
import { readSettings } from '../settings/settings.service';
import { ENV } from '../tokens';
import { WorkerRuntime, type SweepContext } from '../worker/runtime';
import { reserveReminder } from './messages';
import { OrderStatusService } from './order-status.service';

/** How many expired orders one tick cancels at most; the next tick takes the rest. */
const EXPIRY_BATCH = 200;

/**
 * The two sweeps of the unpaid end (ADR 0012, 0021), run by the worker every minute:
 * - `reserve-reminder`: once, `orders.reserveReminderSeconds` before `reserve_until`, an order
 *   still «Ожидает оплаты» gets the reminder; the marker `reserve_reminder_sent_at` is stamped in
 *   the transaction that queues it, so running twice sends nothing twice;
 * - `reserve-expiry`: an order still «Ожидает оплаты» when `reserve_until` passes is cancelled by
 *   the system («Время брони истекло») through `transition()`. «Чек на проверке» holds the
 *   reserve, so this sweep never touches it; the cancel itself is the marker.
 */
@Injectable()
export class ReserveSweeps {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({ name: 'reserve-reminder', run: (ctx) => this.remind(ctx) });
    runtime.register({ name: 'reserve-expiry', run: (ctx) => this.expire(ctx) });
  }

  async remind({ now, withTx, outbox }: SweepContext): Promise<void> {
    await withTx(async (tx) => {
      const { 'orders.reserveReminderSeconds': ahead } = await readSettings(tx, [
        'orders.reserveReminderSeconds',
      ]);
      // One statement claims the due orders, so a concurrent tick cannot take them too. An
      // order created inside the reminder window already said until when in its own message.
      const due = await tx
        .update(orders)
        .set({ reserveReminderSentAt: now })
        .where(
          and(
            eq(orders.status, 'awaiting_payment'),
            isNull(orders.reserveReminderSentAt),
            gt(orders.reserveUntil, now),
            lte(orders.reserveUntil, new Date(now.getTime() + ahead * 1000)),
            sql`${orders.createdAt} < ${orders.reserveUntil} - make_interval(secs => ${ahead})`,
          ),
        )
        .returning();
      if (due.length === 0) return;
      const recipients = await this.recipients(
        tx,
        due.map((o) => o.customerId),
      );
      await outbox.enqueue(
        tx,
        due.map((order) => {
          const c = recipients.get(order.customerId);
          if (!c) throw new Error(`order ${order.number} has no customer`);
          return reserveReminder(c, order, { miniAppUrl: this.env.MINIAPP_URL });
        }),
      );
    });
  }

  async expire({ now, db, withTx }: SweepContext): Promise<void> {
    const due = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'awaiting_payment'), lte(orders.reserveUntil, now)))
      .orderBy(asc(orders.reserveUntil), asc(orders.id))
      .limit(EXPIRY_BATCH);
    let failure: unknown = null;
    for (const { id } of due) {
      try {
        await withTx(async (tx) => {
          // Re-read under the lock: the shopper may have cancelled, a receipt may have gone in,
          // or the reserve may have been extended since the select above.
          const [still] = await tx
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.id, id),
                eq(orders.status, 'awaiting_payment'),
                lte(orders.reserveUntil, now),
              ),
            )
            .for('update');
          if (!still) return;
          await this.status.transitionIn(tx, id, 'cancel', { type: 'system' }, 'awaiting_payment', {
            reason: 'reserve_expired',
          });
        });
      } catch (e) {
        // one order that fails does not hold up the others; the sweep still reports the failure
        failure ??= e;
      }
    }
    if (failure) throw failure;
  }

  private async recipients(tx: DbOrTx, ids: number[]) {
    const rows = await tx
      .select({ id: customers.id, telegramId: customers.telegramId, language: customers.language })
      .from(customers)
      .where(inArray(customers.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }
}
