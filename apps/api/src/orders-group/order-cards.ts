import { createHash } from 'node:crypto';
import {
  and,
  asc,
  customers,
  eq,
  inArray,
  isNull,
  lt,
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
 * loses none, and the card always ends as the order is, even when a slow call lands late
 * (ADR 0034).
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
    outbox.handle('order_card', (task) => this.sync(task.ref));
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

  /**
   * The delivery of an `order_card` row: make Telegram show the card as the order is now. It
   * holds the card's lease (`syncing_at` = this delivery's claim) meanwhile and goes round again
   * while a change arrived during the call; a delivery that finds the lease taken is retried by
   * the queue. A lease left by a crash or a hung call expires after `outbox.requeueAfterSeconds`,
   * like the outbox's own claim. Every write after a Telegram call is a compare-and-set on the
   * claim, so a delivery that outlived its lease never records its render as shown, never frees
   * the next holder's lease, and, since its call may have landed last, asks for another pass.
   */
  async sync(orderId: number): Promise<void> {
    const claim = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const [claimed] = await this.db
      .update(orderCards)
      .set({ syncingAt: claim })
      .where(
        and(
          eq(orderCards.orderId, orderId),
          or(
            isNull(orderCards.syncingAt),
            lt(orderCards.syncingAt, new Date(claim.getTime() - window * 1000)),
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
    const mine = eq(orderCards.syncingAt, claim);
    try {
      let card: OrderCardRow = claimed;
      for (;;) {
        if ((await this.showOnce(card, claim)) === 'lost') return;
        const [released] = await this.db
          .update(orderCards)
          .set({ syncingAt: null })
          .where(and(eq(orderCards.orderId, orderId), mine, eq(orderCards.version, card.version)))
          .returning();
        if (released) return;
        const [current] = await this.db
          .select()
          .from(orderCards)
          .where(and(eq(orderCards.orderId, orderId), mine));
        if (!current) return; // the lease went to another delivery, which shows what is newer
        card = current;
      }
    } catch (e) {
      // only our own lease: a newer delivery may hold it by now
      await this.db
        .update(orderCards)
        .set({ syncingAt: null })
        .where(and(eq(orderCards.orderId, orderId), mine));
      throw e;
    }
  }

  /**
   * One pass: post or edit the card as it renders now, then the receipt once. `lost` when the
   * lease went to another delivery meanwhile.
   */
  private async showOnce(card: OrderCardRow, claim: Date): Promise<'shown' | 'lost'> {
    const view = renderCard(await this.data(card), GROUP_LANGUAGE);
    const hash = hashOf(view);
    const own = (version?: number) =>
      and(
        eq(orderCards.orderId, card.orderId),
        eq(orderCards.syncingAt, claim),
        version === undefined ? undefined : eq(orderCards.version, version),
      );
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
      if (messageId !== null) {
        // recorded only for the version it was drawn for: a newer change draws it again
        const [recorded] = await this.db
          .update(orderCards)
          .set({ shownHash: hash })
          .where(own(card.version))
          .returning({ id: orderCards.orderId });
        if (!recorded && !(await this.holds(card.orderId, claim)))
          return this.lostAfterCall(card.orderId);
      }
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
      const [recorded] = await this.db
        .update(orderCards)
        .set({
          chatId,
          threadId,
          messageId,
          receiptPostedAt,
          shownHash: sql`case when ${orderCards.version} = ${card.version} then ${hash} end`,
        })
        .where(own())
        .returning({ id: orderCards.orderId });
      if (!recorded) {
        this.log.warn(
          `order card ${card.orderId}: posted after its lease expired; a copy may stay`,
        );
        return 'lost';
      }
    }
    if (card.receiptId !== null && receiptPostedAt === null) {
      if (!(await this.postReceipt({ ...card, chatId, threadId }, messageId, claim))) return 'lost';
    }
    return 'shown';
  }

  /** Whether this delivery still holds the card's lease. */
  private async holds(orderId: number, claim: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ id: orderCards.orderId })
      .from(orderCards)
      .where(and(eq(orderCards.orderId, orderId), eq(orderCards.syncingAt, claim)));
    return row !== undefined;
  }

  /**
   * This delivery's edit landed after its lease expired, maybe after a newer one: nothing it saw
   * can be trusted as shown, so the card is marked unshown and drawn again by a fresh delivery.
   */
  private async lostAfterCall(orderId: number): Promise<'lost'> {
    await this.outbox.withTx(async (tx) => {
      const [card] = await tx
        .update(orderCards)
        .set({ version: sql`${orderCards.version} + 1`, shownHash: null })
        .where(eq(orderCards.orderId, orderId))
        .returning({ chatId: orderCards.chatId });
      if (card) await this.outbox.enqueueTask(tx, 'order_card', orderId, card.chatId);
    });
    return 'lost';
  }

  /** The receipt's normalised image from private storage (ADR 0020), as a reply to the card. */
  private async postReceipt(
    card: OrderCardRow,
    cardMessageId: number,
    claim: Date,
  ): Promise<boolean> {
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
    const [recorded] = await this.db
      .update(orderCards)
      .set({ receiptPostedAt: this.edges.clock.now() })
      .where(and(eq(orderCards.orderId, card.orderId), eq(orderCards.syncingAt, claim)))
      .returning({ id: orderCards.orderId });
    return recorded !== undefined;
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
