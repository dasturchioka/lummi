import { Api, GrammyError, InputFile } from 'grammy';
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
  /**
   * An image to send with `text` as its caption (sendPhoto; the caption limit is 1024): its bytes
   * (uploaded), or Telegram's `file_id` from an earlier upload (no upload).
   */
  photo?: { bytes: Uint8Array } | { fileId: string };
}

export interface SendResult {
  messageId: number;
  /** The photo's file_id when one was uploaded, to send by id next time. */
  photoFileId?: string;
}

export interface TelegramSender {
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Telegram answered 403: the user blocked the bot, or the bot was removed from the chat. Never retried. */
export class BotBlockedError extends Error {
  /**
   * `cannotInitiate`: the user never started the bot ("bot can't initiate conversation"). That is
   * not a block: nothing is flagged, and a later /start or write-access grant works as before.
   */
  constructor(
    readonly chatId: number,
    readonly cannotInitiate = false,
  ) {
    super(`Telegram refused a chat (403${cannotInitiate ? ', cannot initiate' : ''})`);
    this.name = 'BotBlockedError';
  }
}

/** Telegram answered 429 and the sender's own retries gave up; the caller retries later. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Telegram asked to wait ${retryAfterSeconds} s (429)`);
    this.name = 'RateLimitedError';
  }
}

/** Telegram rejected a photo `file_id` (expired or from another bot); re-upload the bytes. */
export class InvalidFileIdError extends Error {
  constructor() {
    super('Telegram rejected the photo file_id');
    this.name = 'InvalidFileIdError';
  }
}

export class UnconfiguredTelegramSender implements TelegramSender {
  send(): Promise<SendResult> {
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

  async send(m: OutboundMessage): Promise<SendResult> {
    try {
      const extra = {
        ...(m.options as object),
        ...(m.threadId ? { message_thread_id: m.threadId } : {}),
      };
      if (m.photo) {
        const photo = 'fileId' in m.photo ? m.photo.fileId : new InputFile(m.photo.bytes);
        const sent = await this.api.sendPhoto(m.chatId, photo, { ...extra, caption: m.text });
        return { messageId: sent.message_id, photoFileId: sent.photo.at(-1)?.file_id };
      }
      const sent = await this.api.sendMessage(m.chatId, m.text, extra);
      return { messageId: sent.message_id };
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) {
        throw new BotBlockedError(m.chatId, /can't initiate/i.test(e.description));
      }
      if (e instanceof GrammyError && e.error_code === 400 && m.photo && 'fileId' in m.photo) {
        if (/file identifier|wrong remote file|wrong file/i.test(e.description)) {
          throw new InvalidFileIdError();
        }
      }
      if (e instanceof GrammyError && e.error_code === 429) {
        throw new RateLimitedError(e.parameters.retry_after ?? 5);
      }
      throw e;
    }
  }
}
