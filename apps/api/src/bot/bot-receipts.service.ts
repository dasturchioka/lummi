import { RECEIPT_FILE_TYPES } from '@lummi/contracts';
import {
  and,
  asc,
  botPendingReceipts,
  customers,
  eq,
  orders,
  type CustomerRow,
  type DbOrTx,
  type OrderRow,
} from '@lummi/db';
import { fill, formatMoney } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { describeError } from '../logging/describe-error';
import { ordersUrl } from '../orders/orders.service';
import { OutboxService } from '../outbox/outbox.service';
import { cleanFileName, ReceiptsService } from '../receipts/receipts.service';
import { readSettings } from '../settings/settings.service';
import { EDGES, ENV } from '../tokens';

/** A file the shopper sent: a photo (Telegram's sizes, smallest first) or a document. */
export type IncomingReceipt =
  | { kind: 'photo'; sizes: { fileId: string; size?: number }[] }
  | { kind: 'document'; fileId: string; name?: string; mime?: string; size?: number };

/** Work for after the update's transaction has committed (the download and the intake). */
export type AfterCommit = () => Promise<void>;

const CHOICE_PREFIX = 'rcpt';
const CHOICE_DATA = new RegExp(`^${CHOICE_PREFIX}:(\\d+):(\\d+)$`);
/** Declared types we accept before downloading; the first bytes decide afterwards. */
const DECLARED_MIMES: ReadonlySet<string> = new Set([
  ...Object.values(RECEIPT_FILE_TYPES).map((t) => t.mime),
  'application/octet-stream',
]);

type BotTexts = (typeof dictionaries)['ru']['bot'];

/**
 * A receipt sent to the bot (#31): the same intake as an upload from the payment screen. The bot
 * only finds which order it is for (one awaiting payment: that one; several: it asks with buttons;
 * none: a polite reply), downloads the file through the `TelegramFiles` edge and calls
 * `ReceiptsService.submit`, so every check, the status change and the "receipt received" message
 * are the upload's own. Replies go through the outbox; the download and the intake run after the
 * update's transaction commits, so a redelivered update (dedup) never submits twice.
 */
