import {
  and,
  asc,
  credits,
  customers,
  desc,
  eq,
  isNull,
  manualReviewPosts,
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
import { OrderStatusService, type MadeMove } from '../order-status/order-status.service';
import { OutboxService } from '../outbox/outbox.service';
import { creditsFor } from '../payment/rules';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import type { CardEvent } from './card-view';
import { renderManualReview, type ManualReviewData } from './manual-review-view';
import { PostSync } from './post-sync';

/** Staff read the group in Russian, like the order card and the owner alerts. */
const GROUP_LANGUAGE = 'ru';
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

  private readonly posts: PostSync<ManualReviewPostRow>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrderStatusService) status: OrderStatusService,
  ) {
    this.posts = new PostSync<ManualReviewPostRow>(db, edges, outbox, settings, {
      table: manualReviewPosts,
      key: manualReviewPosts.receiptId,
      kind: 'manual_review_post',
      name: 'manual-review post',
      render: async (post) => renderManualReview(await this.data(post), GROUP_LANGUAGE),
      receipt: (post) => this.receipt(post),
    });
    status.afterMove((tx, move) => this.onMove(tx, move));
    outbox.handle('manual_review_post', (task) => this.sync(task.ref));
  }

  /** The delivery of a `manual_review_post` row: the post as it is now (ADR 0034, `PostSync`). */
  sync(receiptId: number): Promise<void> {
    return this.posts.sync(receiptId);
  }

  /** The held receipt, captioned «Чек к заказу № N». */
  private async receipt(post: ManualReviewPostRow) {
    const [row] = await this.db
      .select({ key: receipts.normalizedKey, number: orders.number })
      .from(receipts)
      .innerJoin(orders, eq(orders.id, receipts.orderId))
      .where(eq(receipts.id, post.receiptId));
    return {
      bytes: row ? await this.edges.files.get(row.key) : null,
      caption: fill(dictionaries[GROUP_LANGUAGE].bot.group.receiptCaption, {
        number: String(row?.number ?? ''),
      }),
    };
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
