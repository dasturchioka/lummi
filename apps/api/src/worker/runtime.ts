import { lt, processedUpdates, type Db } from '@lummi/db';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { OutboxService } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';

/** Telegram sends per second for the whole queue (ADR 0021: broadcasts at <= 25 msg/s). */
const SEND_RATE_PER_SECOND = 25;
const SEND_ATTEMPTS = 5;
/** update_id is only an identity; after a long idle gap Telegram may restart the counter. */
const PROCESSED_UPDATES_KEEP_MS = 72 * 3600 * 1000;

/**
 * A periodic DB sweep (ADR 0021). It selects what is due straight from the DB and, in the same
 * transaction that queues a message, stamps a marker (reminder_7d_sent_at, ...), so running twice
 * sends nothing twice.
 */
export interface Sweep {
  name: string;
  run(ctx: { now: Date }): Promise<void>;
}

export interface WorkerDeps {
  env: Env;
  db: Db;
  edges: Edges;
  /** BullMQ queue name; tests use a unique one per run. */
  queueName?: string;
  log?: (message: string) => void;
}

/** The worker process: `tick()` runs sweeps and queues the outbox; `start()` begins sending. */
export class WorkerRuntime {
  readonly outbox: OutboxService;
  private readonly sweeps: Sweep[] = [];
  private readonly connection: Redis;
  private readonly queue: Queue;
  private worker?: Worker;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: WorkerDeps) {
    const settings = new SettingsService(deps.db, new AuditService(), deps.edges);
    this.outbox = new OutboxService(deps.db, deps.edges, settings);
    this.log = deps.log ?? ((m) => console.log(m));
    this.connection = new Redis(deps.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(deps.queueName ?? 'outbox', { connection: this.connection });
    this.register({
      name: 'prune-processed-updates',
      run: async ({ now }) => {
        await deps.db
          .delete(processedUpdates)
          .where(
            lt(processedUpdates.createdAt, new Date(now.getTime() - PROCESSED_UPDATES_KEEP_MS)),
          );
      },
    });
  }

  register(sweep: Sweep): void {
    this.sweeps.push(sweep);
  }

  /** One minute of work: every sweep, then hand pending outbox rows to the queue. */
  async tick(): Promise<void> {
    const now = this.deps.edges.clock.now();
    for (const sweep of this.sweeps) {
      try {
        await sweep.run({ now });
      } catch (e) {
        this.log(`sweep ${sweep.name} failed: ${(e as Error).message}`);
      }
    }
    const ids = await this.outbox.claimForQueue();
    if (ids.length === 0) return;
    await this.queue.addBulk(
      ids.map((id) => ({
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
  }

  /** Begin delivering queued jobs. */
  start(): void {
    this.worker = new Worker(this.queue.name, (job) => this.process(job), {
      connection: this.connection.duplicate(),
      concurrency: 5,
      limiter: { max: SEND_RATE_PER_SECOND, duration: 1000 },
    });
    this.worker.on('error', (e) => this.log(`queue error: ${e.message}`));
  }

  private async process(job: Job<{ id: number }>): Promise<void> {
    try {
      await this.outbox.deliver(job.data.id);
    } catch (e) {
      if (job.attemptsMade + 1 >= SEND_ATTEMPTS) {
        await this.outbox.markFailed(job.data.id, (e as Error).message);
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.obliterate({ force: true }).catch(() => undefined);
    await this.queue.close();
    this.connection.disconnect();
  }
}
