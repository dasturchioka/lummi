import { BOT_CHOICE_MAX_SECONDS, RECEIPT_FILE_TYPES } from '@lummi/contracts';
import {
  and,
  asc,
  botPendingReceipts,
  customers,
  eq,
  inArray,
  isNull,
  lt,
  orders,
  sql,
  type CustomerRow,
  type Db,
  type DbOrTx,
  type OrderRow,
} from '@lummi/db';
import { fill, formatMoney, languageFromTelegram } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { describeError } from '../logging/describe-error';
import { ordersUrl } from '../orders/orders.service';
import { DISPATCH_TIMEOUT_MS, OutboxService } from '../outbox/outbox.service';
import { cleanFileName, ReceiptsService } from '../receipts/receipts.service';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { withTimeout } from '../util/with-timeout';
import { WorkerRuntime } from '../worker/runtime';

/** A file the shopper sent: a photo (Telegram's sizes, smallest first) or a document. */
export type IncomingReceipt =
  | { kind: 'photo'; sizes: { fileId: string; size?: number }[] }
  | { kind: 'document'; fileId: string; name?: string; mime?: string; size?: number };

/** Work for after the update's transaction has committed. */
export type AfterCommit = () => Promise<void>;

/** The namespace of this feature's callback data; other features use their own. */
export const RECEIPT_CALLBACK = /^rcpt:/;
const CHOICE_DATA = /^rcpt:(\d+):(\d+)$/;
const JOB = 'bot.receipt';
/** Tries to download and take in a receipt before the shopper is asked to send it again. */
const ATTEMPTS = 3;
/** Bot receipts taken in at once: each is a download and the receipt intake (a PDF render). */
const CONCURRENCY = 2;
/** A job a minute old is not "just committed": the sweep queues its row again (jobId dedups). */
const SWEEP_AFTER_MS = 60 * 1000;
/** Declared types we accept before downloading; the first bytes decide afterwards. */
const DECLARED_MIMES: ReadonlySet<string> = new Set([
  ...Object.values(RECEIPT_FILE_TYPES).map((t) => t.mime),
  'application/octet-stream',
]);
/** Files waiting for a choice are deleted after the longest the setting allows, twice over. */
const PENDING_KEEP_MS = 2 * BOT_CHOICE_MAX_SECONDS * 1000;

/**
 * The file to fetch out of what the shopper sent, or why it cannot be: its declared type or size
 * already refuses it. A photo's largest size still under the cap wins (Telegram lists sizes
 * smallest first). Shared with the review photos (#41); the first bytes decide the real type later.
 */
export function pickIncomingFile(
  file: IncomingReceipt,
  maxBytes: number,
  declaredMimes: ReadonlySet<string>,
): { fileId: string; name?: string } | 'unsupported' | 'too_large' {
  if (file.kind === 'photo') {
    const fits = file.sizes.filter((s) => s.size === undefined || s.size <= maxBytes);
    const best = fits.at(-1);
    return best ? { fileId: best.fileId } : 'too_large';
  }
  if (file.mime && !declaredMimes.has(file.mime.toLowerCase())) return 'unsupported';
  if (file.size !== undefined && file.size > maxBytes) return 'too_large';
  return { fileId: file.fileId, ...(file.name ? { name: file.name } : {}) };
}

type BotTexts = (typeof dictionaries)['ru']['bot'];

/**
 * A receipt sent to the bot (#31): the same intake as an upload from the payment screen. The bot
 * only finds which order it is for (one awaiting payment: that one; several: it asks with buttons;
 * none: a polite reply), then calls `ReceiptsService.submit` with the downloaded bytes, so every
 * check, the status change and the "receipt received" message are the upload's own.
 *
 * At least once, never lost (ADR 0021): the file's `file_id` and its order are written in the
 * update's own transaction (`bot_pending_receipts`). After the commit a BullMQ job
 * (`bot-receipt-<id>`) downloads the file, with retries, and takes it in; the row is deleted only
 * on a final outcome (attached, or refused and answered; the last failed attempt answers «отправьте
 * ещё раз»). A sweep queues the rows a crash left without a queue entry. Replies go through the
 * outbox. The slow download never runs inside the webhook request.
 */
