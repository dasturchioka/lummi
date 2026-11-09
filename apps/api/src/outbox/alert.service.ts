import type { DbOrTx } from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { OutboxService, type OutboxMessage } from './outbox.service';

/** Owner alerts (spec Changes 2026-11-07): the «Системные» topic plus a DM to each alert recipient. */
@Injectable()
export class AlertService {
  private readonly log = new Logger('Alerts');

  constructor(
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Queue an alert in the caller's transaction. Staff-facing, so always Russian. */
  async alertOwner(tx: DbOrTx, text: string): Promise<void> {
    const body = `${dictionaries.ru.bot.alertPrefix}\n${text}`;
    // One after another: a transaction is one connection, which runs one query at a time.
    const groupChatId = await this.settings.get('bot.groupChatId', tx);
    const topics = await this.settings.get('bot.topics', tx);
    const recipients = await this.settings.get('bot.alertRecipients', tx);
    const messages: OutboxMessage[] = [];
    if (groupChatId !== null) {
      messages.push({ chatId: groupChatId, threadId: topics.system, text: body });
    }
    for (const telegramId of new Set(recipients)) messages.push({ chatId: telegramId, text: body });
    if (messages.length === 0) {
      // Never silent: until the group or a recipient is set, the alert only reaches the log.
      this.log.warn(
        'owner alert not sent: set bot.groupChatId or bot.alertRecipients. ' +
          `Alert: ${text.slice(0, 200)}`,
      );
      return;
    }
    await this.outbox.enqueue(tx, messages);
  }
}
