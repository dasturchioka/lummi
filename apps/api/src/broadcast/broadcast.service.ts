import {
  BROADCAST_IMAGE_KEY,
  settingDefinitions,
  MAX_PHOTO_BYTES,
  type AudienceCount,
  type BroadcastAudience,
  type BroadcastBody,
  type BroadcastCounts,
  type BroadcastDto,
} from '@lummi/contracts';
import {
  and,
  broadcastDeliveries,
  broadcasts,
  customers,
  desc,
  eq,
  fragrances,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type BroadcastRow,
  type Db,
  type StaffRow,
} from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { normalizeUzbek, type Language } from '@lummi/i18n';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import sharp, { type Metadata } from 'sharp';
import { AuditService } from '../audit/audit.service';
import { CustomersService, broadcastReachableSql } from '../auth/customers.service';
import { looksLikeImage } from '../catalog/photo-pipeline';
import type { Edges, OutboundMessage, SendResult } from '../edges';
import { BotBlockedError, InvalidFileIdError, RateLimitedError } from '../edges';
import { DEV_BOT_LINK, type Env } from '../env';
import { describeError } from '../logging/describe-error';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { WorkerRuntime } from '../worker/runtime';
import { withTimeout } from '../util/with-timeout';

/** One more attempt than a lone message gets: a broadcast runs for minutes and a 429 can span several. */
export const BROADCAST_ATTEMPTS = 6;
const DISPATCH_TIMEOUT_MS = 3000;
const BULK_CHUNK = 500;
/** The minute sweep re-queues at most this many deliveries per tick, so a big stuck audience trickles back instead of being re-stamped at once. */
const SWEEP_CAP = 2000;
/** Why a customer the bot may not write to is counted «не доставлено» without a job. */
const SUPPRESSED = 'suppressed: not started, refused write access or blocked the bot';
const CANNOT_INITIATE = 'cannot initiate: the customer never started the bot';
/** Telegram's sendPhoto limits: width + height at most 10 000 px, ratio at most 20. */
const MAX_SIDE_SUM = 10_000;
const MAX_RATIO = 20;

export type Failure = { ok: false; reason: 'invalid' | 'not_found'; fields?: string[] };
export type Result<T> = { ok: true; value: T } | Failure;
export type TestResult =
  { ok: true; sent: Language[] } | { ok: false; reason: 'test_blocked' | 'test_failed' };

type DeliveryOutcome = 'sent' | 'blocked' | 'skipped';

/**
 * Broadcasts (owner only, spec Changes 2026-11-07, ADR 0021). Creating one writes the durable row
 * and one delivery row per customer in a single transaction (customers the bot may not write to
 * are already `blocked`), then queues a BullMQ job per pending delivery. The worker sends them at
 * the configured rate; the minute sweep re-queues anything a crash or a Redis outage left behind.
 */
