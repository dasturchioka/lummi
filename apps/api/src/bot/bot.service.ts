import { processedUpdates, type DbOrTx } from '@lummi/db';
import { dictionaries, type Language } from '@lummi/i18n';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Bot, type Context } from 'grammy';
import type { UserFromGetMe, Update } from 'grammy/types';
import { CustomersService } from '../auth/customers.service';
import type { Env } from '../env';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { ENV } from '../tokens';

export const BOT_INFO = Symbol('BOT_INFO');

/** tx is the update's transaction; afterCommit callbacks run once it has committed (best effort). */
type BotContext = Context & { tx: DbOrTx; afterCommit: (() => Promise<void>)[] };

/** Update types we handle; getUpdates and setWebhook both need them named (the default omits some). */
export const ALLOWED_UPDATES = ['message', 'my_chat_member'] as const;

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
    @Inject(BOT_INFO) botInfo: UserFromGetMe | undefined,
  ) {
    this.bot = new Bot<BotContext>(env.BOT_TOKEN, botInfo ? { botInfo } : {});
    this.initialized = botInfo !== undefined;
    this.bot.use((ctx, next) => this.dedupe(ctx, next));
    this.bot.command('start', (ctx) => this.onStart(ctx));
    this.bot.on('message:migrate_to_chat_id', (ctx) => this.onMigrate(ctx));
    this.bot.on('my_chat_member', (ctx) => this.onMyChatMember(ctx));
    this.bot.catch((err) =>
      this.log.error(`update ${err.ctx.update.update_id} failed: ${err.message}`),
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
        .catch((e: Error) => this.log.error(`long polling stopped: ${e.message}`));
      this.log.log('long polling started');
    } else {
      await this.bot.api.setWebhook(this.env.WEBHOOK_URL!, {
        secret_token: this.env.WEBHOOK_SECRET!,
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
      await job().catch((e: Error) => this.log.warn(`after-commit step failed: ${e.message}`));
    }
  }

  private async onStart(ctx: BotContext): Promise<void> {
    if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return;
    const customer = await this.customers.signIn(ctx.from, ctx.tx);
    if (customer.botBlocked) await this.customers.markBotBlocked(ctx.from.id, false, ctx.tx);
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

  /** The group became a supergroup: its chat id changed. Follow it if it is our orders group. */
  private async onMigrate(ctx: BotContext): Promise<void> {
    const to = ctx.message?.migrate_to_chat_id;
    const from = ctx.chat?.id;
    if (!to || !from) return;
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
