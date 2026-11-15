import type { HumoMessageResult, UserbotForwardTarget } from '@lummi/contracts';
import { credits, desc, eq, humoMessages, userbotHeartbeat, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { AlertService } from '../outbox/alert.service';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { CreditEvents } from './credit-events';
import { parseHumoMessage, type HumoParseError } from './humo-parser';

/** What did not fit, for the owner alert. Staff-facing, so Russian (like every owner alert). */
const WHAT_FAILED: Record<HumoParseError, string> = {
  not_an_operation: 'в нём есть карта или сумма, но нет строки с ➕ или ➖',
  amount: 'не по шаблону поле «сумма»',
  time: 'не по шаблону поле «время»',
  card: 'не по шаблону поле «карта»',
};

/**
 * The API side of the Humo feed (ADR 0014): the userbot posts every message of the Humo bot chat;
 * this records ➕ credits, keeps the raw text, flags what does not fit the template, and queues
 * the "credit recorded" event for payment matching (`CreditEvents`).
 */
@Injectable()
export class HumoFeedService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(CreditEvents) private readonly events: CreditEvents,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /**
   * Idempotent on `messageId`: a repeat (or a concurrent twin) answers what is stored and records,
   * alerts and emits nothing. A debit or a service message (the Humo bot's menus, settings
   * answers, promos, #51) is neither stored nor remembered, so a repeat is the same again.
   */
  async intake(messageId: number, text: string): Promise<HumoMessageResult> {
    const parsed = parseHumoMessage(text);
    if (parsed.kind === 'debit') return { outcome: 'debit', duplicate: false, creditId: null };
    if (parsed.kind === 'service') return { outcome: 'service', duplicate: false, creditId: null };

    const result = await this.outbox.withTx(async (tx): Promise<HumoMessageResult> => {
      const [stored] = await tx
        .insert(humoMessages)
        .values({
          messageId,
          text,
          receivedAt: this.edges.clock.now(),
          parseError: parsed.kind === 'unparseable' ? parsed.reason : null,
        })
        .onConflictDoNothing()
        .returning({ messageId: humoMessages.messageId });
      if (!stored) return this.previousResult(tx, messageId);

      if (parsed.kind === 'unparseable') {
        await this.alerts.alertOwner(
          tx,
          `Не удалось разобрать сообщение Humo (message_id ${messageId}): ` +
            `${WHAT_FAILED[parsed.reason]}. Если это поступление, оно не записано и не подтвердит ` +
            `заказ автоматически. Формат сообщений мог измениться: сообщите разработчику.`,
        );
        return { outcome: 'unparseable', duplicate: false, creditId: null };
      }

      // The credit row is also the "credit recorded" event, pending until the worker handles it.
      const [credit] = await tx
        .insert(credits)
        .values({ humoMessageId: messageId, ...parsed.credit })
        .returning({ id: credits.id });
      return { outcome: 'credit', duplicate: false, creditId: credit!.id };
    });

    if (result.outcome === 'credit' && !result.duplicate) {
      await this.events.dispatchAfterCommit(result.creditId!);
    }
    return result;
  }

  /** The highest stored message_id (credits and flagged messages; debits are never stored). */
  async lastMessageId(): Promise<number | null> {
    const [row] = await this.db
      .select({ messageId: humoMessages.messageId })
      .from(humoMessages)
      .orderBy(desc(humoMessages.messageId))
      .limit(1);
    return row?.messageId ?? null;
  }

  /**
   * Where the userbot forwards ➕ notifications (#19): the orders group and its «Поступления»
   * topic, read on every call so a group that became a supergroup is followed at once.
   */
  async forwardTarget(): Promise<UserbotForwardTarget> {
    const chatId = await this.settings.get('bot.groupChatId');
    if (chatId === null) return { chatId: null, topicId: null };
    return { chatId, topicId: (await this.settings.get('bot.topics')).payments };
  }

  async userbotHeartbeat(): Promise<void> {
    const now = this.edges.clock.now();
    await this.db
      .insert(userbotHeartbeat)
      .values({ seenAt: now })
      .onConflictDoUpdate({ target: userbotHeartbeat.id, set: { seenAt: now } });
  }

  /** What the first post of this message_id was answered. */
  private async previousResult(tx: DbOrTx, messageId: number): Promise<HumoMessageResult> {
    const [credit] = await tx
      .select({ id: credits.id })
      .from(credits)
      .where(eq(credits.humoMessageId, messageId));
    return credit
      ? { outcome: 'credit', duplicate: true, creditId: credit.id }
      : { outcome: 'unparseable', duplicate: true, creditId: null };
  }
}
