import { Api, GrammyError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';

/** Outbound Telegram messages (bot and manager group). */
export interface OutboundMessage {
  chatId: number;
  text: string;
  /** Forum topic (message_thread_id) inside a supergroup. */
  threadId?: number | null;
  /** Extra sendMessage parameters as the Bot API names them (reply_markup, parse_mode). */
  options?: Record<string, unknown>;
}

export interface TelegramSender {
  send(message: OutboundMessage): Promise<{ messageId: number }>;
}

/** Telegram answered 403: the user blocked the bot, or the bot was removed from the chat. Never retried. */
export class BotBlockedError extends Error {
  constructor(readonly chatId: number) {
    super(`Telegram refused chat ${chatId} (403)`);
    this.name = 'BotBlockedError';
  }
}

export class UnconfiguredTelegramSender implements TelegramSender {
  send(): Promise<{ messageId: number }> {
    return Promise.reject(new Error('TelegramSender is not configured yet'));
  }
}

/** The real sender: grammY Api with auto-retry (429 retry_after, 5xx) and a throttler (ADR 0021). */
export class GrammySender implements TelegramSender {
  private readonly api: Api;
  constructor(token: string) {
    this.api = new Api(token);
    this.api.config.use(apiThrottler());
    this.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  }

  async send(m: OutboundMessage): Promise<{ messageId: number }> {
    try {
      const sent = await this.api.sendMessage(m.chatId, m.text, {
        ...(m.options as object),
        ...(m.threadId ? { message_thread_id: m.threadId } : {}),
      });
      return { messageId: sent.message_id };
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) throw new BotBlockedError(m.chatId);
      throw e;
    }
  }
}
