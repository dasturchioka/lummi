import {
  cancelReasonsFor,
  TRACKING_NUMBER_MAX,
  TRACKING_NUMBER_MIN,
  transitionPayloadSchemas,
} from '@lummi/contracts';
import {
  and,
  eq,
  isNull,
  orderCardPrompts,
  orderCards,
  orders,
  outbox,
  staff,
  type DbOrTx,
  type OrderCardPanel,
  type StaffRow,
} from '@lummi/db';
import { fill } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { OrderStatusService, type TransitionActor } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { StaffService } from '../staff/staff.service';
import { EDGES } from '../tokens';
import { decodePress, escapeHtml, isStepStatus, NEXT_STEP, type CardPress } from './card-view';
import { OrderCards } from './order-cards';

const g = dictionaries.ru.bot.group;

/** A tap on a card's button, as the bot got it. */
export interface CardTap {
  fromId: number;
  data: string;
}

/** A message in the group that replies to another, as the bot got it. */
export interface GroupReply {
  chatId: number;
  messageId: number;
  fromId: number;
  text: string | undefined;
  /** The message it replies to. */
  replyTo: number;
}

/**
 * The orders group's side of the bot (#37): the buttons under an order's card and the
 * tracking-number answers. Staff only (owner or manager, active); every move goes through
 * `transition()` with the staff member as the actor (ADR 0011), in the update's transaction, so
 * the card, the history, the audit and the shopper's message come with it. A press carries the
 * status its card showed: one on a card that moved on changes nothing and answers «Уже изменено».
 */
