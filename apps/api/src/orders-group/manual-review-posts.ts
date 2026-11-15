import { createHash } from 'node:crypto';
import {
  and,
  asc,
  credits,
  customers,
  desc,
  eq,
  isNull,
  lt,
  manualReviewPosts,
  or,
  orderEvents,
  orders,
  receiptChecks,
  receipts,
  sql,
  staff,
  type Db,
  type DbOrTx,
  type ManualReviewPanel,
  type ManualReviewPostRow,
} from '@lummi/db';
import { fill } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Edges } from '../edges';
import { MessageGoneError } from '../edges';
import { OrderStatusService, type MadeMove } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { creditsFor } from '../payment/rules';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import type { CardEvent, CardView } from './card-view';
import { renderManualReview, type ManualReviewData } from './manual-review-view';

/** Staff read the group in Russian, like the order card and the owner alerts. */
const GROUP_LANGUAGE = 'ru';
const POST_FORMAT = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/** Another delivery is bringing the same post up to date; this one is retried after it. */
export class PostBusyError extends Error {
  constructor(receiptId: number) {
    super(`receipt ${receiptId}: its manual-review post is being updated by another delivery`);
    this.name = 'PostBusyError';
  }
}

/**
 * Manual review in the orders group (#51; TZ §4: «При ручной проверке в группу заказов приходят
 * чек, найденные поступления и причина», TZ §6: «Оплата подтверждена» / «Чек не принят»).
 *
 * The post opens in the transaction that holds the receipt for a person (`PaymentMatching`), one
 * per hold (`manual_review_posts`, keyed by the receipt), in the «Заказы» topic; with no group set
 * there is none. Re-checks that leave it held redraw it (new candidates), staff's keyboard changes
 * redraw it, and the move that takes the order out of «Чек на проверке» (a listener on
 * `transition()`, whoever made it: the AI, staff in the admin or the group, a sweep) marks it
 * decided and redraws it once more, without buttons. Telegram catches up through the outbox the
 * way the order card does (ADR 0034): the delivery renders the post from the database as it is
 * then, under the post's lease, posts or edits it, then sends the receipt once as a reply.
 */
