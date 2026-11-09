import { lt, processedUpdates, type Db, type DbOrTx } from '@lummi/db';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { AlertService } from '../outbox/alert.service';
import { OutboxService, SEND_ATTEMPTS } from '../outbox/outbox.service';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { describeError } from '../logging/describe-error';

/** Telegram sends per second for the whole queue (ADR 0021: broadcasts at <= 25 msg/s). */
const SEND_RATE_PER_SECOND = 25;
/** update_id is only an identity; after a long idle gap Telegram may restart the counter. */
const PROCESSED_UPDATES_KEEP_MS = 72 * 3600 * 1000;

/** What `tick()` hands every sweep, so it can keep the marker rule below. */
export interface SweepContext {
  now: Date;
  db: Db;
  /** Run a transaction; messages enqueued in it are dispatched to the queue right after the commit. */
  withTx<T>(fn: (tx: DbOrTx) => Promise<T>): Promise<T>;
  outbox: OutboxService;
  alerts: AlertService;
}

/**
 * A periodic DB sweep (ADR 0021). It selects what is due straight from the DB and, inside ONE
 * `ctx.withTx` transaction, stamps the marker (reminder_7d_sent_at, ...) and calls
 * `ctx.outbox.enqueue(tx, …)`, so running twice sends nothing twice. A sweep that throws on
 * `sweepFailureAlertAfter` consecutive ticks alerts the owner once.
 */
export interface Sweep {
  name: string;
  run(ctx: SweepContext): Promise<void>;
}

/**
 * A BullMQ queue whose jobs the worker executes (ADR 0021: BullMQ only executes). A job that throws
 * is retried by its own attempts and backoff; the producer's sweep is the safety net beyond that.
 */
export interface QueueProcessor {
  queue: string;
  concurrency?: number;
  /** Jobs per second for this queue, read once when the worker starts (a setting, so it can change). Unlimited when absent. */
  ratePerSecond?: () => Promise<number>;
  /** Used (with one warning in the log) when `ratePerSecond` fails at start, so deliveries never wait on a broken read. */
  fallbackRatePerSecond?: number;
  process(job: Job, worker: Worker): Promise<void>;
}

/** The worker process (built from a Nest application context, like the API). */
@Injectable()
export class WorkerRuntime implements OnApplicationShutdown {
  private readonly log = new Logger('Worker');
  private readonly sweeps: Sweep[] = [];
  private readonly processors: QueueProcessor[] = [];
  private readonly extraWorkers: { worker: Worker; connection: Redis }[] = [];
  private readonly failures = new Map<string, number>();
  private ticking = false;
  private starting?: Promise<void>;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AlertService) private readonly alerts: AlertService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {
    this.register({
      name: 'prune-processed-updates',
      run: async ({ now, db: d }) => {
        await d
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

  /** Execute this queue's jobs in the worker process, from `start()` on. */
  registerQueue(processor: QueueProcessor): void {
    this.processors.push(processor);
  }

  /** One minute of work: every sweep, then queue pending outbox rows. A tick still running is not stacked. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const ctx: SweepContext = {
        now: this.edges.clock.now(),
        db: this.db,
        withTx: (fn) => this.outbox.withTx(fn),
        outbox: this.outbox,
        alerts: this.alerts,
      };
      for (const sweep of this.sweeps) await this.runSweep(sweep, ctx);
      await this.outbox.dispatch();
    } finally {
      this.ticking = false;
    }
  }

  private async runSweep(sweep: Sweep, ctx: SweepContext): Promise<void> {
    try {
      await sweep.run(ctx);
      this.failures.delete(sweep.name);
    } catch (e) {
      const count = (this.failures.get(sweep.name) ?? 0) + 1;
      this.failures.set(sweep.name, count);
      this.log.error(`sweep ${sweep.name} failed (${count} in a row): ${describeError(e)}`);
      const limit = await this.settings.get('worker.sweepFailureAlertAfter');
      if (count === limit) {
        await ctx
          .withTx((tx) =>
            this.alerts.alertOwner(
              tx,
              `Сбой задачи «${sweep.name}» ${count} раз подряд: ${describeError(e)}`,
            ),
          )
          .catch((err: unknown) =>
            this.log.error(`could not queue the alert: ${describeError(err)}`),
          );
      }
    }
  }

  /** Begin delivering queued jobs. */
  start(): void {
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(this.env.OUTBOX_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 5,
      limiter: { max: SEND_RATE_PER_SECOND, duration: 1000 },
    });
    this.worker.on('error', (e) => this.log.error(`queue error: ${describeError(e)}`));
    // Starting stays synchronous; a queue with a rate reads its setting first, so its worker comes up a moment later.
    this.starting = Promise.all(this.processors.map((p) => this.startQueue(p))).then(() => {});
    this.starting.catch((e: unknown) => this.log.error(`worker start failed: ${describeError(e)}`));
  }

  private async startQueue(p: QueueProcessor): Promise<void> {
    let rate: number | null = null;
    if (p.ratePerSecond) {
      try {
        rate = await p.ratePerSecond();
      } catch (e) {
        rate = p.fallbackRatePerSecond ?? null;
        this.log.warn(
          `queue ${p.queue}: could not read its rate (${describeError(e)}); starting at ${rate ?? 'no limit'}/s`,
        );
      }
    }
    const connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    const worker: Worker = new Worker(p.queue, (job) => p.process(job, worker), {
      connection,
      concurrency: p.concurrency ?? 1,
      ...(rate ? { limiter: { max: rate, duration: 1000 } } : {}),
    });
    worker.on('error', (e) => this.log.error(`queue ${p.queue} error: ${describeError(e)}`));
    this.extraWorkers.push({ worker, connection });
  }

  private async process(job: Job<{ id: number }>): Promise<void> {
    try {
      await this.outbox.deliver(job.data.id);
    } catch (e) {
      if (job.attemptsMade + 1 >= SEND_ATTEMPTS) {
        await this.outbox.markFailed(job.data.id, describeError(e));
      }
      throw e;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.starting?.catch(() => undefined);
    await this.worker?.close();
    this.connection?.disconnect();
    for (const { worker, connection } of this.extraWorkers) {
      await worker.close();
      connection.disconnect();
    }
  }
}
