import { createHash } from 'node:crypto';
import {
  and,
  eq,
  isNull,
  lt,
  or,
  sql,
  type Db,
  type manualReviewPosts,
  type orderCards,
  type OutboxKind,
} from '@lummi/db';
import { Logger } from '@nestjs/common';
import type { AnyColumn } from 'drizzle-orm';
import type { Edges } from '../edges';
import { MessageGoneError } from '../edges';
import type { OutboxService } from '../outbox/outbox.service';
import type { SettingsService } from '../settings/settings.service';
import type { CardView } from './card-view';

/** HTML, and no preview for a link someone typed into a comment. */
const POST_FORMAT = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

/** The columns every synced post's row has, whichever table holds it. */
export interface SyncedRow {
  chatId: number;
  threadId: number | null;
  messageId: number | null;
  receiptPostedAt: Date | null;
  version: number;
  shownHash: string | null;
  syncingAt: Date | null;
}

/** The tables of posts kept in step with Telegram this way. */
type SyncedTable = typeof orderCards | typeof manualReviewPosts;

/** What a kind of post tells the syncer: where its rows are and what it shows. */
export interface PostSource<Row extends SyncedRow> {
  table: SyncedTable;
  /** The row's key column (the order of a card, the receipt of a manual-review post). */
  key: AnyColumn;
  /** The outbox kind whose delivery calls `sync`. */
  kind: Exclude<OutboxKind, 'message'>;
  /** For the log: «order card 12», «manual-review post 34». */
  name: string;
  /** The text and keyboard as the post reads now. */
  render(row: Row): Promise<CardView>;
  /**
   * The receipt to send once as a reply to the post: its image (null when it is gone from
   * storage) and caption; null when the post has none (a payment confirmed without a receipt).
   */
  receipt(row: Row): Promise<{ bytes: Uint8Array | null; caption: string } | null>;
}

/**
 * A post in the orders group kept in step with its row (ADR 0034): the order's card (#37) and a
 * receipt's manual-review post (#51) both go through here. Every change bumps the row's version
 * and queues an outbox row of the post's kind; its delivery calls `sync`, which renders the post
 * from the database as it is then and posts it, or edits it only when it reads differently, then
 * sends the receipt once as a reply.
 *
 * It holds the row's lease (`syncing_at` = this delivery's claim) meanwhile and goes round again
 * while a change arrived during the call; a delivery that finds the lease taken is retried by the
 * queue. A lease left by a crash or a hung call expires after `outbox.requeueAfterSeconds`, like
 * the outbox's own claim. Every write after a Telegram call is a compare-and-set on the claim, so a
 * delivery that outlived its lease never records its render as shown, never frees the next
 * holder's lease, and, since its call may have landed last, asks for another pass. A message
 * someone deleted (or a group that became a supergroup) is posted again in the current group's
 * «Заказы» topic, with its receipt. `orders-group.int.test.ts` tests the lease, the late render
 * and the gone message through the card; the manual-review post runs the same code.
 */
export class PostSync<Row extends SyncedRow> {
  private readonly log = new Logger('PostSync');
  /** The table with the shared columns' names (both tables have them; only the key differs). */
  private readonly t: typeof orderCards;

  constructor(
    private readonly db: Db,
    private readonly edges: Edges,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly source: PostSource<Row>,
  ) {
    this.t = source.table as typeof orderCards;
  }

  private label(key: number): string {
    return `${this.source.name} ${key}`;
  }

  private ofKey(key: number) {
    return eq(this.source.key, key);
  }

  async sync(key: number): Promise<void> {
    const t = this.t;
    const claim = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const [claimed] = await this.db
      .update(t)
      .set({ syncingAt: claim })
      .where(
        and(
          this.ofKey(key),
          or(isNull(t.syncingAt), lt(t.syncingAt, new Date(claim.getTime() - window * 1000))),
        ),
      )
      .returning();
    if (!claimed) {
      // Another delivery holds the lease. This one is done: its change committed (version bumped)
      // before it was queued, and every holder is a delivery of this method, which releases the
      // lease only if the version is still the one it drew, else goes round again. So the holder
      // draws what this delivery was asked to. A holder that crashes or throws leaves its own
      // outbox row unsent, which is retried (a throw) or requeued after the lease window (a crash).
      return;
    }
    const mine = and(this.ofKey(key), eq(t.syncingAt, claim));
    try {
      let row = claimed as unknown as Row;
      for (;;) {
        if ((await this.showOnce(key, row, claim)) === 'lost') return;
        const [released] = await this.db
          .update(t)
          .set({ syncingAt: null })
          .where(and(mine, eq(t.version, row.version)))
          .returning();
        if (released) return;
        const [current] = await this.db.select().from(t).where(mine);
        if (!current) return; // the lease went to another delivery, which shows what is newer
        row = current as unknown as Row;
      }
    } catch (e) {
      // only our own lease: a newer delivery may hold it by now
      await this.db.update(t).set({ syncingAt: null }).where(mine);
      throw e;
    }
  }

