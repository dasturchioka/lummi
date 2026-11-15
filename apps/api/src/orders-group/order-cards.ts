import {
  and,
  asc,
  customers,
  eq,
  inArray,
  isNull,
  or,
  orderCardPrompts,
  orderCards,
  orderEvents,
  orders,
  outbox,
  receipts,
  sql,
  staff,
  type Db,
  type DbOrTx,
  type OrderCardPanel,
  type OrderCardRow,
} from '@lummi/db';
import { fill } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Edges } from '../edges';
import { linesOf } from '../orders/orders.service';
import { OrderStatusService, type MadeMove } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { orderMoney } from '../refunds/order-money';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { renderCard, type CardData } from './card-view';
import { PostSync } from './post-sync';

/** Staff read the group in Russian, like the owner alerts (spec Changes 2026-11-09). */
const GROUP_LANGUAGE = 'ru';

/**
 * The order's one card in the orders group (#37, spec Changes 2026-11-07).
 *
 * The card opens in the transaction that confirms the payment (a listener on `transition()`,
 * whoever confirmed: the receipt AI or staff), and every later move of the order (from the group,
 * the admin panel or a sweep) bumps it in that move's transaction. Telegram catches up through
 * the outbox (ADR 0021): each change queues an `order_card` row, whose delivery renders the card
 * from the order as it is then and posts it, or edits it when it reads differently, then sends
 * the receipt once as a reply. So edits go through the sender's retry and throttling, a crash
 * loses none, and the card always ends as the order is, even when a slow call lands late
 * (ADR 0034).
 */
@Injectable()
export class OrderCards {
  private readonly log = new Logger('OrderCards');

  private readonly posts: PostSync<OrderCardRow>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrderStatusService) status: OrderStatusService,
  ) {
    this.posts = new PostSync<OrderCardRow>(db, edges, outbox, settings, {
      table: orderCards,
      key: orderCards.orderId,
      kind: 'order_card',
      name: 'order card',
      render: async (card) => renderCard(await this.data(card), GROUP_LANGUAGE),
      receipt: (card) => this.receipt(card),
    });
    status.afterMove((tx, move) => this.onMove(tx, move));
    outbox.handle('order_card', (task) => this.sync(task.ref));
  }

  /** The delivery of an `order_card` row: make Telegram show the card as the order is now (ADR 0034). */
  sync(orderId: number): Promise<void> {
    return this.posts.sync(orderId);
  }

  /** The receipt the payment was confirmed with, captioned «Чек к заказу № N»; none without one. */
  private async receipt(card: OrderCardRow) {
    if (card.receiptId === null) return null;
    const [row] = await this.db
      .select({ key: receipts.normalizedKey, number: orders.number })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, card.receiptId));
    return {
      bytes: row ? await this.edges.files.get(row.key) : null,
      caption: fill(dictionaries[GROUP_LANGUAGE].bot.group.receiptCaption, {
        number: String(row?.number ?? ''),
      }),
    };
  }

  private async onMove(tx: DbOrTx, move: MadeMove): Promise<void> {
    if (move.action === 'confirm_payment') await this.open(tx, move);
    else await this.touch(tx, move.order.id);
  }

  /**
   * «Оплата подтверждена»: the card, in the «Заказы» topic. The primary key keeps it to one per
   * order whatever repeats; with no group set yet there is none (the log says so).
   */
  private async open(tx: DbOrTx, move: MadeMove): Promise<void> {
    const chatId = await this.settings.get('bot.groupChatId', tx);
    if (chatId === null) {
      this.log.warn(`order ${move.order.number}: no card, bot.groupChatId is not set`);
      return;
    }
    const topics = await this.settings.get('bot.topics', tx);
    const receiptId = (move.event.payload as { receiptId?: number | null }).receiptId ?? null;
    const [created] = await tx
      .insert(orderCards)
      .values({ orderId: move.order.id, chatId, threadId: topics.orders, receiptId })
      .onConflictDoNothing()
      .returning({ chatId: orderCards.chatId });
    if (created) await this.outbox.enqueueTask(tx, 'order_card', move.order.id, chatId);
  }

  /**
   * The order changed, or staff opened a keyboard: show it, in the caller's transaction. Any move
   * puts the steps back under the card. False when the order has no card.
   */
  async touch(
    tx: DbOrTx,
    orderId: number,
    panel: OrderCardPanel = { kind: 'steps' },
  ): Promise<boolean> {
    return this.bump(tx, orderId, { panel });
  }

  /**
   * Something the card shows changed without a move (a Refund, #40, ADR 0006): show it, in the
   * caller's transaction, under the same buttons, so a manager halfway through choosing a cancel
   * reason keeps the panel. False when the order has no card.
   */
  async redraw(tx: DbOrTx, orderId: number): Promise<boolean> {
    return this.bump(tx, orderId, {});
  }

  private async bump(
    tx: DbOrTx,
    orderId: number,
    set: { panel?: OrderCardPanel },
  ): Promise<boolean> {
    const [card] = await tx
      .update(orderCards)
      .set({ version: sql`${orderCards.version} + 1`, ...set })
      .where(eq(orderCards.orderId, orderId))
      .returning({ chatId: orderCards.chatId });
    if (!card) return false;
    await this.outbox.enqueueTask(tx, 'order_card', orderId, card.chatId);
    return true;
  }

  /**
   * The group became a supergroup (`migrate_to_chat_id`): its cards, the questions still open
   * there and anything not yet sent to it now live under the new id. In the caller's transaction.
   */
  async moveGroup(tx: DbOrTx, from: number, to: number): Promise<void> {
    await tx.update(orderCards).set({ chatId: to }).where(eq(orderCards.chatId, from));
    await tx
      .update(outbox)
      .set({ chatId: to })
      .where(
        and(
          eq(outbox.chatId, from),
          or(
            and(isNull(outbox.sentAt), isNull(outbox.failedAt)),
            inArray(
              outbox.id,
              tx
                .select({ id: orderCardPrompts.outboxId })
                .from(orderCardPrompts)
                .where(isNull(orderCardPrompts.closedAt)),
            ),
          ),
        ),
      );
  }

  /** What the card shows, read now. */
  private async data(card: OrderCardRow): Promise<CardData> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, card.orderId));
    if (!order) throw new Error(`order card ${card.orderId}: no such order`);
    const [customer] = await this.db
      .select({
        telegramId: customers.telegramId,
        firstName: customers.firstName,
        lastName: customers.lastName,
        username: customers.username,
        phone: customers.phone,
      })
      .from(customers)
      .where(eq(customers.id, order.customerId));
    const events = await this.db
      .select({
        action: orderEvents.action,
        at: orderEvents.createdAt,
        actorType: orderEvents.actorType,
        staffName: staff.name,
        reason: orderEvents.reason,
        payload: orderEvents.payload,
      })
      .from(orderEvents)
      .leftJoin(staff, and(eq(orderEvents.actorType, 'staff'), eq(staff.id, orderEvents.actorId)))
      .where(eq(orderEvents.orderId, order.id))
      .orderBy(asc(orderEvents.id));
    return {
      order,
      lines: await linesOf(this.db, order.id),
      customer: customer!,
      events,
      panel: card.panel,
      money: await orderMoney(this.db, order),
    };
  }
}
