import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  customers,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  orders,
  reviewPhotos,
  reviews,
  sql,
  type CustomerRow,
  type Db,
  type DbOrTx,
  type ReviewRow,
} from '@lummi/db';
import { fill } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import {
  pickIncomingFile,
  type AfterCommit,
  type IncomingReceipt,
} from '../bot/bot-receipts.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { describeError } from '../logging/describe-error';
import { DISPATCH_TIMEOUT_MS, OutboxService } from '../outbox/outbox.service';
import { receiptKind } from '../receipts/receipt-file';
import { ReceiptsService } from '../receipts/receipts.service';
import { readSettings, SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { withTimeout } from '../util/with-timeout';
import { WorkerRuntime, type SweepContext } from '../worker/runtime';

/** The namespace of this feature's callback data; other features use their own. */
export const REVIEW_CALLBACK = /^rev:/;
/** Ids are bounded like the orders group's (`ord:` in #37): a longer one never reaches the database. */
const RATE = /^rev:r:(\d{1,16}):([1-5])$/;
const SKIP = /^rev:s:(\d{1,16})$/;
const DONE = /^rev:d:(\d{1,16})$/;
/** A card whose queue entry is older than this and still not posted is queued again by the sweep. */
const CARD_REQUEUE_MS = 10 * 60 * 1000;

const JOB = 'bot.review-photo';
/** Tries to fetch and store a photo before the shopper is asked to send it again. */
const ATTEMPTS = 3;
/** Review photos fetched at once: each is a download and a re-encode. */
const CONCURRENCY = 2;
/** A job a minute old is not "just committed": the sweep queues its row again (jobId dedups). */
const SWEEP_AFTER_MS = 60 * 1000;
/** The most orders one tick asks, and the most unfinished reviews it closes; the next tick takes the rest. */
const BATCH = 200;
/** Declared types a photo may have, before the first bytes decide. */
const IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);
/** Where review photos live in `FileStore`: private; the public URL goes through the API. */
export const REVIEW_PHOTO_PREFIX = 'private/reviews/';
/** The longest side of a stored photo, px. A technical bound (storage and bandwidth), not a shop rule. */
const PHOTO_MAX_SIDE = 1600;
const PHOTO_MAX_PIXELS = 100_000_000;

/** Whether a rating is low enough to go to «Отзывы»: the one place that reads `reviews.lowRatingMax`. */
export function isLowRating(rating: number, settings: { 'reviews.lowRatingMax': number }): boolean {
  return rating <= settings['reviews.lowRatingMax'];
}

type BotTexts = (typeof dictionaries)['ru']['bot'];

/**
 * The review conversation in the bot (#41, spec Changes 2026-11-11).
 *
 * - **The request** (sweep, ADR 0021): once per order, `reviews.requestDelayHours` after
 *   «Доставлен», 1-5 buttons. `orders.review_requested_at` is stamped in the transaction that
 *   queues the message; a customer who blocked the bot is skipped and the order marked
 *   `not_delivered`.
 * - **The answers**: `rev:` callbacks and the customer's next messages. The rating creates the
 *   review (private); the comment and photos are optional steps. A photo is written in the
 *   update's transaction with its `file_id` and fetched by a BullMQ job with retries, like a bot
 *   receipt (#31): checked by its first bytes and the receipt size cap, re-encoded to a JPEG with
 *   no metadata, stored through `FileStore`. Replies go through the outbox.
 * - **Release**: when the step is done (the customer is, or the idle sweep closes it) and no photo
 *   is still being fetched, the review is claimed once (`post_queued_at`); a low rating is posted
 *   to «Отзывы» by an outbox task (`ReviewsService.post`).
 */