@Injectable()
export class ManualReviewPosts {
  private readonly log = new Logger('ManualReviewPosts');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrderStatusService) status: OrderStatusService,
  ) {
    status.afterMove((tx, move) => this.onMove(tx, move));
    outbox.handle('manual_review_post', (task) => this.sync(task.ref));
  }

  /**
   * The receipt is held for a person: its post, in the caller's transaction. One per hold (the
   * receipt): a post it has already is redrawn as it is now (new candidates, a new reason).
   */
  async open(tx: DbOrTx, receiptId: number): Promise<void> {
    const chatId = await this.settings.get('bot.groupChatId', tx);
    if (chatId === null) {
      this.log.warn(`receipt ${receiptId}: no manual-review post, bot.groupChatId is not set`);
      return;
    }
    const topics = await this.settings.get('bot.topics', tx);
    const [receipt] = await tx
      .select({ orderId: receipts.orderId })
      .from(receipts)
      .where(eq(receipts.id, receiptId));
    if (!receipt) return;
    const [created] = await tx
      .insert(manualReviewPosts)
      .values({ receiptId, orderId: receipt.orderId, chatId, threadId: topics.orders })
      .onConflictDoNothing()
      .returning({ chatId: manualReviewPosts.chatId });
    if (created) await this.outbox.enqueueTask(tx, 'manual_review_post', receiptId, chatId);
    else await this.redraw(tx, receiptId);
  }

  /**
   * Show the post again as it is now (a re-check found new candidates, a press found it stale),
   * under `panel` (the keyboard it has unless given), in the caller's transaction. False when it
   * has none or it is decided already.
   */
  async redraw(tx: DbOrTx, receiptId: number, panel?: ManualReviewPanel): Promise<boolean> {
    const [post] = await tx
      .update(manualReviewPosts)
      .set({ version: sql`${manualReviewPosts.version} + 1`, ...(panel ? { panel } : {}) })
      .where(and(eq(manualReviewPosts.receiptId, receiptId), isNull(manualReviewPosts.decidedAt)))
      .returning({ chatId: manualReviewPosts.chatId });
    if (!post) return false;
    await this.outbox.enqueueTask(tx, 'manual_review_post', receiptId, post.chatId);
    return true;
  }

  /** The post of a receipt, for a press on it. */
  async find(tx: DbOrTx, receiptId: number): Promise<ManualReviewPostRow | undefined> {
    const [post] = await tx
      .select()
      .from(manualReviewPosts)
      .where(eq(manualReviewPosts.receiptId, receiptId));
    return post;
  }

  /**
   * Any move of an order redraws its open posts; the one that takes it out of «Чек на проверке»
   * (confirmed, rejected, payment not found, cancelled) decides them.
   */
  private async onMove(tx: DbOrTx, move: MadeMove): Promise<void> {
    const decided = move.order.status !== 'receipt_review';
    const posts = await tx
      .update(manualReviewPosts)
      .set({
        version: sql`${manualReviewPosts.version} + 1`,
        panel: { kind: 'choices' },
        ...(decided ? { decidedAt: this.edges.clock.now() } : {}),
      })
      .where(and(eq(manualReviewPosts.orderId, move.order.id), isNull(manualReviewPosts.decidedAt)))
      .returning({ receiptId: manualReviewPosts.receiptId, chatId: manualReviewPosts.chatId });
    for (const p of posts)
      await this.outbox.enqueueTask(tx, 'manual_review_post', p.receiptId, p.chatId);
  }

  /** The group became a supergroup: its posts live under the new id (the outbox rows move with the cards). */
  async moveGroup(tx: DbOrTx, from: number, to: number): Promise<void> {
    await tx
      .update(manualReviewPosts)
      .set({ chatId: to })
      .where(eq(manualReviewPosts.chatId, from));
  }

  /**
   * The delivery of a `manual_review_post` row, under the post's lease, as `OrderCards.sync`
   * (ADR 0034): it goes round while a change arrived during the call, a delivery that finds the
   * lease taken is retried by the queue, and every write after a Telegram call is a
   * compare-and-set on the claim.
   */
  async sync(receiptId: number): Promise<void> {
    const claim = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const [claimed] = await this.db
      .update(manualReviewPosts)
      .set({ syncingAt: claim })
      .where(
        and(
          eq(manualReviewPosts.receiptId, receiptId),
          or(
            isNull(manualReviewPosts.syncingAt),
            lt(manualReviewPosts.syncingAt, new Date(claim.getTime() - window * 1000)),
          ),
        ),
      )
      .returning();
    if (!claimed) {
      if (!(await this.find(this.db, receiptId))) return;
      throw new PostBusyError(receiptId);
    }
    const mine = and(
      eq(manualReviewPosts.receiptId, receiptId),
      eq(manualReviewPosts.syncingAt, claim),
    );
    try {
      let post: ManualReviewPostRow = claimed;
      for (;;) {
        if ((await this.showOnce(post, claim)) === 'lost') return;
        const [released] = await this.db
          .update(manualReviewPosts)
          .set({ syncingAt: null })
          .where(and(mine, eq(manualReviewPosts.version, post.version)))
          .returning();
        if (released) return;
        const [current] = await this.db.select().from(manualReviewPosts).where(mine);
        if (!current) return; // the lease went to another delivery, which shows what is newer
        post = current;
      }
    } catch (e) {
      await this.db.update(manualReviewPosts).set({ syncingAt: null }).where(mine);
      throw e;
    }
  }

  /** One pass: post or edit as it renders now, then the receipt once; `lost` without the lease. */
  private async showOnce(post: ManualReviewPostRow, claim: Date): Promise<'shown' | 'lost'> {
    const view = renderManualReview(await this.data(post), GROUP_LANGUAGE);
    const hash = hashOf(view);
    const own = and(
      eq(manualReviewPosts.receiptId, post.receiptId),
      eq(manualReviewPosts.syncingAt, claim),
    );
    let { messageId, chatId, threadId, receiptPostedAt } = post;
    if (messageId !== null && hash !== post.shownHash) {
      try {
        await this.edges.telegram.edit({
          chatId,
          messageId,
          text: view.text,
          options: { ...POST_FORMAT, reply_markup: { inline_keyboard: view.keyboard ?? [] } },
        });
      } catch (e) {
        if (!(e instanceof MessageGoneError)) throw e;
        this.log.warn(
          `manual-review post ${post.receiptId}: the message is gone, posting it again`,
        );
        chatId = (await this.settings.get('bot.groupChatId')) ?? chatId;
        threadId = (await this.settings.get('bot.topics')).orders;
        messageId = null;
        receiptPostedAt = null;
      }
      if (messageId !== null) {
        const [recorded] = await this.db
          .update(manualReviewPosts)
          .set({ shownHash: hash })
          .where(
            and(
              own,
              post.shownHash === null
                ? isNull(manualReviewPosts.shownHash)
                : eq(manualReviewPosts.shownHash, post.shownHash),
            ),
          )
          .returning({ id: manualReviewPosts.receiptId });
        if (!recorded && !(await this.holds(post.receiptId, claim)))
          return this.lostAfterCall(post.receiptId, claim);
      }
    }
    if (messageId === null) {
      const sent = await this.edges.telegram.send({
        chatId,
        threadId,
        text: view.text,
        options: {
          ...POST_FORMAT,
          ...(view.keyboard ? { reply_markup: { inline_keyboard: view.keyboard } } : {}),
        },
      });
      messageId = sent.messageId;
      const [recorded] = await this.db
        .update(manualReviewPosts)
        .set({ chatId, threadId, messageId, receiptPostedAt, shownHash: hash })
        .where(own)
        .returning({ id: manualReviewPosts.receiptId });
      if (!recorded) {
        this.log.warn(
          `manual-review post ${post.receiptId}: posted after its lease expired; a copy may stay`,
        );
        return 'lost';
      }
    }
    if (receiptPostedAt === null) {
      if (!(await this.postReceipt({ ...post, chatId, threadId }, messageId, claim))) return 'lost';
    }
    return 'shown';
  }

  private async holds(receiptId: number, claim: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ id: manualReviewPosts.receiptId })
      .from(manualReviewPosts)
      .where(
        and(eq(manualReviewPosts.receiptId, receiptId), eq(manualReviewPosts.syncingAt, claim)),
      );
    return row !== undefined;
  }

  /** An edit that landed after the lease expired: mark the post unshown and draw it again. */
  private async lostAfterCall(receiptId: number, claim: Date): Promise<'lost'> {
    await this.outbox.withTx(async (tx) => {
      const [post] = await tx
        .update(manualReviewPosts)
        .set({
          version: sql`${manualReviewPosts.version} + 1`,
          shownHash: `unshown:${claim.toISOString()}`,
        })
        .where(eq(manualReviewPosts.receiptId, receiptId))
        .returning({ chatId: manualReviewPosts.chatId });
      if (post) await this.outbox.enqueueTask(tx, 'manual_review_post', receiptId, post.chatId);
    });
    return 'lost';
  }

  /** The receipt's normalised image from private storage (ADR 0020), as a reply to the post. */
  private async postReceipt(
    post: ManualReviewPostRow,
    postMessageId: number,
    claim: Date,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ key: receipts.normalizedKey, number: orders.number })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, post.receiptId));
    const bytes = row ? await this.edges.files.get(row.key) : null;
    if (row && bytes) {
      await this.edges.telegram.send({
        chatId: post.chatId,
        threadId: post.threadId,
        text: fill(dictionaries[GROUP_LANGUAGE].bot.group.receiptCaption, {
          number: String(row.number),
        }),
        photo: { bytes },
        options: {
          reply_parameters: { message_id: postMessageId, allow_sending_without_reply: true },
        },
      });
    } else {
      this.log.warn(`manual-review post ${post.receiptId}: the receipt is gone from storage`);
    }
    const [recorded] = await this.db
      .update(manualReviewPosts)
      .set({ receiptPostedAt: this.edges.clock.now() })
      .where(
        and(
          eq(manualReviewPosts.receiptId, post.receiptId),
          eq(manualReviewPosts.syncingAt, claim),
        ),
      )
      .returning({ id: manualReviewPosts.receiptId });
    return recorded !== undefined;
  }

  /** What the post shows, read now. */
  private async data(post: ManualReviewPostRow): Promise<ManualReviewData> {
    const [row] = await this.db
      .select({ receipt: receipts, order: orders })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, post.receiptId));
    if (!row) throw new Error(`manual-review post ${post.receiptId}: no such receipt`);
    const { receipt, order } = row;
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
    const [lastCheck] = await this.db
      .select({ shown: receiptChecks.candidateCreditIds })
      .from(receiptChecks)
      .where(eq(receiptChecks.receiptId, receipt.id))
      .orderBy(desc(receiptChecks.id))
      .limit(1);
    const creditFields = {
      id: credits.id,
      amountTiyin: credits.amountTiyin,
      occurredAt: credits.occurredAt,
      cardMask: credits.cardMask,
      counterparty: credits.counterparty,
    };
    const candidates = await this.db
      .select(creditFields)
      .from(credits)
      .where(sql`${credits.id} in (${creditsFor(order.id)})`)
      .orderBy(asc(credits.occurredAt), asc(credits.id));
    const decision = await this.decision(order.id, receipt.id);
    const paidId =
      decision?.action === 'confirm_payment' ? (decision.payload.creditId as number) : null;
    const [paidWith] =
      paidId === null
        ? []
        : await this.db.select(creditFields).from(credits).where(eq(credits.id, paidId));
    return {
      order: {
        id: order.id,
        number: order.number,
        amountDue: order.amountDue,
        status: order.status,
      },
      receipt: {
        id: receipt.id,
        createdAt: receipt.createdAt,
        verdict: receipt.verdict,
        reviewReason: receipt.reviewReason,
      },
      lastShown: lastCheck?.shown.length ?? 0,
      customer: customer!,
      candidates,
      decision,
      paidWith: paidWith ?? null,
      panel: post.panel,
    };
  }

  /** The order's first move after this receipt was sent: the one that ended its review. */
  private async decision(orderId: number, receiptId: number): Promise<CardEvent | null> {
    const events = await this.db
      .select({
        id: orderEvents.id,
        action: orderEvents.action,
        at: orderEvents.createdAt,
        actorType: orderEvents.actorType,
        staffName: staff.name,
        reason: orderEvents.reason,
        payload: orderEvents.payload,
      })
      .from(orderEvents)
      .leftJoin(staff, and(eq(orderEvents.actorType, 'staff'), eq(staff.id, orderEvents.actorId)))
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.id));
    const sent = events.findIndex(
      (e) =>
        e.action === 'submit_receipt' &&
        (e.payload as { receiptId?: number }).receiptId === receiptId,
    );
    const next = sent < 0 ? undefined : events[sent + 1];
    return next ? { ...next, payload: next.payload as Record<string, unknown> } : null;
  }
}

function hashOf(view: CardView): string {
  return createHash('sha256')
    .update(view.text)
    .update('\0')
    .update(JSON.stringify(view.keyboard))
    .digest('hex');
}