@Injectable()
export class BroadcastService implements OnApplicationShutdown {
  private readonly log = new Logger('Broadcasts');
  private connection?: Redis;
  private queue?: Queue;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(WorkerRuntime) runtime: WorkerRuntime,
  ) {
    runtime.register({
      name: 'broadcast-dispatch',
      run: async () => void (await this.dispatch(undefined, SWEEP_CAP)),
    });
    runtime.registerQueue({
      queue: env.BROADCAST_QUEUE,
      concurrency: 5,
      ratePerSecond: () => this.settings.get('broadcast.sendRatePerSecond'),
      fallbackRatePerSecond: settingDefinitions['broadcast.sendRatePerSecond'].default,
      process: (
        job: Job<{ broadcastId: number; customerId: number }>,
        worker: Pick<Worker, 'rateLimit'>,
      ) => this.process(job, worker),
    });
  }

  // ---------------------------------------------------------------- composer

  /** An uploaded image: judged by its bytes, kept as sent under a content-hash key. */
  async storeImage(bytes: Uint8Array): Promise<Result<{ key: string }>> {
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES || !looksLikeImage(bytes)) {
      return { ok: false, reason: 'invalid', fields: ['image'] };
    }
    let meta: Metadata;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      return { ok: false, reason: 'invalid', fields: ['image'] };
    }
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h || w + h > MAX_SIDE_SUM || Math.max(w / h, h / w) > MAX_RATIO) {
      return { ok: false, reason: 'invalid', fields: ['image'] };
    }
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const key = `broadcasts/${hash}.${ext}`;
    if (!BROADCAST_IMAGE_KEY.test(key)) return { ok: false, reason: 'invalid', fields: ['image'] };
    await this.edges.files.put(key, bytes);
    return { ok: true, value: { key } };
  }

  /**
   * Everyone in the audience, those the bot may write to (the rest are «blocked» at once), and
   * those split by the language they will get it in.
   */
  async audienceCount(audience: BroadcastAudience): Promise<AudienceCount> {
    const reachableIn = (language: Language) =>
      sql<number>`(count(*) filter (where ${broadcastReachableSql} and ${customers.language} = ${language}))::int`;
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        reachable: sql<number>`(count(*) filter (where ${broadcastReachableSql}))::int`,
        ru: reachableIn('ru'),
        uz: reachableIn('uz'),
      })
      .from(customers)
      .where(audienceSql(audience));
    return {
      total: row?.total ?? 0,
      reachable: row?.reachable ?? 0,
      reachableByLanguage: { ru: row?.ru ?? 0, uz: row?.uz ?? 0 },
    };
  }

  /** The fragrance behind a `p_<slug>` target (hidden ones too: the send check is the same). */
  async fragranceBySlug(slug: string): Promise<{ name: string } | null> {
    const [f] = await this.db
      .select({ name: fragrances.name })
      .from(fragrances)
      .where(eq(fragrances.slug, slug));
    return f ?? null;
  }

  /** Normalise and check what the schema cannot: the image exists and the fragrance target is real. */
  async prepare(body: BroadcastBody): Promise<Result<BroadcastBody>> {
    const fields: string[] = [];
    if (body.imageKey && !(await this.edges.files.get(body.imageKey))) fields.push('imageKey');
    if (body.buttonTarget?.startsWith('p_')) {
      if (!(await this.fragranceBySlug(body.buttonTarget.slice(2)))) fields.push('buttonTarget');
    }
    if (fields.length) return { ok: false, reason: 'invalid', fields };
    return { ok: true, value: { ...body, textUz: normalizeUzbek(body.textUz) } };
  }

  /** «Отправить себе»: both versions to the owner's own Telegram id, outside the queue. */
  async sendTest(actor: StaffRow, body: BroadcastBody): Promise<TestResult> {
    const sent: Language[] = [];
    try {
      for (const lang of ['ru', 'uz'] as const) {
        await this.edges.telegram.send(
          await this.message({ ...body, photoFileId: null }, lang, actor.telegramId),
        );
        sent.push(lang);
      }
    } catch (e) {
      this.log.warn(`test send failed: ${e instanceof Error ? e.name : 'error'}`);
      return { ok: false, reason: e instanceof BotBlockedError ? 'test_blocked' : 'test_failed' };
    }
    await this.audit.record(this.db, {
      actor: { type: 'staff', id: actor.id },
      action: 'broadcast.test_sent',
      targetType: 'staff',
      targetId: actor.id,
      payload: { audience: body.audience, hasImage: body.imageKey !== null },
    });
    return { ok: true, sent };
  }

  // ----------------------------------------------------------------- sending

  async send(actor: StaffRow, body: BroadcastBody): Promise<BroadcastDto> {
    const id = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(broadcasts)
        .values({
          audience: body.audience,
          textRu: body.textRu,
          textUz: body.textUz,
          imageKey: body.imageKey,
          buttonTarget: body.buttonTarget,
          createdBy: actor.id,
          createdByName: actor.name,
        })
        .returning({ id: broadcasts.id });
      const broadcastId = (inserted as { id: number }).id;
      await tx.execute(sql`
        insert into broadcast_deliveries (broadcast_id, customer_id, status, error)
        select ${broadcastId}::bigint, ${customers.id},
          case when ${broadcastReachableSql} then 'pending'::broadcast_delivery_status else 'blocked'::broadcast_delivery_status end,
          case when ${broadcastReachableSql} then null else ${SUPPRESSED} end
        from customers
        where ${audienceSql(body.audience)}`);
      const counts = await countsFor(tx, [broadcastId]);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actor.id },
        action: 'broadcast.sent',
        targetType: 'broadcast',
        targetId: broadcastId,
        payload: {
          audience: body.audience,
          audienceSize: counts.get(broadcastId)?.total ?? 0,
          sender: actor.name,
          hasImage: body.imageKey !== null,
          buttonTarget: body.buttonTarget,
        },
      });
      return broadcastId;
    });
    try {
      await withTimeout(this.dispatch(id), DISPATCH_TIMEOUT_MS);
    } catch (e) {
      this.log.warn(`immediate dispatch failed, the tick will queue it: ${describeError(e)}`);
    }
    return (await this.get(id)) as BroadcastDto;
  }

  /**
   * Queue pending deliveries that are not queued, or were queued longer ago than the requeue
   * window (jobId = broadcast x customer, so a duplicate add is ignored). One stamping statement,
   * so two callers never queue the same delivery inside the window. `limit` caps one call (the
   * minute sweep), oldest first, so a big stuck audience trickles back instead of being re-stamped at once.
   */
  async dispatch(broadcastId?: number, limit?: number): Promise<number> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const stale = new Date(now.getTime() - window * 1000);
    const result = await this.db.execute<{ b: number; c: number }>(sql`
      update broadcast_deliveries d set queued_at = ${now}
      from (
        select broadcast_id, customer_id from broadcast_deliveries
        where status = 'pending'
          and (queued_at is null or queued_at < ${stale})
          ${broadcastId ? sql`and broadcast_id = ${broadcastId}` : sql``}
        order by broadcast_id, customer_id
        ${limit ? sql`limit ${limit}` : sql``}
        for update skip locked
      ) due
      where d.broadcast_id = due.broadcast_id and d.customer_id = due.customer_id
      returning d.broadcast_id as b, d.customer_id as c`);
    const rows = result.rows;
    if (rows.length === 0) return 0;
    try {
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        await this.getQueue().addBulk(
          rows.slice(i, i + BULK_CHUNK).map((r) => ({
            name: 'send',
            data: { broadcastId: Number(r.b), customerId: Number(r.c) },
            opts: {
              jobId: `bc-${r.b}-${r.c}`,
              attempts: BROADCAST_ATTEMPTS,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: true,
            },
          })),
        );
      }
    } catch (e) {
      // Not queued after all: unstamp so the next tick picks them up instead of waiting out the window.
      await this.db
        .update(broadcastDeliveries)
        .set({ queuedAt: null })
        .where(
          and(
            eq(broadcastDeliveries.status, 'pending'),
            inArray(broadcastDeliveries.broadcastId, [...new Set(rows.map((r) => Number(r.b)))]),
          ),
        );
      throw e;
    }
    return rows.length;
  }

  /**
   * One queue job. A flood wait (429) pauses the whole queue for Telegram's `retry_after` and
   * puts the job back without using an attempt; any other error is retried with backoff and
   * counts failed on the last attempt.
   */
  async process(
    job: Job<{ broadcastId: number; customerId: number }>,
    worker: Pick<Worker, 'rateLimit'>,
  ): Promise<void> {
    const { broadcastId, customerId } = job.data;
    try {
      await this.deliver(broadcastId, customerId);
    } catch (e) {
      if (e instanceof RateLimitedError) {
        await worker.rateLimit(e.retryAfterSeconds * 1000);
        throw Worker.RateLimitError();
      }
      if (job.attemptsMade + 1 >= BROADCAST_ATTEMPTS) {
        await this.finish(broadcastId, customerId, 'failed', describeError(e));
        return;
      }
      throw e;
    }
  }

  /**
   * Send to one customer, in their language. Safe to call twice and concurrently: the claim only
   * succeeds on a `pending` row nobody holds, so a retried job after `sent` sends nothing.
   */
  async deliver(broadcastId: number, customerId: number): Promise<DeliveryOutcome> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const delivery = broadcastDeliveries;
    const [claimed] = await this.db
      .update(delivery)
      .set({ sendingAt: now })
      .where(
        and(
          eq(delivery.broadcastId, broadcastId),
          eq(delivery.customerId, customerId),
          eq(delivery.status, 'pending'),
          or(
            isNull(delivery.sendingAt),
            lt(delivery.sendingAt, new Date(now.getTime() - window * 1000)),
          ),
        ),
      )
      .returning({ customerId: delivery.customerId });
    if (!claimed) return 'skipped';

    const [broadcast] = await this.db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcastId));
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, customerId));
    if (!broadcast || !customer) {
      await this.finish(broadcastId, customerId, 'failed', 'broadcast or customer is gone');
      return 'skipped';
    }
    // The audience rule again, for a customer who blocked the bot or refused since the broadcast was written.
    if (customer.botBlocked || customer.writeAccess !== 'granted') {
      await this.finish(broadcastId, customerId, 'blocked', SUPPRESSED);
      return 'blocked';
    }
    let message: OutboundMessage;
    try {
      message = await this.message(broadcast, customer.language, customer.telegramId);
    } catch (e) {
      await this.finish(broadcastId, customerId, 'failed', describeError(e));
      return 'skipped';
    }
    try {
      const sent = await this.sendPhotoById(broadcast, message);
      if (sent.photoFileId && !broadcast.photoFileId) {
        // the first upload: later sends go by this id, with no upload
        await this.db
          .update(broadcasts)
          .set({ photoFileId: sent.photoFileId })
          .where(and(eq(broadcasts.id, broadcastId), isNull(broadcasts.photoFileId)));
      }
    } catch (e) {
      if (e instanceof BotBlockedError) {
        await this.db.transaction(async (tx) => {
          if (e.cannotInitiate) {
            // Never started the bot: not delivered, but not a block either, so order messages still try.
            await this.finish(broadcastId, customerId, 'blocked', CANNOT_INITIATE, tx);
          } else {
            await this.finish(broadcastId, customerId, 'blocked', 'blocked (403)', tx);
            await this.customers.markBotBlocked(customer.telegramId, true, tx);
          }
        });
        return 'blocked';
      }
      // A flood wait, a timeout, a 5xx: release the claim so the queue's next attempt can take it.
      await this.db
        .update(delivery)
        .set({ sendingAt: null })
        .where(and(eq(delivery.broadcastId, broadcastId), eq(delivery.customerId, customerId)));
      throw e;
    }
    await this.finish(broadcastId, customerId, 'sent', null);
    return 'sent';
  }

  /** Send by the cached `file_id` when there is one; if Telegram rejects it, upload the image again. */
  private async sendPhotoById(
    broadcast: Pick<BroadcastRow, 'imageKey' | 'photoFileId'>,
    message: OutboundMessage,
  ): Promise<SendResult> {
    try {
      return await this.edges.telegram.send(message);
    } catch (e) {
      if (!(e instanceof InvalidFileIdError) || !broadcast.imageKey) throw e;
      const bytes = await this.edges.files.get(broadcast.imageKey);
      if (!bytes) throw new Error(`broadcast image ${broadcast.imageKey} is missing`);
      return this.edges.telegram.send({ ...message, photo: { bytes } });
    }
  }

  private async finish(
    broadcastId: number,
    customerId: number,
    status: 'sent' | 'blocked' | 'failed',
    error: string | null,
    tx: Pick<Db, 'update'> = this.db,
  ): Promise<void> {
    const delivery = broadcastDeliveries;
    await tx
      .update(delivery)
      .set({
        status,
        error: error?.slice(0, 500) ?? null,
        sentAt: status === 'sent' ? this.edges.clock.now() : null,
      })
      .where(
        and(
          eq(delivery.broadcastId, broadcastId),
          eq(delivery.customerId, customerId),
          eq(delivery.status, 'pending'),
        ),
      );
  }

  /** The customer's version: text in their language, the image as a photo, the optional startapp button. */
  private async message(
    broadcast: Pick<
      BroadcastRow,
      'textRu' | 'textUz' | 'imageKey' | 'buttonTarget' | 'photoFileId'
    >,
    language: Language,
    chatId: number,
  ): Promise<OutboundMessage> {
    const m: OutboundMessage = {
      chatId,
      text: language === 'uz' ? broadcast.textUz : broadcast.textRu,
    };
    if (broadcast.imageKey) {
      if (broadcast.photoFileId) {
        m.photo = { fileId: broadcast.photoFileId };
      } else {
        const bytes = await this.edges.files.get(broadcast.imageKey);
        if (!bytes) throw new Error(`broadcast image ${broadcast.imageKey} is missing`);
        m.photo = { bytes };
      }
    }
    if (broadcast.buttonTarget) {
      const link = (this.env.BOT_LINK ?? DEV_BOT_LINK).replace(/\/$/, '');
      m.options = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: dictionaries[language].bot.broadcastOpen,
                url: `${link}?startapp=${broadcast.buttonTarget}`,
              },
            ],
          ],
        },
      };
    }
    return m;
  }

  // ----------------------------------------------------------------- results

  async list(limit = 50): Promise<BroadcastDto[]> {
    const rows = await this.db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(limit);
    const counts = await countsFor(
      this.db,
      rows.map((r) => r.id),
    );
    const names = await this.fragranceNames(rows);
    return rows.map((r) => toDto(r, counts.get(r.id), names));
  }

  async get(id: number): Promise<BroadcastDto | null> {
    const [row] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!row) return null;
    return toDto(row, (await countsFor(this.db, [id])).get(id), await this.fragranceNames([row]));
  }

  /** Names of the fragrances that `p_<slug>` button targets point to, by slug. */
  private async fragranceNames(rows: BroadcastRow[]): Promise<Map<string, string>> {
    const slugs = [
      ...new Set(
        rows.flatMap((r) => (r.buttonTarget?.startsWith('p_') ? [r.buttonTarget.slice(2)] : [])),
      ),
    ];
    if (slugs.length === 0) return new Map();
    const found = await this.db
      .select({ slug: fragrances.slug, name: fragrances.name })
      .from(fragrances)
      .where(inArray(fragrances.slug, slugs));
    return new Map(found.map((f) => [f.slug, f.name]));
  }

  getQueue(): Queue {
    if (!this.queue) {
      this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 1 });
      this.connection.on('error', (e) => this.log.warn(`redis: ${e.message}`));
      this.queue = new Queue(this.env.BROADCAST_QUEUE, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.connection?.disconnect();
  }
}

