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

/** The worker process (built from a Nest application context, like the API). */
@Injectable()
export class WorkerRuntime implements OnApplicationShutdown {
  private readonly log = new Logger('Worker');
  private readonly sweeps: Sweep[] = [];
  private readonly failures = new Map<string, number>();
  private ticking = false;
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
      this.log.error(`sweep ${sweep.name} failed (${count} in a row): ${(e as Error).message}`);
      const limit = await this.settings.get('worker.sweepFailureAlertAfter');
      if (count === limit) {
        await ctx
          .withTx((tx) =>
            this.alerts.alertOwner(
              tx,
              `Сбой задачи «${sweep.name}» ${count} раз подряд: ${(e as Error).message}`,
            ),
          )
          .catch((err: Error) => this.log.error(`could not queue the alert: ${err.message}`));
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
    this.worker.on('error', (e) => this.log.error(`queue error: ${e.message}`));
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

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