@Injectable()
export class ReviewsBot implements OnApplicationShutdown {
  private readonly log = new Logger('ReviewsBot');
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({ name: 'review-request', run: (ctx) => this.request(ctx) });
    runtime.register({ name: 'review-finish', run: (ctx) => this.finishStale(ctx) });
    runtime.register({
      name: 'review-photos',
      run: async ({ now, db }) => {
        // rows a crash left without a queue entry
        const stuck = await db
          .select({ id: reviewPhotos.id })
          .from(reviewPhotos)
          .where(
            and(
              isNull(reviewPhotos.fileKey),
              lt(reviewPhotos.createdAt, new Date(now.getTime() - SWEEP_AFTER_MS)),
            ),
          );
        await this.enqueue(stuck.map((r) => r.id));
      },
    });
    runtime.registerQueue({
      queue: env.REVIEW_PHOTOS_QUEUE,
      concurrency: CONCURRENCY,
      process: (job: Job<{ id: number }>) =>
        this.fetchPhoto(job.data.id, {
          lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        }),
    });
  }

  // ---- The request

  /** Orders delivered at least the delay ago and not yet asked: ask them, once. */
  async request({ now, withTx, outbox }: SweepContext): Promise<void> {
    await withTx(async (tx) => {
      const cfg = await readSettings(tx, ['reviews.requestDelayHours']);
      const since = new Date(now.getTime() - cfg['reviews.requestDelayHours'] * 3600_000);
      const due = await tx
        .select({
          id: orders.id,
          number: orders.number,
          telegramId: customers.telegramId,
          language: customers.language,
          blocked: customers.botBlocked,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(
          and(
            eq(orders.status, 'delivered'),
            isNull(orders.reviewRequestedAt),
            sql`exists (select 1 from order_events e where e.order_id = ${orders.id} and e.to_status = 'delivered' and e.created_at <= ${since})`,
          ),
        )
        .orderBy(asc(orders.id))
        .limit(BATCH);
      if (due.length === 0) return;
      // one statement per outcome claims the orders, so a concurrent tick cannot take them too
      const claim = (ids: number[], outcome: 'sent' | 'not_delivered') =>
        tx
          .update(orders)
          .set({ reviewRequestedAt: now, reviewRequest: outcome })
          .where(
            and(
              inArray(orders.id, ids),
              eq(orders.status, 'delivered'),
              isNull(orders.reviewRequestedAt),
            ),
          )
          .returning({ id: orders.id });
      const blocked = due.filter((d) => d.blocked);
      if (blocked.length > 0)
        await claim(
          blocked.map((d) => d.id),
          'not_delivered',
        );
      const askable = due.filter((d) => !d.blocked);
      if (askable.length === 0) return;
      const claimed = new Set(
        (
          await claim(
            askable.map((d) => d.id),
            'sent',
          )
        ).map((r) => r.id),
      );
      await outbox.enqueue(
        tx,
        askable
          .filter((d) => claimed.has(d.id))
          .map((d) => {
            const t = dictionaries[d.language].bot;
            return {
              chatId: d.telegramId,
              text: fill(t.reviewRequest, { number: String(d.number) }),
              options: {
                reply_markup: {
                  inline_keyboard: [
                    [1, 2, 3, 4, 5].map((n) => ({
                      text: String(n),
                      callback_data: `rev:r:${d.id}:${n}`,
                    })),
                  ],
                },
              },
            };
          }),
      );
    });
  }

  // ---- The conversation

  /** A `rev:` button was tapped (`REVIEW_CALLBACK`). */
  async onTap(tx: DbOrTx, telegramId: number, data: string): Promise<AfterCommit | null> {
    const customer = await this.customer(tx, telegramId);
    if (!customer) return null;
    const rate = RATE.exec(data);
    if (rate) return this.rate(tx, customer, Number(rate[1]), Number(rate[2]));
    const skip = SKIP.exec(data);
    if (skip) {
      const review = await this.open(tx, customer, Number(skip[1]));
      if (review?.step === 'comment') await this.toPhotos(tx, customer, review);
      return null;
    }
    const done = DONE.exec(data);
    if (done) {
      const review = await this.open(tx, customer, Number(done[1]));
      if (review) await this.finish(tx, customer, review);
    }
    return null;
  }

  /** The rating: creates the review, once per order, only for an order this customer was asked about. */
  private async rate(
    tx: DbOrTx,
    customer: CustomerRow,
    orderId: number,
    rating: number,
  ): Promise<null> {
    const t = dictionaries[customer.language].bot;
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.customerId, customer.id),
          eq(orders.reviewRequest, 'sent'),
        ),
      );
    if (!order) return null;
    const [review] = await tx
      .insert(reviews)
      .values({
        orderId,
        customerId: customer.id,
        rating,
        createdAt: this.edges.clock.now(),
        stepAt: this.edges.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (!review) return this.say(tx, customer, t.reviewAlready);
    // a low rating reaches the managers at once; the comment and photos follow as a reply
    await this.queueCard(tx, review.id);
    return this.say(tx, customer, fill(t.reviewAskComment, { rating: String(rating) }), {
      reply_markup: {
        inline_keyboard: [[{ text: t.reviewSkip, callback_data: `rev:s:${review.id}` }]],
      },
    });
  }

  /** The customer's next text while a review waits for its comment. False: it is not a comment. */
  async onText(tx: DbOrTx, telegramId: number, text: string): Promise<boolean> {
    const customer = await this.customer(tx, telegramId);
    if (!customer) return false;
    const [review] = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.customerId, customer.id), eq(reviews.step, 'comment')))
      .orderBy(desc(reviews.stepAt), desc(reviews.id))
      .limit(1);
    const comment = text.trim();
    if (!review || comment === '' || comment.startsWith('/')) return false;
    const t = dictionaries[customer.language].bot;
    const { 'reviews.commentMaxLength': max } = await readSettings(tx, [
      'reviews.commentMaxLength',
    ]);
    if (comment.length > max) {
      await this.say(tx, customer, fill(t.reviewCommentTooLong, { max: String(max) }));
      return true;
    }
    await tx.update(reviews).set({ comment }).where(eq(reviews.id, review.id));
    await this.toPhotos(tx, customer, { ...review, comment });
    return true;
  }

  /**
   * A photo or document while a review waits for photos. `null`: none does, so it is not ours (the
   * receipt intake takes it). Otherwise the row is written here and a job fetches the file.
   */
  async onFile(
    tx: DbOrTx,
    telegramId: number,
    file: IncomingReceipt,
  ): Promise<{ after: AfterCommit | null } | null> {
    const customer = await this.customer(tx, telegramId);
    if (!customer) return null;
    // the review row is locked while the photos are counted, so an album's updates arriving
    // together cannot all see room for one more
    const [review] = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.customerId, customer.id), eq(reviews.step, 'photos')))
      .orderBy(desc(reviews.stepAt), desc(reviews.id))
      .limit(1)
      .for('update');
    if (!review) return null;
    const t = dictionaries[customer.language].bot;
    // read on the update's own connection: a pool shared with a lock waiter must not be asked for another
    const maxBytes =
      (await readSettings(tx, ['receipts.maxUploadMb']))['receipts.maxUploadMb'] * 1024 * 1024;
    const picked = pickIncomingFile(file, maxBytes, IMAGE_MIMES);
    // not an image (a PDF, another type): not ours, the receipt intake answers it
    if (picked === 'unsupported') return null;
    if (picked === 'too_large') {
      await this.say(tx, customer, this.tooLarge(customer, maxBytes));
      return { after: null };
    }
    const { 'reviews.maxPhotos': max } = await readSettings(tx, ['reviews.maxPhotos']);
    const [{ taken } = { taken: 0 }] = await tx
      .select({ taken: sql<number>`count(*)`.mapWith(Number) })
      .from(reviewPhotos)
      .where(eq(reviewPhotos.reviewId, review.id));
    if (taken >= max) {
      // the limit is said once, however many more arrive
      const [first] = await tx
        .update(reviews)
        .set({ photoLimitNoticeAt: this.edges.clock.now() })
        .where(and(eq(reviews.id, review.id), isNull(reviews.photoLimitNoticeAt)))
        .returning({ id: reviews.id });
      if (first) await this.say(tx, customer, fill(t.reviewPhotosFull, { max: String(max) }));
      return { after: null };
    }
    const [row] = await tx
      .insert(reviewPhotos)
      .values({ reviewId: review.id, fileId: picked.fileId, createdAt: this.edges.clock.now() })
      .returning({ id: reviewPhotos.id });
    await tx
      .update(reviews)
      .set({ stepAt: this.edges.clock.now() })
      .where(eq(reviews.id, review.id));
    return { after: () => this.enqueue([row!.id]) };
  }

  private async toPhotos(tx: DbOrTx, customer: CustomerRow, review: ReviewRow): Promise<void> {
    const { 'reviews.maxPhotos': max } = await readSettings(tx, ['reviews.maxPhotos']);
    if (max === 0) return this.finish(tx, customer, review);
    const t = dictionaries[customer.language].bot;
    await tx
      .update(reviews)
      .set({ step: 'photos', stepAt: this.edges.clock.now() })
      .where(eq(reviews.id, review.id));
    await this.say(
      tx,
      customer,
      fill(t.reviewAskPhotos, { max: String(max) }),
      this.doneButton(t, review.id),
    );
  }

  /** The customer is done (or the photos are full): thanks, once, and the review is released. */
  private async finish(tx: DbOrTx, customer: CustomerRow, review: ReviewRow): Promise<void> {
    const [closed] = await tx
      .update(reviews)
      .set({ step: 'done', stepAt: this.edges.clock.now() })
      .where(and(eq(reviews.id, review.id), sql`${reviews.step} <> 'done'`))
      .returning();
    if (!closed) return;
    const t = dictionaries[customer.language].bot;
    const low = isLowRating(closed.rating, await readSettings(tx, ['reviews.lowRatingMax']));
    await this.say(tx, customer, low ? t.reviewThanksLow : t.reviewThanks);
    await this.release(tx, closed.id);
  }

  /** Closes the reviews the customer left open for `reviews.idleFinishMinutes`, silently. */
  async finishStale({ now, withTx }: SweepContext): Promise<void> {
    await withTx(async (tx) => {
      const { 'reviews.idleFinishMinutes': idle } = await readSettings(tx, [
        'reviews.idleFinishMinutes',
      ]);
      const stale = await tx
        .update(reviews)
        .set({ step: 'done', stepAt: now })
        .where(
          and(
            sql`${reviews.step} <> 'done'`,
            lte(reviews.stepAt, new Date(now.getTime() - idle * 60_000)),
          ),
        )
        .returning({ id: reviews.id });
      // also the done ones a missing group (or a photo then still coming) left unreleased
      const waiting = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.step, 'done'), isNull(reviews.postQueuedAt)))
        .orderBy(asc(reviews.id))
        .limit(BATCH);
      for (const id of new Set([...stale.map((r) => r.id), ...waiting.map((r) => r.id)]))
        await this.release(tx, id);
      // low ratings whose card never went out (no group then, or the queue entry was lost)
      const { 'reviews.lowRatingMax': lowMax } = await readSettings(tx, ['reviews.lowRatingMax']);
      const cards = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(isNull(reviews.topicPostedAt), lte(reviews.rating, lowMax)))
        .orderBy(asc(reviews.id))
        .limit(BATCH);
      for (const { id } of cards) await this.queueCard(tx, id, now);
    });
  }

  /**
   * Claim a finished review once it has no photo in flight. A low rating queues its follow-up (the
   * comment and photos, as a reply to the card) with the claim; with no group set it stays
   * unclaimed, and the sweep tries again.
   */
  async release(tx: DbOrTx, reviewId: number): Promise<void> {
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!review || review.step !== 'done' || review.postQueuedAt) return;
    const [{ fetching } = { fetching: 0 }] = await tx
      .select({ fetching: sql<number>`count(*)`.mapWith(Number) })
      .from(reviewPhotos)
      .where(and(eq(reviewPhotos.reviewId, reviewId), isNull(reviewPhotos.fileKey)));
    if (fetching > 0) return;
    const low = isLowRating(review.rating, await readSettings(tx, ['reviews.lowRatingMax']));
    const group = low ? await this.settings.get('bot.groupChatId', tx) : null;
    if (low && group === null) {
      this.log.warn(`review ${reviewId} is low but no orders group is set: it waits`);
      return;
    }
    const [claimed] = await tx
      .update(reviews)
      .set({ postQueuedAt: this.edges.clock.now() })
      .where(and(eq(reviews.id, reviewId), isNull(reviews.postQueuedAt)))
      .returning({ id: reviews.id });
    if (claimed && group !== null)
      await this.outbox.enqueueTask(tx, 'review_post', reviewId, group);
  }

  /**
   * Queue a low rating's card for «Отзывы», once (`topic_queued_at`; again only when an earlier
   * entry is older than ten minutes and the card is still not out). Nothing without a group.
   */
  private async queueCard(
    tx: DbOrTx,
    reviewId: number,
    now = this.edges.clock.now(),
  ): Promise<void> {
    const settings = await readSettings(tx, ['reviews.lowRatingMax']);
    const group = await this.settings.get('bot.groupChatId', tx);
    if (group === null) return;
    const [claimed] = await tx
      .update(reviews)
      .set({ topicQueuedAt: now })
      .where(
        and(
          eq(reviews.id, reviewId),
          isNull(reviews.topicPostedAt),
          lte(reviews.rating, settings['reviews.lowRatingMax']),
          or(
            isNull(reviews.topicQueuedAt),
            lt(reviews.topicQueuedAt, new Date(now.getTime() - CARD_REQUEUE_MS)),
          ),
        ),
      )
      .returning({ id: reviews.id });
    if (claimed) await this.outbox.enqueueTask(tx, 'review_post', reviewId, group);
  }

  // ---- The photo job

  /**
   * Fetch one photo: download under the size cap, check its first bytes, re-encode it (upright, no
   * metadata, at most 1600 px), store it. A failure throws so BullMQ retries; the last attempt, or
   * a refusal, deletes the row and says why, in the same transaction.
   */
  async fetchPhoto(id: number, opts: { lastAttempt: boolean }): Promise<void> {
    const [row] = await this.db.select().from(reviewPhotos).where(eq(reviewPhotos.id, id));
    if (!row || row.fileKey !== null) return; // already done
    const [review] = await this.db.select().from(reviews).where(eq(reviews.id, row.reviewId));
    if (!review) return;
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, review.customerId));
    if (!customer) return;
    const t = dictionaries[customer.language].bot;
    const drop = (text: string) =>
      this.outbox.withTx(async (tx) => {
        await tx
          .delete(reviewPhotos)
          .where(and(eq(reviewPhotos.id, id), isNull(reviewPhotos.fileKey)));
        await this.say(tx, customer, text);
        await this.release(tx, review.id);
      });
    try {
      const maxBytes = await this.receipts.maxUploadBytes();
      const got = await this.edges.telegramFiles.download(row.fileId, maxBytes);
      if (got.kind === 'too_large') return await drop(this.tooLarge(customer, maxBytes));
      if (got.kind === 'unavailable') {
        if (!opts.lastAttempt) throw new Error('Telegram did not hand over the file');
        this.log.warn(`review photo ${id} (customer ${customer.id}) gave up`);
        return await drop(t.reviewPhotoTryAgain);
      }
      const kind = receiptKind(got.bytes);
      if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') {
        return await drop(t.reviewPhotoUnsupported);
      }
      let stored: Buffer;
      try {
        stored = await sharp(got.bytes, { limitInputPixels: PHOTO_MAX_PIXELS, failOn: 'error' })
          .rotate()
          .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        return await drop(t.reviewPhotoUnsupported);
      }
      const key = `${REVIEW_PHOTO_PREFIX}${review.id}-${randomUUID()}.jpg`;
      await this.edges.files.put(key, stored);
      const kept = await this.outbox.withTx(async (tx) => {
        const [done] = await tx
          .update(reviewPhotos)
          .set({ fileKey: key })
          .where(and(eq(reviewPhotos.id, id), isNull(reviewPhotos.fileKey)))
          .returning({ id: reviewPhotos.id });
        if (!done) return false;
        await this.afterStored(tx, customer, review.id);
        return true;
      });
      if (!kept) await this.edges.files.delete(key);
    } catch (e) {
      if (opts.lastAttempt) {
        this.log.error(`review photo ${id} (customer ${customer.id}) failed: ${describeError(e)}`);
        return await drop(t.reviewPhotoTryAgain);
      }
      throw e;
    }
  }

  /** A photo is in: «Фото n из max» with «Готово», or the review closes when they are full. */
  private async afterStored(tx: DbOrTx, customer: CustomerRow, reviewId: number): Promise<void> {
    const [review] = await tx.select().from(reviews).where(eq(reviews.id, reviewId));
    if (!review) return;
    if (review.step === 'done') return this.release(tx, reviewId);
    const { 'reviews.maxPhotos': max } = await readSettings(tx, ['reviews.maxPhotos']);
    const [{ stored } = { stored: 0 }] = await tx
      .select({ stored: sql<number>`count(*)`.mapWith(Number) })
      .from(reviewPhotos)
      .where(and(eq(reviewPhotos.reviewId, reviewId), sql`${reviewPhotos.fileKey} is not null`));
    if (stored >= max) return this.finish(tx, customer, review);
    const t = dictionaries[customer.language].bot;
    await this.say(
      tx,
      customer,
      fill(t.reviewPhotoTaken, { n: String(stored), max: String(max) }),
      this.doneButton(t, reviewId),
    );
    // another photo may have been the one that finished the wait
    await this.release(tx, reviewId);
  }

  // ---- Plumbing

  /** The customer's review, if it is theirs and not finished. */
  private async open(tx: DbOrTx, customer: CustomerRow, id: number): Promise<ReviewRow | null> {
    const [review] = await tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.id, id),
          eq(reviews.customerId, customer.id),
          sql`${reviews.step} <> 'done'`,
        ),
      );
    return review ?? null;
  }

  private doneButton(t: BotTexts, reviewId: number) {
    return {
      reply_markup: {
        inline_keyboard: [[{ text: t.reviewDone, callback_data: `rev:d:${reviewId}` }]],
      },
    };
  }

  private tooLarge(customer: CustomerRow, maxBytes: number): string {
    return fill(dictionaries[customer.language].bot.reviewPhotoTooLarge, {
      max: String(Math.floor(maxBytes / (1024 * 1024))),
    });
  }

  private async customer(tx: DbOrTx, telegramId: number): Promise<CustomerRow | null> {
    const [c] = await tx.select().from(customers).where(eq(customers.telegramId, telegramId));
    return c ?? null;
  }

  private async say(
    tx: DbOrTx,
    customer: Pick<CustomerRow, 'telegramId'>,
    text: string,
    options: Record<string, unknown> = {},
  ): Promise<null> {
    await this.outbox.enqueue(tx, { chatId: customer.telegramId, text, options });
    return null;
  }

  /** Queue the fetch job of each photo (`jobId` review-photo-<id>); never throws, the sweep is the net. */
  private async enqueue(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await withTimeout(
        this.getQueue().addBulk(
          ids.map((id) => ({
            name: JOB,
            data: { id },
            opts: {
              jobId: `review-photo-${id}`,
              attempts: ATTEMPTS,
              backoff: { type: 'exponential', delay: this.env.RECEIPT_CHECK_BACKOFF_MS },
              removeOnComplete: true,
              removeOnFail: true,
            },
          })),
        ),
        DISPATCH_TIMEOUT_MS,
      );
    } catch (e) {
      this.log.warn(
        `review photos ${ids.join(',')} not queued, the sweep will: ${describeError(e)}`,
      );
    }
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${describeError(e)}`));
      this.queue = new Queue(this.env.REVIEW_PHOTOS_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
