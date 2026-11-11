import type {
  OrderAction,
  OrderDto,
  OrderStatus,
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
import { DiscountSourceHooks } from './discount-sources';
import { EFFECTS, type Effects, type Move } from './effects';
import { cancellationOf } from './history';
import { planTransition } from './machine';
import { orderMessage } from './messages';
import { changeOnHand, type OnHandChange } from './on-hand';

/** The moves only their one door makes, holding the capability `issueDoor()` gave it. */
export const GUARDED_ACTIONS = ['confirm_payment', 'reject_receipt', 'payment_not_found'] as const;
export type GuardedAction = (typeof GUARDED_ACTIONS)[number];
const isGuarded = (a: OrderAction): a is GuardedAction =>
  (GUARDED_ACTIONS as readonly OrderAction[]).includes(a);

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

/**
 * The one door every order status change goes through (ADR 0011): the Mini App, the bot, the
 * admin panel, the receipt AI and the sweeps all call `transition()`. It checks the move against
 * the table, the actor's permission and the payload, locks the order, refuses a stale
 * `expectedStatus` as a conflict, and then, in one transaction, makes the move's effects
 * (`EFFECTS`: on hand, ADR 0010; the discount source, ADR 0005; its columns) and writes the
 * status, the `order_events` row, the audit entry and the shopper's message (outbox, ADR 0021).
 */
@Injectable()
export class OrderStatusService {
  /**
   * The capabilities the guarded moves need, each issued once: `confirm_payment` to
   * `PaymentConfirmation` (ADR 0012), `reject_receipt` to `ReceiptRejection` (ADR 0013, #33),
   * `payment_not_found` to `PaymentNotFound` (ADR 0012, #36).
   */
  private readonly doors: Record<GuardedAction, symbol> = {
    confirm_payment: Symbol('confirm_payment'),
    reject_receipt: Symbol('reject_receipt'),
    payment_not_found: Symbol('payment_not_found'),
  };
  private readonly issued = new Set<GuardedAction>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DiscountSourceHooks) private readonly discountSources: DiscountSourceHooks,
  ) {}

  /**
   * Money on the card is ground truth: only `PaymentConfirmation`, which checks and links the
   * credit, may make the `confirm_payment` move; only `ReceiptRejection`, which checks the receipt
   * and gives it its verdict, may make `reject_receipt`; only `PaymentNotFound`, which marks the
   * receipt it decides, may make `payment_not_found`. Each takes its capability when the app
   * starts; a second taker throws, so the app fails loudly instead of growing a second door.
   */
  issueDoor(action: GuardedAction): symbol {
    if (this.issued.has(action)) throw new Error(`the ${action} capability was already issued`);
    this.issued.add(action);
    return this.doors[action];
  }

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
   * `confirm_payment`, `reject_receipt` and `payment_not_found` are refused as `forbidden` without
   * the capability `issueDoor()` gave their one door.
   */
  async transitionIn<A extends OrderAction>(
    tx: DbOrTx,
    orderId: number,
    action: A,
    actor: TransitionActor,
    expectedStatus: OrderStatus,
    payload: TransitionPayloadInput<A>,
    door?: symbol,
  ): Promise<Exclude<TransitionOutcome, { kind: 'try_again' }>> {
    if (isGuarded(action) && door !== this.doors[action])
      return { kind: 'refused', code: 'forbidden' };
    const plan = planTransition(expectedStatus, action, actor.type, payload);
    if (!plan.ok) return { kind: 'refused', code: plan.code };

    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order || (actor.type === 'customer' && order.customerId !== actor.id))
      return { kind: 'not_found' };
    if (order.status !== expectedStatus) return { kind: 'conflict', order };

    const fx = EFFECTS[action] as Effects<A>;
    const move: Move<A> = { order, lines: await linesOf(tx, order.id), payload: plan.payload };
    if (fx.fits && !fx.fits(move)) return { kind: 'refused', code: 'invalid_payload' };

    const now = this.edges.clock.now();
    const onHand: OnHandChange[] = fx.onHand
      ? await changeOnHand(tx, order.id, move.lines, fx.onHand(move))
      : [];
    if (fx.discountSource) await this.discountSources.release(tx, order);
    if (fx.discountSource === 'release_and_close_rights')
      await this.discountSources.closeRightsOpenedBy(tx, order);

    const [updated] = await tx
      .update(orders)
      .set({ ...fx.columns?.(move), status: plan.to, updatedAt: now })
      .where(and(eq(orders.id, order.id), eq(orders.status, expectedStatus)))
      .returning();
    if (!updated) throw new Error(`order ${order.number}: the locked status moved`);

    const { reason, ...details } = (plan.payload ?? {}) as { reason?: string } & Record<
      string,
      unknown
    >;
    const recorded = { ...details, ...(onHand.length > 0 ? { onHand } : {}) };
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
        payload: recorded,
        createdAt: now,
      })
      .returning();
    await this.audit.record(tx, {
      actor: { type: actor.type, id: actorId },
      action: fx.audit,
      targetType: 'order',
      targetId: order.id,
      payload: {
        number: order.number,
        from: expectedStatus,
        to: plan.to,
        ...(reason ? { reason } : {}),
        ...recorded,
      },
    });

    const [customer] = await tx
      .select({ telegramId: customers.telegramId, language: customers.language })
      .from(customers)
      .where(eq(customers.id, order.customerId));
    if (!customer) throw new Error(`order ${order.number} has no customer`);
    const said = fx.message(move, customer.language);
    if (said) {
      const managerUsername = said.manager
        ? (await readSettings(tx, ['shop.managerUsername']))['shop.managerUsername']
        : undefined;
      await this.outbox.enqueue(
        tx,
        orderMessage(customer, updated, said.text, {
          miniAppUrl: this.env.MINIAPP_URL,
          managerUsername,
        }),
      );
    }
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
}