@Injectable()
export class BotReceipts implements OnApplicationShutdown {
  private readonly log = new Logger('BotReceipts');
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({
      name: 'bot-receipts',
      run: async ({ now, db }) => {
        // choices nobody made
        await db
          .delete(botPendingReceipts)
          .where(
            and(
              isNull(botPendingReceipts.orderNumber),
              lt(botPendingReceipts.createdAt, new Date(now.getTime() - PENDING_KEEP_MS)),
            ),
          );
        // rows a crash left without a queue entry
        const stuck = await db
          .select({ id: botPendingReceipts.id })
          .from(botPendingReceipts)
          .where(
            and(
              lt(botPendingReceipts.createdAt, new Date(now.getTime() - SWEEP_AFTER_MS)),
              // in flight: an order was chosen
              sql`${botPendingReceipts.orderNumber} is not null`,
            ),
          );
        await this.enqueue(stuck.map((r) => r.id));
      },
    });
    runtime.registerQueue({
      queue: env.BOT_RECEIPTS_QUEUE,
      concurrency: CONCURRENCY,
      process: (job: Job<{ id: number }>) =>
        this.intake(job.data.id, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) }),
    });
  }

  /**
   * Whether the customer has an order waiting for a receipt or under check: while one does, every
   * file they send is a receipt (ADR 0020, 0033), whatever else the bot is asking them for.
   */
  async hasOrderWaiting(tx: DbOrTx, telegramId: number): Promise<boolean> {
    const customer = await this.customer(tx, telegramId);
    if (!customer) return false;
    const [waiting] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.customerId, customer.id),
          inArray(orders.status, ['awaiting_payment', 'receipt_review']),
        ),
      )
      .limit(1);
    return waiting !== undefined;
  }

  /** A photo or document arrived in a private chat. */
  async onFile(
    tx: DbOrTx,
    telegramId: number,
    languageCode: string | undefined,
    file: IncomingReceipt,
  ): Promise<AfterCommit | null> {
    const customer = await this.customer(tx, telegramId);
    if (!customer) {
      await this.replyUnknown(tx, telegramId, languageCode);
      return null;
    }
    const t = dictionaries[customer.language].bot;
    const maxBytes = await this.receipts.maxUploadBytes();
    const picked = this.pick(file, maxBytes);
    if (picked === 'unsupported') return this.say(tx, customer, t.receiptUnsupported);
    if (picked === 'too_large')
      return this.say(tx, customer, this.tooLargeText(customer, maxBytes));

    const awaiting = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customer.id), eq(orders.status, 'awaiting_payment')))
      .orderBy(asc(orders.number));
    const row = {
      customerId: customer.id,
      fileId: picked.fileId,
      fileName: picked.name ?? null,
      createdAt: this.edges.clock.now(),
    };
    if (awaiting.length === 1) {
      const [intake] = await tx
        .insert(botPendingReceipts)
        .values({ ...row, orderNumber: awaiting[0]!.number })
        .returning({ id: botPendingReceipts.id });
      return () => this.enqueue([intake!.id]);
    }
    if (awaiting.length === 0) {
      const [checking] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.customerId, customer.id), eq(orders.status, 'receipt_review')))
        .orderBy(asc(orders.number))
        .limit(1);
      if (checking) {
        return this.say(tx, customer, this.notAwaiting(t, checking));
      }
      const url = this.env.MINIAPP_URL;
      return this.say(
        tx,
        customer,
        t.receiptNoOrders,
        url
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: t.openOrders, web_app: { url: ordersUrl(url) } }]],
              },
            }
          : {},
      );
    }
    const [pending] = await tx
      .insert(botPendingReceipts)
      .values(row)
      .returning({ id: botPendingReceipts.id });
    return this.say(tx, customer, t.receiptWhichOrder, {
      reply_markup: {
        inline_keyboard: awaiting.map((o) => [
          {
            text: fill(t.receiptOrderChoice, {
              number: String(o.number),
              amount: formatMoney(o.amountDue, customer.language),
            }),
            callback_data: `rcpt:${pending!.id}:${o.number}`,
          },
        ]),
      },
    });
  }

  /** A button under "which order?" was tapped; `data` is its callback data (`RECEIPT_CALLBACK`). */
  async onChoice(tx: DbOrTx, telegramId: number, data: string): Promise<AfterCommit | null> {
    const match = CHOICE_DATA.exec(data);
    if (!match) return null;
    const [pendingId, number] = [Number(match[1]), Number(match[2])];
    const customer = await this.customer(tx, telegramId);
    if (!customer) return null;
    const t = dictionaries[customer.language].bot;
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customer.id), eq(orders.number, number)));
    // the order is checked first, and the pending file is kept: they may choose another order
    if (order && order.status !== 'awaiting_payment') {
      return this.say(tx, customer, this.notAwaiting(t, order));
    }
    // claimed by giving it its order: a second tap, or another customer's button, finds nothing
    const [claimed] = await tx
      .update(botPendingReceipts)
      .set({ orderNumber: number })
      .where(
        and(
          eq(botPendingReceipts.id, pendingId),
          eq(botPendingReceipts.customerId, customer.id),
          isNull(botPendingReceipts.orderNumber),
        ),
      )
      .returning();
    if (!claimed) {
      // a tap on a choice that is already being taken in says nothing more
      const [taken] = await tx
        .select({ id: botPendingReceipts.id })
        .from(botPendingReceipts)
        .where(
          and(eq(botPendingReceipts.id, pendingId), eq(botPendingReceipts.customerId, customer.id)),
        );
      return taken ? null : this.say(tx, customer, t.receiptExpired);
    }
    const windowMs =
      (await readSettings(tx, ['receipts.botChoiceSeconds']))['receipts.botChoiceSeconds'] * 1000;
    if (!order || this.edges.clock.now().getTime() - claimed.createdAt.getTime() > windowMs) {
      await tx.delete(botPendingReceipts).where(eq(botPendingReceipts.id, claimed.id));
      return this.say(tx, customer, t.receiptExpired);
    }
    return () => this.enqueue([claimed.id]);
  }

  /**
   * Queue the intake job of each row (`jobId` bot-receipt-<id>: one live job per row). Never
   * throws: if Redis is down the sweep queues the row a minute later.
   */
  private async enqueue(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await withTimeout(
        this.getQueue().addBulk(
          ids.map((id) => ({
            name: JOB,
            data: { id },
            opts: {
              jobId: `bot-receipt-${id}`,
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
        `bot receipts ${ids.join(',')} not queued, the sweep will: ${describeError(e)}`,
      );
    }
  }

  /**
   * The job: download the file and give it to the one intake. A failure throws, so BullMQ tries
   * again; the last attempt answers «отправьте ещё раз». Every final outcome deletes the row in the
   * same transaction as its reply, so a crash between them repeats the job, never loses the file.
   */
  async intake(id: number, opts: { lastAttempt: boolean }): Promise<void> {
    const [row] = await this.db
      .select()
      .from(botPendingReceipts)
      .where(eq(botPendingReceipts.id, id));
    if (!row || row.orderNumber === null) return; // already done
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, row.customerId));
    if (!customer) {
      await this.db.delete(botPendingReceipts).where(eq(botPendingReceipts.id, id));
      return;
    }
    const t = dictionaries[customer.language].bot;
    const number = row.orderNumber;
    const done = (text: string | null) =>
      this.outbox.withTx(async (tx) => {
        await tx.delete(botPendingReceipts).where(eq(botPendingReceipts.id, id));
        if (text) await this.say(tx, customer, text);
      });
    const retry = async (why: string): Promise<void> => {
      if (!opts.lastAttempt) throw new Error(why);
      this.log.warn(`bot receipt ${id} (customer ${customer.id}) gave up: ${why}`);
      await done(t.receiptTryAgain);
    };
    try {
      const maxBytes = await this.receipts.maxUploadBytes();
      const got = await this.edges.telegramFiles.download(row.fileId, maxBytes);
      if (got.kind === 'too_large') return await done(this.tooLargeText(customer, maxBytes));
      if (got.kind === 'unavailable') return await retry('Telegram did not hand over the file');
      const out = await this.receipts.submit(customer.id, number, got.bytes, {
        fileName: cleanFileName(row.fileName ?? undefined),
        source: 'bot',
      });
      switch (out.kind) {
        case 'submitted':
          // "receipt received" was queued by the status change, as for an upload
          return await done(null);
        case 'not_found':
          return await done(fill(t.orderNotAwaiting, { number: String(number) }));
        case 'status_changed':
          return await done(this.notAwaiting(t, out.order));
        case 'try_again':
          return await retry('the intake is busy');
        case 'refused':
          return await done(
            out.code === 'too_large'
              ? this.tooLargeText(customer, out.maxBytes ?? maxBytes)
              : out.code === 'unsupported_type'
                ? t.receiptUnsupported
                : t.receiptUnreadable,
          );
      }
    } catch (e) {
      this.log.error(`bot receipt ${id} (customer ${customer.id}) failed: ${describeError(e)}`);
      await retry('the intake failed');
    }
  }

  private pick(file: IncomingReceipt, maxBytes: number) {
    return pickIncomingFile(file, maxBytes, DECLARED_MIMES);
  }

  private notAwaiting(t: BotTexts, order: Pick<OrderRow, 'number' | 'status'>): string {
    return fill(order.status === 'receipt_review' ? t.receiptUnderCheck : t.orderNotAwaiting, {
      number: String(order.number),
    });
  }

  private tooLargeText(customer: CustomerRow, maxBytes: number): string {
    return fill(dictionaries[customer.language].bot.receiptTooLarge, {
      max: String(Math.floor(maxBytes / (1024 * 1024))),
    });
  }

  private async customer(tx: DbOrTx, telegramId: number): Promise<CustomerRow | null> {
    const [c] = await tx.select().from(customers).where(eq(customers.telegramId, telegramId));
    return c ?? null;
  }

  /** Queue a reply inside a transaction. Returns null so handlers can `return this.say(...)`. */
  private async say(
    tx: DbOrTx,
    customer: Pick<CustomerRow, 'telegramId'>,
    text: string,
    options: Record<string, unknown> = {},
  ): Promise<null> {
    await this.outbox.enqueue(tx, { chatId: customer.telegramId, text, options });
    return null;
  }

  private async replyUnknown(
    tx: DbOrTx,
    telegramId: number,
    languageCode: string | undefined,
  ): Promise<void> {
    // no record, so no saved language: the Telegram one
    const t = dictionaries[languageFromTelegram(languageCode)].bot;
    const url = this.env.MINIAPP_URL;
    await this.say(
      tx,
      { telegramId },
      t.receiptUnknownUser,
      url ? { reply_markup: { inline_keyboard: [[{ text: t.openShop, web_app: { url } }]] } } : {},
    );
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${describeError(e)}`));
      this.queue = new Queue(this.env.BOT_RECEIPTS_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
