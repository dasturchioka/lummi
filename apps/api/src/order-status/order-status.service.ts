import type {
  OrderAction,
  OrderDto,
  OrderStatus,
  TransitionPayload,
  TransitionPayloadInput,
  TransitionRefusal,
} from '@lummi/contracts';
import {
  and,
  customers,
  eq,
  orderEvents,
  orders,
  type Db,
  type DbOrTx,
  type OrderEventRow,
  type OrderLineRow,
  type OrderRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { linesOf, toOrderDto } from '../orders/orders.service';
import { OutboxService } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { retryTransientOnce, TryAgainError } from '../util/transient';
import { closeRightsOpenedBy, releaseDiscountSource } from './discount-source';
import { cancellationOf } from './history';
import { planTransition } from './machine';
import { statusMessage, type MessageLinks } from './messages';
import { lockVolumes, moveOnHand, stockUnits, type OnHandChange } from './stock';

/** Who makes the move: the shopper or a staff member by id, the receipt AI, or a sweep. */
export type TransitionActor =
  | { type: 'customer'; id: number }
  | { type: 'staff'; id: number }
  | { type: 'ai' }
  | { type: 'system' };

export type TransitionOutcome =
  | { kind: 'done'; order: OrderRow; event: OrderEventRow }
  /** No such order, or (for a shopper) not theirs. */
  | { kind: 'not_found' }
  /** The order is no longer in `expectedStatus` (a double press, a stale screen): nothing changed. */
  | { kind: 'conflict'; order: OrderRow }
  | { kind: 'refused'; code: TransitionRefusal }
  /** The database gave up twice on a deadlock or serialization failure. */
  | { kind: 'try_again' };

/** The audit entry of each move, labelled RU/UZ in the admin's audit log. */
const AUDIT_ACTION: Record<OrderAction, string> = {
  submit_receipt: 'order.receipt_submitted',
  confirm_payment: 'order.payment_confirmed',
  reject_receipt: 'order.receipt_rejected',
  payment_not_found: 'order.payment_not_found',
  accept: 'order.accepted',
  start_assembly: 'order.assembling',
  hand_to_bts: 'order.handed_to_bts',
  deliver: 'order.delivered',
  return: 'order.returned',
  cancel: 'order.cancelled',
};

/**
 * The one door every order status change goes through (ADR 0011): the Mini App, the bot, the
 * admin panel, the receipt AI and the sweeps all call `transition()`. It checks the move against
 * the table, the actor's permission and the payload, locks the order, refuses a stale
 * `expectedStatus` as a conflict, and then, in one transaction, writes the status, its stock
 * effects (ADR 0010), the discount-source hook (ADR 0005), the `order_events` row, the audit entry
 * and the shopper's message (outbox, ADR 0021).
 */
@Injectable()
export class OrderStatusService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * In its own transaction, retried once on a deadlock or serialization failure; the message is
   * queued right after the commit.
   */
  async transition<A extends OrderAction>(
    orderId: number,
    action: A,
    actor: TransitionActor,
    expectedStatus: OrderStatus,
    payload: TransitionPayloadInput<A>,
  ): Promise<TransitionOutcome> {
    try {
      return await retryTransientOnce(() =>
        this.outbox.withTx((tx) =>
          this.transitionIn(tx, orderId, action, actor, expectedStatus, payload),
        ),
      );
    } catch (e) {
      if (e instanceof TryAgainError) return { kind: 'try_again' };
      throw e;
    }
  }

  /**
   * Inside the caller's transaction (a receipt intake writing its receipt, a sweep), so the move
   * commits or rolls back with the caller's own rows. A refusal or a conflict writes nothing.
   */
  async transitionIn<A extends OrderAction>(
    tx: DbOrTx,
    orderId: number,
    action: A,
    actor: TransitionActor,
    expectedStatus: OrderStatus,
    payload: TransitionPayloadInput<A>,
  ): Promise<Exclude<TransitionOutcome, { kind: 'try_again' }>> {
    const plan = planTransition(expectedStatus, action, actor.type, payload);
    if (!plan.ok) return { kind: 'refused', code: plan.code };

    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order || (actor.type === 'customer' && order.customerId !== actor.id))
      return { kind: 'not_found' };
    if (order.status !== expectedStatus) return { kind: 'conflict', order };

    const lines = await linesOf(tx, order.id);
    const back = action === 'return' ? backToStock(lines, plan.payload) : null;
    if (back === undefined) return { kind: 'refused', code: 'invalid_payload' };

    const now = this.edges.clock.now();
    const stock = await this.stockEffects(tx, order, lines, action, back);
    if (action === 'cancel' || action === 'return') await releaseDiscountSource(tx, order);
    if (action === 'return') await closeRightsOpenedBy(tx, order);

    const [updated] = await tx
      .update(orders)
      .set({
        status: plan.to,
        updatedAt: now,
        ...(action === 'hand_to_bts'
          ? { trackingNumber: (plan.payload as TransitionPayload<'hand_to_bts'>).trackingNumber }
          : {}),
      })
      .where(and(eq(orders.id, order.id), eq(orders.status, expectedStatus)))
      .returning();
    if (!updated) throw new Error(`order ${order.number}: the locked status moved`);

    const { reason, ...details } = (plan.payload ?? {}) as { reason?: string } & Record<
      string,
      unknown
    >;
    const actorId = 'id' in actor ? actor.id : null;
    const [event] = await tx
      .insert(orderEvents)
      .values({
        orderId: order.id,
        fromStatus: expectedStatus,
        toStatus: plan.to,
        action,
        actorType: actor.type,
        actorId,
        reason: reason ?? null,
        payload: { ...details, ...(stock.length > 0 ? { stock } : {}) },
        createdAt: now,
      })
      .returning();
    await this.audit.record(tx, {
      actor: { type: actor.type, id: actorId },
      action: AUDIT_ACTION[action],
      targetType: 'order',
      targetId: order.id,
      payload: {
        number: order.number,
        from: expectedStatus,
        to: plan.to,
        ...(reason ? { reason } : {}),
        ...details,
        ...(stock.length > 0 ? { stock } : {}),
      },
    });

    const [customer] = await tx
      .select({ telegramId: customers.telegramId, language: customers.language })
      .from(customers)
      .where(eq(customers.id, order.customerId));
    if (!customer) throw new Error(`order ${order.number} has no customer`);
    const message = statusMessage(
      customer,
      updated,
      action,
      plan.payload,
      await this.links(tx, action),
    );
    if (message) await this.outbox.enqueue(tx, message);
    return { kind: 'done', order: updated, event: event! };
  }

  /**
   * The shopper's «Отменить заказ» (ADR 0011: only while «Ожидает оплаты»): the order by its
   * number among their own, cancelled with their reason, answered as the order now reads.
   */
  async cancelByCustomer(
    customerId: number,
    number: number,
    expectedStatus: OrderStatus,
  ): Promise<
    | { kind: 'done'; order: OrderDto }
    | { kind: 'conflict'; order: OrderDto }
    | { kind: 'not_found' }
    | { kind: 'refused'; code: TransitionRefusal }
    | { kind: 'try_again' }
  > {
    const [own] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.number, number)));
    if (!own) return { kind: 'not_found' };
    const out = await this.transition(
      own.id,
      'cancel',
      { type: 'customer', id: customerId },
      expectedStatus,
      { reason: 'customer_cancelled' },
    );
    switch (out.kind) {
      case 'done':
      case 'conflict':
        return { kind: out.kind, order: await this.dto(out.order) };
      default:
        return out;
    }
  }

  private async dto(order: OrderRow): Promise<OrderDto> {
    return toOrderDto(
      order,
      await linesOf(this.db, order.id),
      await cancellationOf(this.db, order.id),
    );
  }

  /**
   * On hand moves only when bottles leave or come back (ADR 0010): down at BTS handover, up when
   * a handed-over parcel is cancelled («Не забрал в BTS») or when returned lines go back to stock.
   * Any move that ends the reserve or touches on hand locks the order's volume rows first, in
   * ascending id like checkout, so a cancel frees its reserve in step with a concurrent checkout.
   */
  private async stockEffects(
    tx: DbOrTx,
    order: OrderRow,
    lines: OrderLineRow[],
    action: OrderAction,
    back: OrderLineRow[] | null,
  ): Promise<OnHandChange[]> {
    if (action !== 'cancel' && action !== 'hand_to_bts' && action !== 'return') return [];
    const all = stockUnits(lines);
    const locked = await lockVolumes(tx, all.keys());
    if (action === 'hand_to_bts') return moveOnHand(tx, locked, all, -1);
    if (action === 'cancel' && order.status === 'handed_to_bts')
      return moveOnHand(tx, locked, all, 1);
    if (action === 'return' && back) return moveOnHand(tx, locked, stockUnits(back), 1);
    return [];
  }

  /** The links a message may carry; the manager's username only where the message asks to act. */
  private async links(tx: DbOrTx, action: OrderAction): Promise<MessageLinks> {
    const links: MessageLinks = { miniAppUrl: this.env.MINIAPP_URL };
    if (action === 'reject_receipt' || action === 'payment_not_found') {
      const s = await readSettings(tx, ['shop.managerUsername']);
      links.managerUsername = s['shop.managerUsername'];
    }
    return links;
  }
}

/**
 * The lines a return puts back on the shelf. Its flags must name every line of the order exactly
 * once (ADR 0006: a leaking bottle is flagged off); anything else is `undefined`, refused.
 */
function backToStock(lines: OrderLineRow[], payload: unknown): OrderLineRow[] | undefined {
  const flags = (payload as TransitionPayload<'return'>).lines;
  const positions = flags.map((f) => f.position);
  if (
    new Set(positions).size !== positions.length ||
    positions.length !== lines.length ||
    !lines.every((l) => positions.includes(l.position))
  )
    return undefined;
  return lines.filter((l) => flags.find((f) => f.position === l.position)?.backToStock);
}
