import { and, credits, eq, inArray, isNull, lt, or, type Db } from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { describeError } from '../logging/describe-error';
import { DISPATCH_TIMEOUT_MS } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { withTimeout } from '../util/with-timeout';
import { WorkerRuntime } from '../worker/runtime';

/** What a handler (payment matching) learns about a new credit. */
export interface CreditRecorded {
  creditId: number;
  /** Whole so'm, compared with an order's amount due; null when the credit has tiyin. */
  amountSom: number | null;
  /** The Humo message's time (minute precision), UTC. */
  occurredAt: Date;
  cardLast4: string;
}

export type CreditRecordedHandler = (event: CreditRecorded) => void | Promise<void>;

const JOB = 'credit.recorded';
const ATTEMPTS = 5;

/**
 * The "credit recorded" event (ADR 0012: receipts are re-matched on every new credit), made
 * durable the ADR 0021 way. The credit row is the event: the intake writes it in its transaction
 * with `event_handled_at` null. Right after the commit `dispatch([id])` stamps `event_queued_at`
 * and queues a BullMQ job (`jobId` credit-recorded-<id>). The worker's `credit-recorded` sweep
 * queues whatever is still unhandled and was never queued (Redis down, a crash after the commit)
 * or was queued longer ago than `outbox.requeueAfterSeconds`.
 *
 * The worker runs every handler registered with `onCreditRecorded`, in order, then stamps
 * `event_handled_at`. A handler that throws fails the job, which BullMQ retries (5 attempts,
 * backoff), then the sweep. So delivery is at least once, and a handler must be idempotent.
 * Handlers run in the worker process only; register them in a provider's constructor.
 */
@Injectable()
export class CreditEvents implements OnApplicationShutdown {
  private readonly log = new Logger('CreditEvents');
  private readonly handlers = new Set<CreditRecordedHandler>();
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({ name: 'credit-recorded', run: async () => void (await this.dispatch()) });
    runtime.registerQueue({
      queue: env.EVENTS_QUEUE,
      process: (job: Job<{ creditId: number }>) => this.process(job.data.creditId),
    });
  }

  /** Subscribe a handler (run by the worker); returns the unsubscribe function. */
  onCreditRecorded(handler: CreditRecordedHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Right after the intake's commit. Never throws: if Redis is slow or down, the sweep queues it. */
  async dispatchAfterCommit(creditId: number): Promise<void> {
    try {
      await withTimeout(this.dispatch([creditId]), DISPATCH_TIMEOUT_MS);
    } catch (e) {
      this.log.warn(`credit ${creditId}: not queued, the sweep will: ${describeError(e)}`);
    }
  }

  /**
   * Stamp `event_queued_at` on unhandled credits never queued (or queued longer ago than the
   * requeue window) and queue them. With no ids: every such credit (the sweep). The stamp is one
   * statement, so two callers never queue the same credit inside the window.
   */
  async dispatch(ids?: number[]): Promise<number[]> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const stale = new Date(now.getTime() - window * 1000);
    const rows = await this.db
      .update(credits)
      .set({ eventQueuedAt: now })
      .where(
        and(
          isNull(credits.eventHandledAt),
          or(isNull(credits.eventQueuedAt), lt(credits.eventQueuedAt, stale)),
          ids ? inArray(credits.id, ids) : undefined,
        ),
      )
      .returning({ id: credits.id });
    const claimed = rows.map((r) => r.id).sort((a, b) => a - b);
    if (claimed.length === 0) return [];
    try {
      await this.getQueue().addBulk(
        claimed.map((creditId) => ({
          name: JOB,
          data: { creditId },
          opts: {
            jobId: `credit-recorded-${creditId}`, // one live job per credit
            attempts: ATTEMPTS,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        })),
      );
    } catch (e) {
      // Not queued after all: unstamp so the next sweep picks them up instead of waiting out the window.
      await this.db
        .update(credits)
        .set({ eventQueuedAt: null })
        .where(inArray(credits.id, claimed));
      throw e;
    }
    return claimed;
  }

  /** The worker's job: run every handler, then mark the credit handled. A handled credit is skipped. */
  async process(creditId: number): Promise<void> {
    const [credit] = await this.db
      .select()
      .from(credits)
      .where(and(eq(credits.id, creditId), isNull(credits.eventHandledAt)));
    if (!credit) return;
    const event: CreditRecorded = {
      creditId: credit.id,
      amountSom: credit.amountSom,
      occurredAt: credit.occurredAt,
      cardLast4: credit.cardLast4,
    };
    for (const handler of [...this.handlers]) {
      try {
        await handler(event);
      } catch (e) {
        this.log.error(`credit ${creditId}: a handler failed, will retry: ${describeError(e)}`);
        throw e;
      }
    }
    await this.db
      .update(credits)
      .set({ eventHandledAt: this.edges.clock.now() })
      .where(eq(credits.id, creditId));
  }

  private getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${describeError(e)}`));
      this.queue = new Queue(this.env.EVENTS_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