@Injectable()
export class BotReceipts {
  private readonly log = new Logger('BotReceipts');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
  ) {}

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
    if (picked === 'too_large') return this.tooLarge(tx, customer, maxBytes);

    const awaiting = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customer.id), eq(orders.status, 'awaiting_payment')))
      .orderBy(asc(orders.number));
    if (awaiting.length === 1) {
      const order = awaiting[0]!;
      return () => this.attach(customer, order.number, picked.fileId, picked.name);
    }
    if (awaiting.length === 0) {
      const [checking] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.customerId, customer.id), eq(orders.status, 'receipt_review')))
        .orderBy(asc(orders.number))
        .limit(1);
      if (checking) {
        await this.say(
          tx,
          customer,
          fill(t.receiptUnderCheck, { number: String(checking.number) }),
        );
      } else {
        const url = this.env.MINIAPP_URL;
        await this.say(
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
      return null;
    }
    const [pending] = await tx
      .insert(botPendingReceipts)
      .values({
        customerId: customer.id,
        fileId: picked.fileId,
        fileName: picked.name ?? null,
        createdAt: this.edges.clock.now(),
      })
      .returning({ id: botPendingReceipts.id });
    await this.say(tx, customer, t.receiptWhichOrder, {
      reply_markup: {
        inline_keyboard: awaiting.map((o) => [
          {
            text: fill(t.receiptOrderChoice, {
              number: String(o.number),
              amount: formatMoney(o.amountDue, customer.language),
            }),
            callback_data: `${CHOICE_PREFIX}:${pending!.id}:${o.number}`,
          },
        ]),
      },
    });
    return null;
  }

  /** A button under "which order?" was tapped; `data` is its callback data. */
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
    // claimed by deleting: a second tap, or another customer's button, finds nothing
    const [claimed] = await tx
      .delete(botPendingReceipts)
      .where(
        and(eq(botPendingReceipts.id, pendingId), eq(botPendingReceipts.customerId, customer.id)),
      )
      .returning();
    const windowMs =
      (await readSettings(tx, ['receipts.botChoiceSeconds']))['receipts.botChoiceSeconds'] * 1000;
    const expired =
      !claimed || this.edges.clock.now().getTime() - claimed.createdAt.getTime() > windowMs;
    if (!claimed || expired || !order) return this.say(tx, customer, t.receiptExpired);
    return () => this.attach(customer, number, claimed.fileId, claimed.fileName ?? undefined);
  }

  /** Download the file and give it to the one intake; every refusal gets its reply. */
  private async attach(
    customer: CustomerRow,
    number: number,
    fileId: string,
    name: string | undefined,
  ): Promise<void> {
    const t = dictionaries[customer.language].bot;
    try {
      const maxBytes = await this.receipts.maxUploadBytes();
      const got = await this.edges.telegramFiles.download(fileId, maxBytes);
      if (got.kind === 'too_large')
        return this.reply(customer, this.tooLargeText(customer, maxBytes));
      if (got.kind === 'unavailable') return this.reply(customer, t.receiptTryAgain);
      const out = await this.receipts.submit(customer.id, number, got.bytes, {
        fileName: cleanFileName(name),
        source: 'bot',
      });
      switch (out.kind) {
        case 'submitted':
          return; // "receipt received" was queued by the status change, as for an upload
        case 'not_found':
          return this.reply(customer, fill(t.orderNotAwaiting, { number: String(number) }));
        case 'status_changed':
          return this.reply(customer, this.notAwaiting(t, out.order));
        case 'try_again':
          return this.reply(customer, t.receiptTryAgain);
        case 'refused':
          return this.reply(
            customer,
            out.code === 'too_large'
              ? this.tooLargeText(customer, out.maxBytes ?? maxBytes)
              : out.code === 'unsupported_type'
                ? t.receiptUnsupported
                : t.receiptUnreadable,
          );
      }
    } catch (e) {
      this.log.error(`receipt from chat ${customer.telegramId} failed: ${describeError(e)}`);
      await this.reply(customer, t.receiptTryAgain).catch(() => undefined);
    }
  }

  /** The file to fetch, or why it cannot be: its declared type or size already refuses it. */
  private pick(
    file: IncomingReceipt,
    maxBytes: number,
  ): { fileId: string; name?: string } | 'unsupported' | 'too_large' {
    if (file.kind === 'photo') {
      // Telegram lists sizes smallest first: the largest one still under the cap
      const fits = file.sizes.filter((s) => s.size === undefined || s.size <= maxBytes);
      const best = fits.at(-1);
      return best ? { fileId: best.fileId } : 'too_large';
    }
    if (file.mime && !DECLARED_MIMES.has(file.mime.toLowerCase())) return 'unsupported';
    if (file.size !== undefined && file.size > maxBytes) return 'too_large';
    return { fileId: file.fileId, ...(file.name ? { name: file.name } : {}) };
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

  private async tooLarge(tx: DbOrTx, customer: CustomerRow, maxBytes: number): Promise<null> {
    await this.say(tx, customer, this.tooLargeText(customer, maxBytes));
    return null;
  }

  private async customer(tx: DbOrTx, telegramId: number): Promise<CustomerRow | null> {
    const [c] = await tx.select().from(customers).where(eq(customers.telegramId, telegramId));
    return c ?? null;
  }

  /** Queue a reply inside the update's transaction. Returns null so handlers can `return this.say(...)`. */
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
    // no record, so no saved language: the Telegram one (`uz` is Uzbek, anything else Russian)
    const t = dictionaries[languageCode === 'uz' ? 'uz' : 'ru'].bot;
    const url = this.env.MINIAPP_URL;
    await this.say(
      tx,
      { telegramId },
      t.receiptUnknownUser,
      url ? { reply_markup: { inline_keyboard: [[{ text: t.openShop, web_app: { url } }]] } } : {},
    );
  }

  /** A reply after the update committed: its own transaction. */
  private reply(customer: Pick<CustomerRow, 'telegramId'>, text: string): Promise<void> {
    return this.outbox.withTx((tx) => this.say(tx, customer, text).then(() => undefined));
  }
}
