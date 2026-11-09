import {
  BROADCAST_IMAGE_KEY,
  MAX_PHOTO_BYTES,
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
import { Queue, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import sharp, { type Metadata } from 'sharp';
import { AuditService } from '../audit/audit.service';
import { CustomersService } from '../auth/customers.service';
import { looksLikeImage } from '../catalog/photo-pipeline';
import type { Edges, OutboundMessage } from '../edges';
import { BotBlockedError } from '../edges';
import type { Env } from '../env';
import { describeError } from '../logging/describe-error';
import { SettingsService } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';
import { WorkerRuntime } from '../worker/runtime';
import { withTimeout } from '../util/with-timeout';

/** One more attempt than a lone message gets: a broadcast runs for minutes and a 429 can span several. */
export const BROADCAST_ATTEMPTS = 6;
const DISPATCH_TIMEOUT_MS = 3000;
const BULK_CHUNK = 500;
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
    runtime.register({ name: 'broadcast-dispatch', run: async () => void (await this.dispatch()) });
    runtime.registerQueue({
      queue: env.BROADCAST_QUEUE,
      concurrency: 5,
      ratePerSecond: () => this.settings.get('broadcast.sendRatePerSecond'),
      process: (job: Job<{ broadcastId: number; customerId: number }>) => this.process(job),
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

  /** Everyone in the audience and those the bot may write to (the rest are «blocked» at once). */
  async audienceCount(audience: BroadcastAudience): Promise<{ total: number; reachable: number }> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        reachable: sql<number>`(count(*) filter (where ${reachableSql}))::int`,
      })
      .from(customers)
      .where(audienceSql(audience));
    return { total: row?.total ?? 0, reachable: row?.reachable ?? 0 };
  }

  /** Normalise and check what the schema cannot: the image exists and the fragrance target is real. */
  async prepare(body: BroadcastBody): Promise<Result<BroadcastBody>> {
    const fields: string[] = [];
    if (body.imageKey && !(await this.edges.files.get(body.imageKey))) fields.push('imageKey');
    if (body.buttonTarget?.startsWith('p_')) {
      const [f] = await this.db
        .select({ id: fragrances.id })
        .from(fragrances)
        .where(eq(fragrances.slug, body.buttonTarget.slice(2)));
      if (!f) fields.push('buttonTarget');
    }
    if (fields.length) return { ok: false, reason: 'invalid', fields };
    return { ok: true, value: { ...body, textUz: normalizeUzbek(body.textUz) } };
  }

  /** «Отправить себе»: both versions to the owner's own Telegram id, outside the queue. */
  async sendTest(actor: StaffRow, body: BroadcastBody): Promise<TestResult> {
    const sent: Language[] = [];
    try {
      for (const lang of ['ru', 'uz'] as const) {
        await this.edges.telegram.send(await this.message(body, lang, actor.telegramId));
        sent.push(lang);
      }
    } catch (e) {
      this.log.warn(`test send failed: ${describeError(e)}`);
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
      const [row] = await tx
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
      const broadcastId = (row as { id: number }).id;
      await tx.execute(sql`
        insert into broadcast_deliveries (broadcast_id, customer_id, status, error)
        select ${broadcastId}::bigint, ${customers.id},
          case when ${reachableSql} then 'pending'::broadcast_delivery_status else 'blocked'::broadcast_delivery_status end,
          case when ${reachableSql} then null else 'suppressed: refused write access or blocked the bot' end
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
          recipients: counts.get(broadcastId)?.total ?? 0,
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
   * Queue every pending delivery that is not queued, or was queued longer ago than the requeue
   * window (jobId = broadcast x customer, so a duplicate add is ignored). One stamping statement,
   * so two callers never queue the same delivery inside the window.
   */
  async dispatch(broadcastId?: number): Promise<number> {
    const now = this.edges.clock.now();
    const window = await this.settings.get('outbox.requeueAfterSeconds');
    const stale = new Date(now.getTime() - window * 1000);
    const rows = await this.db
      .update(broadcastDeliveries)
      .set({ queuedAt: now })
      .where(
        and(
          eq(broadcastDeliveries.status, 'pending'),
          or(isNull(broadcastDeliveries.queuedAt), lt(broadcastDeliveries.queuedAt, stale)),
          broadcastId ? eq(broadcastDeliveries.broadcastId, broadcastId) : undefined,
        ),
      )
      .returning({ b: broadcastDeliveries.broadcastId, c: broadcastDeliveries.customerId });
    if (rows.length === 0) return 0;
    try {
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        await this.getQueue().addBulk(
          rows.slice(i, i + BULK_CHUNK).map((r) => ({
            name: 'send',
            data: { broadcastId: r.b, customerId: r.c },
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
            inArray(broadcastDeliveries.broadcastId, [...new Set(rows.map((r) => r.b))]),
          ),
        );
      throw e;
    }
    return rows.length;
  }

  /** One queue job. A job that throws is retried; its last attempt marks the delivery failed. */
  async process(job: Job<{ broadcastId: number; customerId: number }>): Promise<void> {
    const { broadcastId, customerId } = job.data;
    try {
      await this.deliver(broadcastId, customerId);
    } catch (e) {
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
    const d = broadcastDeliveries;
    const [claimed] = await this.db
      .update(d)
      .set({ sendingAt: now })
      .where(
        and(
          eq(d.broadcastId, broadcastId),
          eq(d.customerId, customerId),
          eq(d.status, 'pending'),
          or(isNull(d.sendingAt), lt(d.sendingAt, new Date(now.getTime() - window * 1000))),
        ),
      )
      .returning({ customerId: d.customerId });
    if (!claimed) return 'skipped';

    const [b] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
    const [c] = await this.db.select().from(customers).where(eq(customers.id, customerId));
    if (!b || !c) {
      await this.finish(broadcastId, customerId, 'failed', 'broadcast or customer is gone');
      return 'skipped';
    }
    if (!(await this.customers.canMessage(c.telegramId))) {
      await this.finish(
        broadcastId,
        customerId,
        'blocked',
        'suppressed: refused write access or blocked the bot',
      );
      return 'blocked';
    }
    let message: OutboundMessage;
    try {
      message = await this.message(b, c.language, c.telegramId);
    } catch (e) {
      await this.finish(broadcastId, customerId, 'failed', describeError(e));
      return 'skipped';
    }
    try {
      await this.edges.telegram.send(message);
    } catch (e) {
      if (e instanceof BotBlockedError) {
        await this.db.transaction(async (tx) => {
          await this.finish(broadcastId, customerId, 'blocked', 'blocked (403)', tx);
          await this.customers.markBotBlocked(c.telegramId, true, tx);
        });
        return 'blocked';
      }
      // A 429, a timeout, a 5xx: release the claim so the queue's next attempt can take it.
      await this.db
        .update(d)
        .set({ sendingAt: null })
        .where(and(eq(d.broadcastId, broadcastId), eq(d.customerId, customerId)));
      throw e;
    }
    await this.finish(broadcastId, customerId, 'sent', null);
    return 'sent';
  }

  private async finish(
    broadcastId: number,
    customerId: number,
    status: 'sent' | 'blocked' | 'failed',
    error: string | null,
    tx: Pick<Db, 'update'> = this.db,
  ): Promise<void> {
    const d = broadcastDeliveries;
    await tx
      .update(d)
      .set({
        status,
        error: error?.slice(0, 500) ?? null,
        sentAt: status === 'sent' ? this.edges.clock.now() : null,
      })
      .where(
        and(eq(d.broadcastId, broadcastId), eq(d.customerId, customerId), eq(d.status, 'pending')),
      );
  }

  /** The customer's version: text in their language, the image as a photo, the optional startapp button. */
  private async message(
    b: Pick<BroadcastRow, 'textRu' | 'textUz' | 'imageKey' | 'buttonTarget'>,
    language: Language,
    chatId: number,
  ): Promise<OutboundMessage> {
    const m: OutboundMessage = { chatId, text: language === 'uz' ? b.textUz : b.textRu };
    if (b.imageKey) {
      const bytes = await this.edges.files.get(b.imageKey);
      if (!bytes) throw new Error(`broadcast image ${b.imageKey} is missing`);
      m.photo = bytes;
    }
    if (b.buttonTarget) {
      m.options = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: dictionaries[language].bot.broadcastOpen,
                url: `${this.env.BOT_LINK.replace(/\/$/, '')}?startapp=${b.buttonTarget}`,
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
    return rows.map((r) => toDto(r, counts.get(r.id)));
  }

  async get(id: number): Promise<BroadcastDto | null> {
    const [row] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!row) return null;
    return toDto(row, (await countsFor(this.db, [id])).get(id));
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

/** The bot may write to them: not blocked, and they did not refuse write access. */
const reachableSql = sql`(${customers.botBlocked} = false and ${customers.writeAccess} is distinct from 'refused')`;

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

function toDto(row: BroadcastRow, counts?: BroadcastCounts): BroadcastDto {
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
    status: c.pending > 0 ? 'sending' : 'done',
    counts: c,
  };
}
