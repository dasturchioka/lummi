/** Outbound Telegram messages (bot and manager group). The real grammY sender arrives with the bot ticket. */
export interface OutboundMessage {
  chatId: number;
  text: string;
  /** Opaque extras (inline keyboard, parse mode) as the bot ticket defines them. */
  options?: Record<string, unknown>;
}

export interface TelegramSender {
  send(message: OutboundMessage): Promise<{ messageId: number }>;
}

export class UnconfiguredTelegramSender implements TelegramSender {
  send(): Promise<{ messageId: number }> {
    return Promise.reject(new Error('TelegramSender is not configured yet'));
  }
}