  /** One pass: post or edit as it renders now, then the receipt once; `lost` without the lease. */
  private async showOnce(key: number, row: Row, claim: Date): Promise<'shown' | 'lost'> {
    const t = this.t;
    const view = await this.source.render(row);
    const hash = hashOf(view);
    const own = and(this.ofKey(key), eq(t.syncingAt, claim));
    let { messageId, chatId, threadId, receiptPostedAt } = row;
    if (messageId !== null && hash !== row.shownHash) {
      try {
        await this.edges.telegram.edit({
          chatId,
          messageId,
          text: view.text,
          options: { ...POST_FORMAT, reply_markup: { inline_keyboard: view.keyboard ?? [] } },
        });
      } catch (e) {
        if (!(e instanceof MessageGoneError)) throw e;
        // deleted by someone, or the group moved: post it again where the group is now
        this.log.warn(`${this.label(key)}: the message is gone, posting it again`);
        chatId = (await this.settings.get('bot.groupChatId')) ?? chatId;
        threadId = (await this.settings.get('bot.topics')).orders;
        messageId = null;
        receiptPostedAt = null;
      }
      if (messageId !== null) {
        // recorded only over what this pass read: a late delivery that marked the post unshown
        // meanwhile (its old render may have landed after this edit) gets another pass
        const [recorded] = await this.db
          .update(t)
          .set({ shownHash: hash })
          .where(
            and(own, row.shownHash === null ? isNull(t.shownHash) : eq(t.shownHash, row.shownHash)),
          )
          .returning({ v: t.version });
        if (!recorded && !(await this.holds(key, claim))) return this.lostAfterCall(key, claim);
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
        .update(t)
        .set({ chatId, threadId, messageId, receiptPostedAt, shownHash: hash })
        .where(own)
        .returning({ v: t.version });
      if (!recorded) {
        this.log.warn(`${this.label(key)}: posted after its lease expired; a copy may stay`);
        return 'lost';
      }
    }
    if (receiptPostedAt === null) {
      const posted = await this.postReceipt(key, { ...row, chatId, threadId }, messageId, claim);
      if (posted === 'lost') return 'lost';
    }
    return 'shown';
  }

  /** Whether this delivery still holds the lease. */
  private async holds(key: number, claim: Date): Promise<boolean> {
    const t = this.t;
    const [row] = await this.db
      .select({ v: t.version })
      .from(t)
      .where(and(this.ofKey(key), eq(t.syncingAt, claim)));
    return row !== undefined;
  }

  /**
   * This delivery's edit landed after its lease expired, maybe after a newer one: what Telegram
   * shows is unknown, so the post is marked unshown (a value no render hashes to, which also stops
   * the current holder recording its own render over it) and drawn again; the version bump keeps
   * that holder going round, and a fresh delivery comes for the case it already let go.
   */
  private async lostAfterCall(key: number, claim: Date): Promise<'lost'> {
    const t = this.t;
    await this.outbox.withTx(async (tx) => {
      const [row] = await tx
        .update(t)
        .set({ version: sql`${t.version} + 1`, shownHash: `unshown:${claim.toISOString()}` })
        .where(this.ofKey(key))
        .returning({ chatId: t.chatId });
      if (row) await this.outbox.enqueueTask(tx, this.source.kind, key, row.chatId);
    });
    return 'lost';
  }

  /** The receipt's normalised image from private storage (ADR 0020), as a reply to the post. */
  private async postReceipt(
    key: number,
    row: Row,
    postMessageId: number,
    claim: Date,
  ): Promise<'posted' | 'none' | 'lost'> {
    const receipt = await this.source.receipt(row);
    if (!receipt) return 'none';
    if (receipt.bytes) {
      await this.edges.telegram.send({
        chatId: row.chatId,
        threadId: row.threadId,
        text: receipt.caption,
        photo: { bytes: receipt.bytes },
        options: {
          reply_parameters: { message_id: postMessageId, allow_sending_without_reply: true },
        },
      });
    } else {
      this.log.warn(`${this.label(key)}: its receipt is gone from storage`);
    }
    const t = this.t;
    const [recorded] = await this.db
      .update(t)
      .set({ receiptPostedAt: this.edges.clock.now() })
      .where(and(this.ofKey(key), eq(t.syncingAt, claim)))
      .returning({ v: t.version });
    return recorded ? 'posted' : 'lost';
  }
}

function hashOf(view: CardView): string {
  return createHash('sha256')
    .update(view.text)
    .update('\0')
    .update(JSON.stringify(view.keyboard))
    .digest('hex');
}