/** Customers in an audience; `ru` and `uz` are the language the customer has saved. */
const audienceSql = (audience: BroadcastAudience) =>
  audience === 'all' ? sql`true` : sql`${customers.language} = ${audience}`;

async function countsFor(
  db: Pick<Db, 'select'>,
  ids: number[],
): Promise<Map<number, BroadcastCounts>> {
  const out = new Map<number, BroadcastCounts>();
  if (ids.length === 0) return out;
  const d = broadcastDeliveries;
  const rows = await db
    .select({ id: d.broadcastId, status: d.status, n: sql<number>`count(*)::int` })
    .from(d)
    .where(inArray(d.broadcastId, ids))
    .groupBy(d.broadcastId, d.status);
  for (const r of rows) {
    const c = out.get(r.id) ?? { total: 0, sent: 0, blocked: 0, failed: 0, pending: 0 };
    c[r.status] += r.n;
    c.total += r.n;
    out.set(r.id, c);
  }
  return out;
}

function toDto(
  row: BroadcastRow,
  counts: BroadcastCounts | undefined,
  fragranceNames: Map<string, string>,
): BroadcastDto {
  const c = counts ?? { total: 0, sent: 0, blocked: 0, failed: 0, pending: 0 };
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    audience: row.audience,
    textRu: row.textRu,
    textUz: row.textUz,
    hasImage: row.imageKey !== null,
    buttonTarget: row.buttonTarget,
    buttonFragrance: row.buttonTarget?.startsWith('p_')
      ? (fragranceNames.get(row.buttonTarget.slice(2)) ?? null)
      : null,
    status: c.pending > 0 ? 'sending' : 'done',
    counts: c,
  };
}
