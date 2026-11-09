import {
  and,
  customers,
  eq,
  inArray,
  isNull,
  lt,
  or,
  outbox,
  type Db,
  type DbOrTx,
  type OutboxRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import type { Edges, OutboundMessage } from '../edges';
import { BotBlockedError } from '../edges';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

export interface OutboxMessage {
  chatId: number;
  text: string;
  threadId?: number | null;
  options?: Record<string, unknown>;
}

/**
 * The transactional outbox (ADR 0021). `enqueue` runs inside the caller's transaction, so a message
 * and the state change it reports commit together. Delivery belongs to the worker.
 */
@Injectable()
export class OutboxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async enqueue(tx: DbOrTx, messages: OutboxMessage | OutboxMessage[]): Promise<number[]> {
    const list = Array.isArray(messages) ? messages : [messages];
    if (list.length === 0) return [];
    const rows = await tx
      .insert(outbox)
      .values(
        list.map((m) => ({
          chatId: m.chatId,
          threadId: m.threadId ?? null,
          text: m.text,
          options: m.options ?? {},
        })),
      )
      .returning({ id: outbox.id });
    return rows.map((r) => r.id);
  }

  /**
   * Stamps queued_at on every pending row that is not queued (or was queued longer ago than the
   * requeue window) and returns them for the queue. The stamp and the selection are one statement,
   * so two ticks never hand the same row over twice inside the window.
   */
  async claimForQueue(): Promise<number[]> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const stale = new Date(now.getTime() - window * 1000);
    const rows = await this.db
      .update(outbox)
      .set({ queuedAt: now })
      .where(
        and(
          isNull(outbox.sentAt),
          isNull(outbox.failedAt),
          or(isNull(outbox.queuedAt), lt(outbox.queuedAt, stale)),
        ),
      )
      .returning({ id: outbox.id });
    return rows.map((r) => r.id).sort((a, b) => a - b);
  }

  /** Send one row. Safe to call twice: a sent or failed row is skipped. Throws on retryable errors. */
  async deliver(id: number): Promise<'sent' | 'skipped' | 'blocked'> {
    const [row] = await this.db.select().from(outbox).where(eq(outbox.id, id));
    if (!row || row.sentAt || row.failedAt) return 'skipped';
    try {
      const { messageId } = await this.edges.telegram.send(toMessage(row));
      await this.db
        .update(outbox)
        .set({ sentAt: this.edges.clock.now(), telegramMessageId: messageId })
        .where(eq(outbox.id, id));
      return 'sent';
    } catch (e) {
      if (e instanceof BotBlockedError) {
        await this.db.transaction(async (tx) => {
          await tx
            .update(outbox)
            .set({ failedAt: this.edges.clock.now(), error: 'blocked (403)' })
            .where(eq(outbox.id, id));
          // A private chat id is the customer's Telegram id; a group 403 is not a customer.
          if (row.chatId > 0) {
            await tx
              .update(customers)
              .set({ botBlocked: true })
              .where(eq(customers.telegramId, row.chatId));
          }
        });
        return 'blocked';
      }
      throw e;
    }
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({ failedAt: this.edges.clock.now(), error: error.slice(0, 500) })
      .where(and(eq(outbox.id, id), isNull(outbox.sentAt)));
  }

  async byIds(ids: number[]): Promise<OutboxRow[]> {
    return ids.length ? this.db.select().from(outbox).where(inArray(outbox.id, ids)) : [];
  }
}

function toMessage(row: OutboxRow): OutboundMessage {
  return {
    chatId: row.chatId,
    threadId: row.threadId,
    text: row.text,
    options: row.options as Record<string, unknown>,
  };
}
