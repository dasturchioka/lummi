import type { DbOrTx } from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { OutboxService, type OutboxMessage } from './outbox.service';

/**
 * Staff-facing posts, always Russian (spec Changes 2026-11-07): owner alerts go to the «Системные»
 * topic plus a DM to each alert recipient; informational posts (payment not found, a repeated
 * receipt) only to the topic, since nobody has to act on them.
 */
@Injectable()
export class AlertService {
  private readonly log = new Logger('Alerts');

  constructor(
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Queue an alert in the caller's transaction: the «Системные» topic and the recipients' DMs. */
  async alertOwner(tx: DbOrTx, text: string): Promise<void> {
    const body = `${dictionaries.ru.bot.alertPrefix}\n${text}`;
    const messages = await this.systemTopic(tx, body);
    // One after another: a transaction is one connection, which runs one query at a time.
    const recipients = await this.settings.get('bot.alertRecipients', tx);
    for (const telegramId of new Set(recipients)) messages.push({ chatId: telegramId, text: body });
    await this.send(tx, messages, text, 'bot.groupChatId or bot.alertRecipients');
  }

  /** Queue an informational post in the caller's transaction: the «Системные» topic only. */
  async postSystem(tx: DbOrTx, text: string): Promise<void> {
    await this.send(tx, await this.systemTopic(tx, text), text, 'bot.groupChatId');
  }

  private async systemTopic(tx: DbOrTx, text: string): Promise<OutboxMessage[]> {
    const groupChatId = await this.settings.get('bot.groupChatId', tx);
    if (groupChatId === null) return [];
    const topics = await this.settings.get('bot.topics', tx);
    return [{ chatId: groupChatId, threadId: topics.system, text }];
  }

  private async send(
    tx: DbOrTx,
    messages: OutboxMessage[],
    text: string,
    missing: string,
  ): Promise<void> {
    if (messages.length === 0) {
      // Never silent: until the group or a recipient is set, the post only reaches the log.
      this.log.warn(`staff post not sent: set ${missing}. Post: ${text.slice(0, 200)}`);
      return;
    }
    await this.outbox.enqueue(tx, messages);
  }
}
