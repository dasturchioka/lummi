import { createHash } from 'node:crypto';
import {
  and,
  asc,
  customers,
  eq,
  isNull,
  lt,
  or,
  orderCards,
  orderEvents,
  orders,
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
import { MessageGoneError } from '../edges';
import { linesOf } from '../orders/orders.service';
import { OrderStatusService, type MadeMove } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { renderCard, type CardData, type CardView } from './card-view';

/** Staff read the group in Russian, like the owner alerts (spec Changes 2026-11-09). */
const GROUP_LANGUAGE = 'ru';

/** HTML, and no preview for a link someone typed into a comment. */
const CARD_FORMAT = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/** Another delivery is bringing the same card up to date; this one is retried after it. */
export class CardBusyError extends Error {
  constructor(orderId: number) {
    super(`order ${orderId}: its card is being updated by another delivery`);
    this.name = 'CardBusyError';
  }
}

/**
 * The order's one card in the orders group (#37, spec Changes 2026-11-07).
 *
 * The card opens in the transaction that confirms the payment (a listener on `transition()`,
 * whoever confirmed: the receipt AI or staff), and every later move of the order (from the group,
 * the admin panel or a sweep) bumps it in that move's transaction. Telegram catches up through
 * the outbox (ADR 0021): each change queues an `order_card` row, whose delivery renders the card
 * from the order as it is then and posts it, or edits it when it reads differently, then sends
 * the receipt once as a reply. So edits go through the sender's retry and throttling, a crash
 * loses none, and an old render can never land after a newer one.
 */
@Injectable()
export class OrderCards {
  private readonly log = new Logger('OrderCards');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrderStatusService) status: OrderStatusService,
  ) {
    status.afterMove((tx, move) => this.onMove(tx, move));
    outbox.handle('order_card', (row) => this.sync(row.ref!));
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
    const [card] = await tx
      .update(orderCards)
      .set({ version: sql`${orderCards.version} + 1`, panel })
      .where(eq(orderCards.orderId, orderId))
      .returning({ chatId: orderCards.chatId });
    if (!card) return false;
    await this.outbox.enqueueTask(tx, 'order_card', orderId, card.chatId);
    return true;
  }

  /**
   * The delivery of an `order_card` row: make Telegram show the card as the order is now. It
   * holds the card's lease (`syncing_at`) meanwhile and goes round again while a change arrived
   * during the call; a delivery that finds the lease taken is retried by the queue. A lease left
   * by a crash expires after `outbox.requeueAfterSeconds`, like the outbox's own claim.
   */
  async sync(orderId: number): Promise<void> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const [claimed] = await this.db
      .update(orderCards)
      .set({ syncingAt: now })
      .where(
        and(
          eq(orderCards.orderId, orderId),
          or(
            isNull(orderCards.syncingAt),
            lt(orderCards.syncingAt, new Date(now.getTime() - window * 1000)),
          ),
        ),
      )
      .returning();
    if (!claimed) {
      const [exists] = await this.db
        .select({ id: orderCards.orderId })
        .from(orderCards)
        .where(eq(orderCards.orderId, orderId));
      if (!exists) return;
      throw new CardBusyError(orderId);
    }
    try {
      let card: OrderCardRow = claimed;
      for (;;) {
        await this.showOnce(card);
        const [released] = await this.db
          .update(orderCards)
          .set({ syncingAt: null })
          .where(and(eq(orderCards.orderId, orderId), eq(orderCards.version, card.version)))
          .returning();
        if (released) return;
        [card] = (await this.db
          .select()
          .from(orderCards)
          .where(eq(orderCards.orderId, orderId))) as [OrderCardRow];
      }
    } catch (e) {
      await this.db
        .update(orderCards)
        .set({ syncingAt: null })
        .where(eq(orderCards.orderId, orderId));
      throw e;
    }
  }

  /** One pass: post or edit the card as it renders now, then the receipt once. */
  private async showOnce(card: OrderCardRow): Promise<void> {
    const view = renderCard(await this.data(card), GROUP_LANGUAGE);
    const hash = hashOf(view);
    let { messageId, chatId, threadId, receiptPostedAt } = card;
    if (messageId !== null && hash !== card.shownHash) {
      try {
        await this.edges.telegram.edit({
          chatId,
          messageId,
          text: view.text,
          options: {
            ...CARD_FORMAT,
            reply_markup: { inline_keyboard: view.keyboard ?? [] },
          },
        });
      } catch (e) {
        if (!(e instanceof MessageGoneError)) throw e;
        // deleted by someone, or the group moved: post it again where the group is now
        this.log.warn(`order card ${card.orderId}: the message is gone, posting it again`);
        chatId = (await this.settings.get('bot.groupChatId')) ?? chatId;
        threadId = (await this.settings.get('bot.topics')).orders;
        messageId = null;
        receiptPostedAt = null;
      }
      if (messageId !== null)
        await this.db
          .update(orderCards)
          .set({ shownHash: hash })
          .where(eq(orderCards.orderId, card.orderId));
    }
    if (messageId === null) {
      const sent = await this.edges.telegram.send({
        chatId,
        threadId,
        text: view.text,
        options: {
          ...CARD_FORMAT,
          ...(view.keyboard ? { reply_markup: { inline_keyboard: view.keyboard } } : {}),
        },
      });
      messageId = sent.messageId;
      await this.db
        .update(orderCards)
        .set({ chatId, threadId, messageId, shownHash: hash, receiptPostedAt })
        .where(eq(orderCards.orderId, card.orderId));
    }
    if (card.receiptId !== null && receiptPostedAt === null) {
      await this.postReceipt({ ...card, chatId, threadId }, messageId);
    }
  }

  /** The receipt's normalised image from private storage (ADR 0020), as a reply to the card. */
  private async postReceipt(card: OrderCardRow, cardMessageId: number): Promise<void> {
    const [row] = await this.db
      .select({ key: receipts.normalizedKey, number: orders.number })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, card.receiptId!));
    const bytes = row ? await this.edges.files.get(row.key) : null;
    if (row && bytes) {
      await this.edges.telegram.send({
        chatId: card.chatId,
        threadId: card.threadId,
        text: fill(dictionaries[GROUP_LANGUAGE].bot.group.receiptCaption, {
          number: String(row.number),
        }),
        photo: { bytes },
        options: {
          reply_parameters: { message_id: cardMessageId, allow_sending_without_reply: true },
        },
      });
    } else {
      this.log.warn(`order card ${card.orderId}: receipt ${card.receiptId} is gone from storage`);
    }
    await this.db
      .update(orderCards)
      .set({ receiptPostedAt: this.edges.clock.now() })
      .where(eq(orderCards.orderId, card.orderId));
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
    };
  }
}

function hashOf(view: CardView): string {
  return createHash('sha256')
    .update(view.text)
    .update('\0')
    .update(JSON.stringify(view.keyboard))
    .digest('hex');
}
