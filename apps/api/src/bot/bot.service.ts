import { processedUpdates, type DbOrTx } from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Bot, type Context } from 'grammy';
import type { UserFromGetMe, Update } from 'grammy/types';
import { CustomersService } from '../auth/customers.service';
import type { Env } from '../env';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import type { Edges } from '../edges';
import { EDGES, ENV } from '../tokens';
import { describeError } from '../logging/describe-error';
import { BotReceipts, RECEIPT_CALLBACK, type IncomingReceipt } from './bot-receipts.service';
import { CARD_CALLBACK } from '../orders-group/card-view';
import { OrderCards } from '../orders-group/order-cards';
import { OrdersGroupBot } from '../orders-group/orders-group-bot';

export const BOT_INFO = Symbol('BOT_INFO');

/** tx is the update's transaction; afterCommit callbacks run once it has committed (best effort). */
type BotContext = Context & { tx: DbOrTx; afterCommit: (() => Promise<void>)[] };

/** Update types we handle; getUpdates and setWebhook both need them named (the default omits some). */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

/**
 * The grammY bot as a module of the API (ADR 0015). Handlers do their DB work and queue replies
 * through the outbox; nothing here calls Telegram to answer, so replies get retry and throttling
 * and a crash cannot lose them. Every update runs in one transaction together with its dedup claim.
 */
