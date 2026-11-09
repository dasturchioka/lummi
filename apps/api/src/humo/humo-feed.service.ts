import type { HumoMessageResult } from '@lummi/contracts';
import { credits, desc, eq, heartbeats, humoMessages, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges } from '../edges';
import { AlertService } from '../outbox/alert.service';
import { OutboxService } from '../outbox/outbox.service';
import { DB, EDGES } from '../tokens';
import { CreditEvents, type CreditRecorded } from './credit-events';
import { parseHumoNotification, type HumoParseError } from './humo-parser';

const USERBOT = 'userbot';

/** Staff-facing, so Russian (like every owner alert). */
const FIELD_NAMES: Record<HumoParseError, string> = {
  amount: 'сумма',
  time: 'время',
  card: 'карта',
};

/**
 * The API side of the Humo feed (ADR 0014): the userbot posts every message of the Humo bot chat;
 * this records ➕ credits, keeps the raw text, flags what does not fit the template, and tells
 * payment matching through `CreditEvents`.
 */
@Injectable()
export class HumoFeedService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(CreditEvents) private readonly events: CreditEvents,
  ) {}

  /**
   * Idempotent on `messageId`: a repeat (or a concurrent twin) answers what is stored and records,
   * alerts and emits nothing. A debit is neither stored nor remembered, so a repeat is a debit again.
   */
  async intake(messageId: number, text: string): Promise<HumoMessageResult> {
    const parsed = parseHumoNotification(text);
    if (parsed.kind === 'debit') return { outcome: 'debit', duplicate: false, creditId: null };

    const { result, event } = await this.outbox.withTx(async (tx) => {
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
      if (!stored) return { result: await this.stored(tx, messageId), event: null };

      if (parsed.kind === 'unparseable') {
        await this.alerts.alertOwner(
          tx,
          `Не удалось разобрать сообщение Humo (message_id ${messageId}): не по шаблону поле ` +
            `«${FIELD_NAMES[parsed.reason]}». Если это поступление, оно не записано и не подтвердит ` +
            `заказ автоматически. Формат уведомлений мог измениться: сообщите разработчику.`,
        );
        return {
          result: { outcome: 'unparseable', duplicate: false, creditId: null } as const,
          event: null,
        };
      }

      const [credit] = await tx
        .insert(credits)
        .values({ humoMessageId: messageId, ...parsed.credit })
        .returning();
      const recorded: CreditRecorded = {
        creditId: credit!.id,
        amountTiyin: credit!.amountTiyin,
        amountSom: credit!.amountSom,
        occurredAt: credit!.occurredAt,
        cardLast4: credit!.cardLast4,
      };
      return {
        result: { outcome: 'credit', duplicate: false, creditId: credit!.id } as const,
        event: recorded,
      };
    });

    if (event) await this.events.emitCreditRecorded(event);
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

  async userbotHeartbeat(): Promise<void> {
    const now = this.edges.clock.now();
    await this.db
      .insert(heartbeats)
      .values({ component: USERBOT, seenAt: now })
      .onConflictDoUpdate({ target: heartbeats.component, set: { seenAt: now } });
  }

  /** For the Humo-silence guard (ADR 0012): null until the userbot first reports in. */
  async userbotLastSeenAt(): Promise<Date | null> {
    const [row] = await this.db
      .select({ seenAt: heartbeats.seenAt })
      .from(heartbeats)
      .where(eq(heartbeats.component, USERBOT));
    return row?.seenAt ?? null;
  }

  private async stored(tx: DbOrTx, messageId: number): Promise<HumoMessageResult> {
    const [credit] = await tx
      .select({ id: credits.id })
      .from(credits)
      .where(eq(credits.humoMessageId, messageId));
    return credit
      ? { outcome: 'credit', duplicate: true, creditId: credit.id }
      : { outcome: 'unparseable', duplicate: true, creditId: null };
  }
}
