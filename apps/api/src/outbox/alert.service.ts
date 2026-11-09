import type { DbOrTx } from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { OutboxService, type OutboxMessage } from './outbox.service';

/** Owner alerts (spec Changes 2026-11-07): the «Системные» topic plus a DM to each alert recipient. */
@Injectable()
export class AlertService {
  constructor(
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Queue an alert in the caller's transaction. Staff-facing, so always Russian. */
  async alertOwner(tx: DbOrTx, text: string): Promise<void> {
    const body = `${dictionaries.ru.bot.alertPrefix}\n${text}`;
    const [groupChatId, topics, recipients] = await Promise.all([
      this.settings.get('bot.groupChatId', tx),
      this.settings.get('bot.topics', tx),
      this.settings.get('bot.alertRecipients', tx),
    ]);
    const messages: OutboxMessage[] = [];
    if (groupChatId !== null) {
      messages.push({ chatId: groupChatId, threadId: topics.system, text: body });
    }
    for (const telegramId of new Set(recipients)) messages.push({ chatId: telegramId, text: body });
    await this.outbox.enqueue(tx, messages);
  }
}