@Injectable()
export class BotService implements OnApplicationShutdown {
  private readonly log = new Logger('Bot');
  private readonly bot: Bot<BotContext>;
  private initialized: boolean;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(BotReceipts) private readonly botReceipts: BotReceipts,
    @Inject(OrdersGroupBot) private readonly ordersGroup: OrdersGroupBot,
    @Inject(OrderCards) private readonly orderCards: OrderCards,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(BOT_INFO) botInfo: UserFromGetMe | undefined,
  ) {
    this.bot = new Bot<BotContext>(env.BOT_TOKEN, botInfo ? { botInfo } : {});
    this.initialized = botInfo !== undefined;
    this.bot.use((ctx, next) => this.dedupe(ctx, next));
    this.bot.command('start', (ctx) => this.onStart(ctx));
    // the orders group first: a reply there is never a receipt, and anything else passes on
    this.bot
      .chatType(['group', 'supergroup'])
      .on('message', (ctx, next) => this.onGroupMessage(ctx, next));
    this.bot.on(['message:photo', 'message:document'], (ctx) => this.onReceiptFile(ctx));
    this.bot.callbackQuery(RECEIPT_CALLBACK, (ctx) => this.onReceiptChoice(ctx));
    this.bot.callbackQuery(CARD_CALLBACK, (ctx) => this.onCardTap(ctx));
    this.bot.on('message:migrate_to_chat_id', (ctx) => this.onMigrate(ctx));
    this.bot.on('my_chat_member', (ctx) => this.onMyChatMember(ctx));
    this.bot.catch((err) =>
      this.log.error(`update ${err.ctx.update.update_id} failed: ${describeError(err)}`),
    );
  }

  /** Start according to BOT_MODE. Called by main.ts only, so tests never touch the network. */
  async start(): Promise<void> {
    if (this.env.BOT_MODE === 'off') return;
    await this.bot.init();
    this.initialized = true;
    if (this.env.MINIAPP_URL) {
      // The default (all chats) button is Russian; /start sets each customer's own language.
      await this.setMenuButton(null, 'ru');
    } else {
      this.log.warn('MINIAPP_URL is not set: no menu button and no web_app button on /start');
    }
    if (this.env.BOT_MODE === 'polling') {
      await this.bot.api.deleteWebhook(); // getUpdates refuses to run while a webhook is set
      this.bot
        .start({ allowed_updates: [...ALLOWED_UPDATES] })
        .catch((e: unknown) => this.log.error(`long polling stopped: ${describeError(e)}`));
      this.log.log('long polling started');
    } else {
      await this.bot.api.setWebhook(this.env.WEBHOOK_URL!, {
        secret_token: this.env.WEBHOOK_SECRET!,
        // A redeploy must never lose updates Telegram is holding.
        drop_pending_updates: false,
        allowed_updates: [...ALLOWED_UPDATES],
      });
      this.log.log('webhook set');
    }
  }

  /**
   * Set the Mini App menu button, for one private chat in the customer's language, or (chatId null)
   * as the default. The language switch in Profile calls this too. No-op unless the bot is running.
   */
  async setMenuButton(telegramId: number | null, language: Language): Promise<void> {
    const url = this.env.MINIAPP_URL;
    if (!url || this.env.BOT_MODE === 'off' || !this.initialized) return;
    await this.bot.api.setChatMenuButton({
      ...(telegramId === null ? {} : { chat_id: telegramId }),
      menu_button: {
        type: 'web_app',
        text: dictionaries[language].bot.openShop,
        web_app: { url },
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async stop(): Promise<void> {
    if (this.bot.isRunning()) await this.bot.stop();
  }

  /** Entry for the webhook route. Throws on failure so Telegram redelivers. */
  async handleUpdate(update: Update): Promise<void> {
    if (!this.initialized) throw new Error('bot is not initialized');
    await this.bot.handleUpdate(update);
  }

  /** Claim update_id and run the handlers in one transaction: a failure rolls the claim back too. */
  private async dedupe(ctx: BotContext, next: () => Promise<void>): Promise<void> {
    const afterCommit: (() => Promise<void>)[] = [];
    await this.outbox.withTx(async (tx) => {
      const claimed = await tx
        .insert(processedUpdates)
        .values({ updateId: ctx.update.update_id })
        .onConflictDoNothing()
        .returning({ id: processedUpdates.updateId });
      if (claimed.length === 0) return;
      ctx.tx = tx;
      ctx.afterCommit = afterCommit;
      await next();
    });
    for (const job of afterCommit) {
      await job().catch((e: unknown) =>
        this.log.warn(`after-commit step failed: ${describeError(e)}`),
      );
    }
  }

  private async onStart(ctx: BotContext): Promise<void> {
    if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    const customer = await this.customers.signIn(ctx.from, ctx.tx);
    await this.customers.markStarted(ctx.from.id, ctx.tx);
    ctx.afterCommit.push(() => this.setMenuButton(ctx.from!.id, customer.language));
    const t = dictionaries[customer.language].bot;
    const url = this.env.MINIAPP_URL;
    await this.outbox.enqueue(ctx.tx, {
      chatId: ctx.from.id,
      text: t.greeting,
      options: url
        ? { reply_markup: { inline_keyboard: [[{ text: t.openShop, web_app: { url } }]] } }
        : {},
    });
  }

  /** A photo or document in a private chat is a receipt (#31). */
  private async onReceiptFile(ctx: BotContext): Promise<void> {
    const m = ctx.message;
    if (!m || ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    const file: IncomingReceipt | null = m.photo
      ? {
          kind: 'photo',
          sizes: m.photo.map((p) => ({
            fileId: p.file_id,
            ...(p.file_size === undefined ? {} : { size: p.file_size }),
          })),
        }
      : m.document
        ? {
            kind: 'document',
            fileId: m.document.file_id,
            ...(m.document.file_name ? { name: m.document.file_name } : {}),
            ...(m.document.mime_type ? { mime: m.document.mime_type } : {}),
            ...(m.document.file_size === undefined ? {} : { size: m.document.file_size }),
          }
        : null;
    if (!file) return;
    const job = await this.botReceipts.onFile(ctx.tx, ctx.from.id, ctx.from.language_code, file);
    if (job) ctx.afterCommit.push(job);
  }

  /** The "which order is this receipt for?" button. Each feature's buttons have their own namespace. */
  private async onReceiptChoice(ctx: BotContext): Promise<void> {
    const query = ctx.callbackQuery;
    if (!query?.data || query.from.is_bot) return;
    const id = query.id;
    ctx.afterCommit.push(() => this.edges.telegram.answerCallback(id));
    const job = await this.botReceipts.onChoice(ctx.tx, query.from.id, query.data);
    if (job) ctx.afterCommit.push(job);
  }

  /** A button under an order's card in the orders group (#37), answered right after the commit. */
  private async onCardTap(ctx: BotContext): Promise<void> {
    const query = ctx.callbackQuery;
    if (!query?.data || query.from.is_bot) return;
    const id = query.id;
    const toast = await this.ordersGroup.onTap(ctx.tx, { fromId: query.from.id, data: query.data });
    ctx.afterCommit.push(() => this.edges.telegram.answerCallback(id, toast));
  }

  /** A reply to one of the bot's questions in a group (the tracking number, #37); the rest passes on. */
  private async onGroupMessage(ctx: BotContext, next: () => Promise<void>): Promise<void> {
    const m = ctx.message;
    const to = m?.reply_to_message;
    if (!m || !to || !ctx.from || ctx.from.is_bot || to.from?.id !== ctx.me.id) return next();
    const handled = await this.ordersGroup.onReply(ctx.tx, {
      chatId: m.chat.id,
      messageId: m.message_id,
      fromId: ctx.from.id,
      text: m.text,
      replyTo: to.message_id,
    });
    if (!handled) await next();
  }

  /** The group became a supergroup: its chat id changed. Follow it if it is our orders group. */
  private async onMigrate(ctx: BotContext): Promise<void> {
    const to = ctx.message?.migrate_to_chat_id;
    const from = ctx.chat?.id;
    if (!to || !from) return;
    // its order cards and open questions move along, whatever the setting says by now (#37)
    await this.orderCards.moveGroup(ctx.tx, from, to);
    if ((await this.settings.get('bot.groupChatId', ctx.tx)) !== from) return;
    await this.settings.set('bot.groupChatId', to, { type: 'system' }, ctx.tx);
    this.log.warn(`orders group migrated ${from} -> ${to}`);
  }

  /** The user blocked (kicked) or unblocked the bot: learn it before the next send fails. */
  private async onMyChatMember(ctx: BotContext): Promise<void> {
    const change = ctx.myChatMember;
    if (!change || change.chat.type !== 'private') return;
    const status = change.new_chat_member.status;
    if (status === 'kicked') await this.customers.markBotBlocked(change.chat.id, true, ctx.tx);
    else if (status === 'member')
      await this.customers.markBotBlocked(change.chat.id, false, ctx.tx);
  }
}