@Injectable()
export class OrdersGroupBot {
  constructor(
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(OrderCards) private readonly cards: OrderCards,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  /**
   * Handle a tap; returns the toast to answer it with (undefined: none). A button the bot never
   * drew (forged data, a step that does not exist) answers «Нельзя» and changes nothing.
   */
  async onTap(tx: DbOrTx, tap: CardTap): Promise<string | undefined> {
    const member = await this.activeStaff(tx, tap.fromId);
    if (!member) return g.noAccess;
    const press = decodePress(tap.data);
    if (!press) return g.refused;
    const actor: TransitionActor = { type: 'staff', id: member.id };
    switch (press.verb) {
      case 'next': {
        if (!isStepStatus(press.expected)) return g.refused;
        const action = NEXT_STEP[press.expected];
        if (action === 'hand_to_bts') return this.askTracking(tx, press, member);
        const out = await this.status.transitionIn(
          tx,
          press.orderId,
          action,
          actor,
          press.expected,
          undefined,
        );
        return this.answer(tx, press.orderId, out.kind);
      }
      case 'confirm': {
        const out = await this.status.transitionIn(
          tx,
          press.orderId,
          'cancel',
          actor,
          press.expected,
          { reason: press.reason },
        );
        return this.answer(tx, press.orderId, out.kind);
      }
      case 'cancel':
        return this.panel(tx, press, { kind: 'cancel' });
      case 'reason':
        if (!cancelReasonsFor('staff', press.expected).includes(press.reason)) return g.refused;
        return this.panel(tx, press, { kind: 'confirm_cancel', reason: press.reason });
      case 'back':
        return this.panel(tx, press, { kind: 'steps' });
    }
  }

  /** No toast when the move was made; «Уже изменено» when the order moved on; «Нельзя» otherwise. */
  private async answer(
    tx: DbOrTx,
    orderId: number,
    kind: 'done' | 'conflict' | 'refused' | 'not_found',
  ): Promise<string | undefined> {
    if (kind === 'done') return undefined;
    if (kind === 'conflict') return this.changed(tx, orderId);
    return g.refused;
  }

  /**
   * A reply in the group: if it answers one of the bot's tracking-number questions, the handover
   * (from the person who pressed «Передан в BTS» only); false when it is not about a question.
   */
  async onReply(tx: DbOrTx, m: GroupReply): Promise<boolean> {
    const [prompt] = await tx
      .select({
        orderId: orderCardPrompts.orderId,
        staffId: orderCardPrompts.staffId,
        expectedStatus: orderCardPrompts.expectedStatus,
        closedAt: orderCardPrompts.closedAt,
        threadId: outbox.threadId,
        number: orders.number,
        status: orders.status,
        askedName: staff.name,
      })
      .from(orderCardPrompts)
      .innerJoin(outbox, eq(outbox.id, orderCardPrompts.outboxId))
      .innerJoin(orders, eq(orders.id, orderCardPrompts.orderId))
      .innerJoin(staff, eq(staff.id, orderCardPrompts.staffId))
      .where(and(eq(outbox.chatId, m.chatId), eq(outbox.telegramMessageId, m.replyTo)));
    if (!prompt) return false;
    const say = (text: string, extra: Record<string, unknown> = {}) =>
      this.outbox.enqueue(tx, {
        chatId: m.chatId,
        threadId: prompt.threadId,
        text,
        options: {
          reply_parameters: { message_id: m.messageId, allow_sending_without_reply: true },
          ...extra,
        },
      });
    const number = String(prompt.number);

    const member = await this.activeStaff(tx, m.fromId);
    if (!member) {
      await say(g.noAccess);
      return true;
    }
    if (prompt.closedAt) {
      // answered already, or a newer question replaced it while the order still waits for one
      await say(
        fill(prompt.status === prompt.expectedStatus ? g.trackingSuperseded : g.trackingStale, {
          number,
        }),
      );
      return true;
    }
    if (member.id !== prompt.staffId) {
      await say(fill(g.trackingNotYours, { number, name: prompt.askedName }));
      return true;
    }
    const parsed = transitionPayloadSchemas.hand_to_bts.safeParse({ trackingNumber: m.text ?? '' });
    if (!parsed.success) {
      // ask again, replying to the bad answer: ForceReply's `selective` targets its author
      const [asked] = await say(
        fill(g.trackingInvalid, {
          min: String(TRACKING_NUMBER_MIN),
          max: String(TRACKING_NUMBER_MAX),
        }),
        { reply_markup: forceReply() },
      );
      await this.ask(tx, {
        orderId: prompt.orderId,
        staffId: member.id,
        expectedStatus: prompt.expectedStatus,
        outboxId: asked!,
      });
      return true;
    }
    const out = await this.status.transitionIn(
      tx,
      prompt.orderId,
      'hand_to_bts',
      { type: 'staff', id: member.id },
      prompt.expectedStatus,
      parsed.data,
    );
    await this.closeQuestions(tx, prompt.orderId);
    if (out.kind !== 'done') {
      await this.cards.touch(tx, prompt.orderId);
      await say(fill(g.trackingStale, { number }));
    }
    return true;
  }

  /** «Передан в BTS» needs the tracking number first: ask the presser by ForceReply under the card. */
  private async askTracking(
    tx: DbOrTx,
    press: CardPress,
    member: StaffRow,
  ): Promise<string | undefined> {
    const [card] = await tx
      .select({
        status: orders.status,
        number: orders.number,
        chatId: orderCards.chatId,
        threadId: orderCards.threadId,
        messageId: orderCards.messageId,
      })
      .from(orders)
      .innerJoin(orderCards, eq(orderCards.orderId, orders.id))
      .where(eq(orders.id, press.orderId))
      .for('share', { of: orders });
    if (!card || card.status !== press.expected) return this.changed(tx, press.orderId);
    const mention = `<a href="tg://user?id=${member.telegramId}">${escapeHtml(member.name)}</a>`;
    const [asked] = await this.outbox.enqueue(tx, {
      chatId: card.chatId,
      threadId: card.threadId,
      text: fill(g.askTracking, { name: mention, number: String(card.number) }),
      options: {
        parse_mode: 'HTML',
        reply_markup: forceReply(),
        ...(card.messageId
          ? {
              reply_parameters: { message_id: card.messageId, allow_sending_without_reply: true },
            }
          : {}),
      },
    });
    await this.ask(tx, {
      orderId: press.orderId,
      staffId: member.id,
      expectedStatus: press.expected,
      outboxId: asked!,
    });
    return g.trackingAsked;
  }

  /** Open the cancel reasons, a confirmation, or the steps again, on a card still in `expected`. */
  private async panel(
    tx: DbOrTx,
    press: CardPress,
    panel: OrderCardPanel,
  ): Promise<string | undefined> {
    // the order's lock, shared: a move made meanwhile commits first, and this one sees it
    const [order] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, press.orderId))
      .for('share');
    if (!order || order.status !== press.expected) return this.changed(tx, press.orderId);
    await this.cards.touch(tx, press.orderId, panel);
    return undefined;
  }

  /** A new tracking-number question for the order; any earlier one it still had stops counting. */
  private async ask(tx: DbOrTx, question: typeof orderCardPrompts.$inferInsert): Promise<void> {
    await this.closeQuestions(tx, question.orderId);
    await tx.insert(orderCardPrompts).values(question);
  }

  private async closeQuestions(tx: DbOrTx, orderId: number): Promise<void> {
    await tx
      .update(orderCardPrompts)
      .set({ closedAt: this.edges.clock.now() })
      .where(and(eq(orderCardPrompts.orderId, orderId), isNull(orderCardPrompts.closedAt)));
  }

  /** Staff by Telegram id, only while active (ADR 0017). */
  private async activeStaff(tx: DbOrTx, telegramId: number): Promise<StaffRow | null> {
    const member = await this.staff.findByTelegramId(telegramId, tx);
    return member?.active ? member : null;
  }

  /** The card moved on since it was drawn: say so, and draw it again as it is now. */
  private async changed(tx: DbOrTx, orderId: number): Promise<string> {
    await this.cards.touch(tx, orderId);
    return g.changed;
  }
}

const forceReply = () => ({
  force_reply: true,
  selective: true,
  input_field_placeholder: g.trackingPlaceholder,
});
