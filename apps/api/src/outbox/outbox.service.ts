import {
  and,
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
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { CustomersService } from '../auth/customers.service';
import type { Edges, OutboundMessage } from '../edges';
import { BotBlockedError } from '../edges';
import type { Env } from '../env';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { describeError } from '../logging/describe-error';

export interface OutboxMessage {
  chatId: number;
  text: string;
  threadId?: number | null;
  options?: Record<string, unknown>;
}

/** Give up waiting for Redis after this long; the minute tick is the safety net. */
const DISPATCH_TIMEOUT_MS = 3000;

/**
 * The transactional outbox (ADR 0021).
 *
 * Producing: `withTx(fn)` opens the caller's transaction; `enqueue(tx, …)` inside it inserts the
 * message row, so it commits with the state change. Right after the commit the new ids go to BullMQ
 * (`jobId = outbox-<id>`), so a reply is sent within a second. If that step fails (Redis down) the
 * row stays pending and the worker's one-minute tick queues it. A caller that opens its own
 * `db.transaction` instead of `withTx` still works, with up to a minute of delay.
 *
 * Delivery: `deliver` claims the row (`sending_at`) before calling Telegram. Delivery is
 * at-least-once only for a crash between Telegram accepting the message and the `sent_at` stamp.
 */
@Injectable()
export class OutboxService implements OnApplicationShutdown {
  private readonly log = new Logger('Outbox');
  private readonly uncommitted = new WeakMap<object, number[]>();
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  /** Run `fn` in a transaction; messages it enqueued are dispatched to the queue after the commit. */
  async withTx<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
    let ids: number[] = [];
    const result = await this.db.transaction(async (tx) => {
      const r = await fn(tx);
      ids = this.uncommitted.get(tx) ?? [];
      return r;
    });
    if (ids.length > 0) {
      try {
        await withTimeout(this.dispatch(ids), DISPATCH_TIMEOUT_MS);
      } catch (e) {
        this.log.warn(`immediate dispatch failed, the tick will queue it: ${describeError(e)}`);
      }
    }
    return result;
  }

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
    const ids = rows.map((r) => r.id);
    this.uncommitted.set(tx, [...(this.uncommitted.get(tx) ?? []), ...ids]);
    return ids;
  }

  /**
   * Stamp queued_at on pending rows that are not queued (or were queued longer ago than the
   * requeue window) and add them to BullMQ. With no ids: every such pending row (the tick).
   * The stamp is one statement, so two callers never queue the same row inside the window.
   */
  async dispatch(ids?: number[]): Promise<number[]> {
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
          ids ? inArray(outbox.id, ids) : undefined,
        ),
      )
      .returning({ id: outbox.id });
    const claimed = rows.map((r) => r.id).sort((a, b) => a - b);
    if (claimed.length === 0) return [];
    try {
      await this.getQueue().addBulk(
        claimed.map((id) => ({
          name: 'send',
          data: { id },
          opts: {
            jobId: `outbox-${id}`, // the outbox id: the same row is never queued twice
            attempts: SEND_ATTEMPTS,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
    } catch (e) {
      // Not queued after all: unstamp so the next tick picks them up instead of waiting out the window.
      await this.db.update(outbox).set({ queuedAt: null }).where(inArray(outbox.id, claimed));
      throw e;
    }
    return claimed;
  }

  /** Send one row. Safe to call twice and concurrently: only one caller wins the claim. */
  async deliver(id: number): Promise<'sent' | 'skipped' | 'blocked'> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const [row] = await this.db
      .update(outbox)
      .set({ sendingAt: now })
      .where(
        and(
          eq(outbox.id, id),
          isNull(outbox.sentAt),
          isNull(outbox.failedAt),
          or(
            isNull(outbox.sendingAt),
            lt(outbox.sendingAt, new Date(now.getTime() - window * 1000)),
          ),
        ),
      )
      .returning();
    if (!row) return 'skipped';
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
          if (row.chatId > 0) await this.customers.markBotBlocked(row.chatId, true, tx);
        });
        return 'blocked';
      }
      // Retryable: release the claim so the queue's next attempt can take it.
      await this.db.update(outbox).set({ sendingAt: null }).where(eq(outbox.id, id));
      throw e;
    }
  }

  async markFailed(id: number, error: string): Promise<void> {
    await this.db
      .update(outbox)
      .set({ failedAt: this.edges.clock.now(), error: error.slice(0, 500) })
      .where(and(eq(outbox.id, id), isNull(outbox.sentAt)));
  }

  /** The BullMQ queue, created on first use (the API process needs it only to dispatch). */
  getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${e.message}`));
      this.queue = new Queue(this.env.OUTBOX_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}

export const SEND_ATTEMPTS = 5;

function toMessage(row: OutboxRow): OutboundMessage {
  return {
    chatId: row.chatId,
    threadId: row.threadId,
    text: row.text,
    options: row.options as Record<string, unknown>,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
