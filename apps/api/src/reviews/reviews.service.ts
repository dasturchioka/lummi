import {
  adminReviewsQuerySchema,
  tashkentDayStart,
  type AdminReviewDto,
  type AdminReviewsPageDto,
  type AdminReviewsQuery,
  type PublicReview,
  type ReviewsBlock,
} from '@lummi/contracts';
import {
  and,
  asc,
  auditLog,
  customers,
  desc,
  eq,
  fragrances,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  orderLines,
  orders,
  reviewPhotos,
  reviews,
  sql,
  type Db,
  type DbOrTx,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { fill, formatPhone } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { escapeHtml } from '../orders-group/card-view';
import { AuditService } from '../audit/audit.service';
import type { Edges } from '../edges';
import { OutboxService, type OutboxTask } from '../outbox/outbox.service';
import { readSettings, SettingsService } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';

/** Staff read the group in Russian, like the owner alerts (spec Changes 2026-11-09). */
const group = dictionaries.ru.bot.group;
/** The most rows the Excel export writes: a guard against a runaway file, far above any real list. */
const EXPORT_MAX_ROWS = 20_000;
/** A delivery that dies holding the review's post lease frees it after this long. */
const LEASE_MS = 2 * 60 * 1000;
/** The customer columns a review's display needs: the name and the phone (the account's, else the Recipient's). */
export const WHO = {
  first: customers.firstName,
  last: customers.lastName,
  phone: customers.phone,
  recipientPhone: orders.recipientPhone,
};
export const whoOf = (r: {
  first: string;
  last: string | null;
  phone: string | null;
  recipientPhone: string;
}) => ({ name: [r.first, r.last].filter(Boolean).join(' '), phone: r.phone ?? r.recipientPhone });

const FORMAT = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

type Target = { kind: 'fragrance'; id: number } | { kind: 'discovery' } | { kind: 'builder' };

/**
 * Reviews outside the bot (#41): the customer-facing block, the admin panel, the Excel export and
 * the «Отзывы» post. A review is private until staff publish it; everything a customer can reach
 * here reads `published = true` and nothing else.
 */
/**
 * A review waiting for a decision (the admin Home's «Отзывы», #48, and the list's `waiting`
 * filter): the customer finished it (`step = done`, so it can be published), nobody ever decided
 * it (not published, no `published_at`, and no publish or hide in the audit trail: hiding a
 * published review clears its `published_at`), and it was finished (`step_at`) within the setting
 * `reviews.homeQueueDays`. One staff choose not to publish drops out after that window; there is
 * no «decline» mark.
 */
export async function awaitingDecision(db: DbOrTx, now: Date): Promise<SQL> {
  const { 'reviews.homeQueueDays': days } = await readSettings(db, ['reviews.homeQueueDays']);
  return and(
    eq(reviews.step, 'done'),
    eq(reviews.published, false),
    isNull(reviews.publishedAt),
    gte(reviews.stepAt, new Date(now.getTime() - days * 86_400_000)),
    sql`not exists (select 1 from ${auditLog} decided where decided.target_type = 'review' and decided.target_id = "reviews"."id"::text and decided.action in ('review.published', 'review.hidden'))`,
  )!;
}

@Injectable()
export class ReviewsService {
  private readonly log = new Logger('Reviews');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) outbox: OutboxService,
  ) {
    outbox.handle('review_post', (task) => this.post(task));
  }

  // ---- The card block

  /** `null`: no such fragrance (unknown or hidden). */
  async block(target: string): Promise<ReviewsBlock | null> {
    const resolved = await this.target(target);
    if (!resolved) return null;
    const onTarget = this.orderHas(resolved);
    const shown = and(eq(reviews.published, true), onTarget);
    const [{ count = 0, average = null } = {}] = await this.db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        average: sql<string | null>`round(avg(${reviews.rating}), 1)`,
      })
      .from(reviews)
      .where(shown);
    const { 'reviews.cardLimit': limit } = await readSettings(this.db, ['reviews.cardLimit']);
    const rows = await this.db
      .select({ review: reviews, firstName: customers.firstName })
      .from(reviews)
      .innerJoin(customers, eq(customers.id, reviews.customerId))
      .where(shown)
      .orderBy(desc(reviews.publishedAt), desc(reviews.id))
      .limit(limit);
    const photos = rows.length
      ? await this.db
          .select({ reviewId: reviewPhotos.reviewId, key: reviewPhotos.publicKey })
          .from(reviewPhotos)
          .where(
            and(
              inArray(
                reviewPhotos.reviewId,
                rows.map((r) => r.review.id),
              ),
              isNotNull(reviewPhotos.fileKey),
            ),
          )
          .orderBy(asc(reviewPhotos.id))
      : [];
    const items: PublicReview[] = rows.map(({ review, firstName }) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      firstName: firstName.trim().split(/\s+/)[0] ?? '',
      publishedAt: (review.publishedAt ?? review.createdAt).toISOString(),
      photos: photos.filter((p) => p.reviewId === review.id).map((p) => p.key),
    }));
    return { average: average === null ? null : Number(average), count, items };
  }

  private async target(target: string): Promise<Target | null> {
    if (target === 'discovery-set') return { kind: 'discovery' };
    if (target === 'builder-set') return { kind: 'builder' };
    const [f] = await this.db
      .select({ id: fragrances.id })
      .from(fragrances)
      .where(and(eq(fragrances.slug, target), eq(fragrances.hidden, false)));
    return f ? { kind: 'fragrance', id: f.id } : null;
  }

  /**
   * Whether the review's order holds the target: a fragrance bought as a bottle or inside a set, or
   * the Discovery set, or a builder set. A published review shows on all of them (spec 2026-11-07).
   */
  private orderHas(target: Target): SQL {
    // the 5 × 10 ml set's card (the 5 × 5 ml one shows no reviews yet, ADR 0042)
    if (target.kind === 'discovery')
      return sql`exists (select 1 from ${orderLines} ol where ol.order_id = ${reviews.orderId} and ol.kind = 'discovery_set' and ol.ml = 10)`;
    if (target.kind === 'builder')
      return sql`exists (select 1 from ${orderLines} ol where ol.order_id = ${reviews.orderId} and ol.kind = 'builder_set')`;
    // a gift sample came free with the order (ADR 0042): it is not what the review is about
    return sql`exists (select 1 from ${orderLines} ol where ol.order_id = ${reviews.orderId} and (
      (ol.fragrance_id = ${target.id} and not ol.gift_sample)
      or exists (select 1 from jsonb_array_elements(ol.set_composition) e where (e->>'fragranceId')::bigint = ${target.id})
    ))`;
  }

  /** A published review's photo, by its public key; `null` while the review is hidden or the file is gone. */
  async publicPhoto(key: string): Promise<Uint8Array | null> {
    if (!z.string().uuid().safeParse(key).success) return null;
    const [row] = await this.db
      .select({ fileKey: reviewPhotos.fileKey })
      .from(reviewPhotos)
      .innerJoin(reviews, eq(reviews.id, reviewPhotos.reviewId))
      .where(and(eq(reviewPhotos.publicKey, key), eq(reviews.published, true)));
    return row?.fileKey ? this.edges.files.get(row.fileKey) : null;
  }

  /** Any photo, for staff. */
  async staffPhoto(id: number): Promise<Uint8Array | null> {
    const [row] = await this.db
      .select({ fileKey: reviewPhotos.fileKey })
      .from(reviewPhotos)
      .where(eq(reviewPhotos.id, id));
    return row?.fileKey ? this.edges.files.get(row.fileKey) : null;
  }

  // ---- The admin panel

  private async filters(q: AdminReviewsQuery): Promise<SQL | undefined> {
    const parsed = adminReviewsQuerySchema.parse(q);
    const where: SQL[] = [];
    if (parsed.rating) where.push(eq(reviews.rating, parsed.rating));
    if (parsed.order)
      where.push(sql`${reviews.orderId} in (select id from orders where number = ${parsed.order})`);
    if (parsed.state === 'waiting')
      where.push(await awaitingDecision(this.db, this.edges.clock.now()));
    else if (parsed.state) where.push(eq(reviews.published, parsed.state === 'published'));
    if (parsed.from)
      where.push(sql`${reviews.createdAt} >= ${tashkentDayStart(parsed.from).toISOString()}`);
    if (parsed.to)
      where.push(sql`${reviews.createdAt} < ${tashkentDayStart(parsed.to, 1).toISOString()}`);
    return where.length ? and(...where) : undefined;
  }

  async list(q: AdminReviewsQuery): Promise<AdminReviewsPageDto> {
    const query = adminReviewsQuerySchema.parse(q);
    const where = await this.filters(query);
    const [stats] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        published: sql<number>`count(*) filter (where ${reviews.published})`.mapWith(Number),
        average: sql<string | null>`round(avg(${reviews.rating}), 1)`,
      })
      .from(reviews)
      .where(where);
    const rows = await this.rows(where, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return {
      items: rows,
      total: stats?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      average: stats?.average == null ? null : Number(stats.average),
      publishedCount: stats?.published ?? 0,
    };
  }

  private async rows(
    where: SQL | undefined,
    page?: { limit: number; offset: number },
  ): Promise<AdminReviewDto[]> {
    const base = this.db
      .select({ review: reviews, number: orders.number, ...WHO })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .innerJoin(customers, eq(customers.id, reviews.customerId))
      .where(where)
      .orderBy(desc(reviews.createdAt), desc(reviews.id));
    const found = page
      ? await base.limit(page.limit).offset(page.offset)
      : await base.limit(EXPORT_MAX_ROWS);
    if (found.length === 0) return [];
    const orderIds = found.map((r) => r.review.orderId);
    const lines = await this.db
      .select({ orderId: orderLines.orderId, name: orderLines.nameRu, kind: orderLines.kind })
      .from(orderLines)
      .where(inArray(orderLines.orderId, orderIds))
      .orderBy(asc(orderLines.orderId), asc(orderLines.position));
    const photos = await this.db
      .select({
        reviewId: reviewPhotos.reviewId,
        id: reviewPhotos.id,
        stored: isNotNull(reviewPhotos.fileKey),
      })
      .from(reviewPhotos)
      .where(
        inArray(
          reviewPhotos.reviewId,
          found.map((r) => r.review.id),
        ),
      )
      .orderBy(asc(reviewPhotos.id));
    return found.map((row) => {
      const { review } = row;
      const mine = photos.filter((p) => p.reviewId === review.id);
      const who = whoOf(row);
      return {
        id: review.id,
        orderNumber: row.number,
        customerName: who.name,
        phone: who.phone,
        rating: review.rating,
        comment: review.comment,
        items: [...new Set(lines.filter((l) => l.orderId === review.orderId).map((l) => l.name))],
        photoIds: mine.filter((p) => p.stored).map((p) => p.id),
        finished: review.step === 'done' && mine.every((p) => p.stored),
        published: review.published,
        createdAt: review.createdAt.toISOString(),
        publishedAt: review.publishedAt?.toISOString() ?? null,
      };
    });
  }

  /** The review of one order for the admin order page; null when it has none. */
  async ofOrder(orderId: number): Promise<AdminReviewDto | null> {
    const [dto] = await this.rows(eq(reviews.orderId, orderId));
    return dto ?? null;
  }

  /**
   * `null`: no such review; `not_finished`: it is still being written in the bot, so it cannot be
   * published (hiding is always possible). Setting the state it already has changes nothing.
   */
  async setPublished(
    actorId: number,
    id: number,
    published: boolean,
  ): Promise<AdminReviewDto | 'not_finished' | null> {
    const changed = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(reviews).where(eq(reviews.id, id)).for('update');
      if (!current) return 'missing' as const;
      if (current.published === published) return 'same' as const;
      if (published) {
        const [{ fetching } = { fetching: 0 }] = await tx
          .select({ fetching: sql<number>`count(*)`.mapWith(Number) })
          .from(reviewPhotos)
          .where(and(eq(reviewPhotos.reviewId, id), isNull(reviewPhotos.fileKey)));
        if (current.step !== 'done' || fetching > 0) return 'not_finished' as const;
      }
      await tx
        .update(reviews)
        .set({ published, publishedAt: published ? this.edges.clock.now() : null })
        .where(eq(reviews.id, id));
      await this.audit.record(tx, {
        actor: { type: 'staff', id: actorId },
        action: published ? 'review.published' : 'review.hidden',
        targetType: 'review',
        targetId: id,
        payload: { orderId: current.orderId, rating: current.rating },
      });
      return 'changed' as const;
    });
    if (changed === 'missing') return null;
    if (changed === 'not_finished') return 'not_finished';
    const [dto] = await this.rows(eq(reviews.id, id));
    return dto ?? null;
  }

  /** The filtered list as an Excel file (RU headers, Tashkent times). */
  async exportWorkbook(q: AdminReviewsQuery): Promise<Buffer> {
    const items = await this.rows(await this.filters(q));
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Отзывы');
    sheet.columns = [
      { header: 'Дата', key: 'date', width: 18 },
      { header: 'Заказ', key: 'order', width: 10 },
      { header: 'Покупатель', key: 'name', width: 24 },
      { header: 'Телефон', key: 'phone', width: 18 },
      { header: 'Оценка', key: 'rating', width: 8 },
      { header: 'Комментарий', key: 'comment', width: 60 },
      { header: 'В заказе', key: 'items', width: 40 },
      { header: 'Фото', key: 'photos', width: 8 },
      { header: 'Опубликован', key: 'published', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of items)
      sheet.addRow({
        date: tashkentText(new Date(r.createdAt)),
        order: r.orderNumber,
        name: r.customerName,
        phone: r.phone ?? '',
        rating: r.rating,
        comment: r.comment ?? '',
        items: r.items.join(', '),
        photos: r.photoIds.length,
        published: r.published ? 'да' : 'нет',
      });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---- The «Отзывы» post

  /**
   * A low review in the «Отзывы» topic, in two steps (spec Changes 2026-11-11): the card the moment
   * the rating arrives (order, name, phone, rating, «Комментарий пишется…»), and once the review is
   * finished its comment and photos as a reply to that card, or nothing when there is none. Each
   * step is stamped as it lands, and one delivery holds the review's lease, so a retry or a second
   * task sends only what is missing and never a card twice.
   */
  private async post(task: OutboxTask): Promise<void> {
    const chatId = (await this.settings.get('bot.groupChatId')) ?? null;
    if (chatId === null) {
      this.log.warn(`review ${task.ref}: no orders group is set, nothing posted`);
      return;
    }
    const now = this.edges.clock.now();
    const [leased] = await this.db
      .update(reviews)
      .set({ postLeaseAt: now })
      .where(
        and(
          eq(reviews.id, task.ref),
          or(
            isNull(reviews.postLeaseAt),
            lt(reviews.postLeaseAt, new Date(now.getTime() - LEASE_MS)),
          ),
        ),
      )
      .returning({ id: reviews.id });
    if (!leased) {
      const [exists] = await this.db
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.id, task.ref));
      if (!exists) return;
      throw new Error(`review ${task.ref} is being posted by another delivery`);
    }
    try {
      const threadId = (await this.settings.get('bot.topics')).reviews;
      await this.postCard(task.ref, chatId, threadId);
      await this.postFollowUp(task.ref, chatId, threadId);
    } finally {
      await this.db.update(reviews).set({ postLeaseAt: null }).where(eq(reviews.id, task.ref));
    }
  }

  private async postCard(id: number, chatId: number, threadId: number | null): Promise<void> {
    const [found] = await this.db
      .select({ review: reviews, number: orders.number, ...WHO })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .innerJoin(customers, eq(customers.id, reviews.customerId))
      .where(eq(reviews.id, id));
    if (!found || found.review.topicPostedAt !== null) return;
    const { review } = found;
    const lines = await this.db
      .select({ name: orderLines.nameRu })
      .from(orderLines)
      .where(eq(orderLines.orderId, review.orderId))
      .orderBy(asc(orderLines.position));
    const who = whoOf(found);
    const text = [
      `<b>${fill(group.reviewTitle, { rating: String(review.rating), number: String(found.number) })}</b>`,
      `${group.reviewName}: ${escapeHtml(who.name)}`,
      `${group.reviewPhone}: ${escapeHtml(formatPhone(who.phone))}`,
      `${group.reviewItems}: ${escapeHtml([...new Set(lines.map((l) => l.name))].join(', '))}`,
      ...(review.step === 'done' ? [] : [group.reviewWriting]),
    ].join('\n');
    const sent = await this.edges.telegram.send({ chatId, threadId, text, options: { ...FORMAT } });
    await this.db
      .update(reviews)
      .set({ topicPostedAt: this.edges.clock.now(), topicMessageId: sent.messageId })
      .where(eq(reviews.id, id));
  }

  private async postFollowUp(id: number, chatId: number, threadId: number | null): Promise<void> {
    const [review] = await this.db.select().from(reviews).where(eq(reviews.id, id));
    // finished and released (no photo in flight), the card out, and not already followed up
    if (
      !review ||
      review.followUpPostedAt !== null ||
      review.topicMessageId === null ||
      review.postQueuedAt === null
    )
      return;
    const reply = {
      reply_parameters: { message_id: review.topicMessageId, allow_sending_without_reply: true },
    };
    if (review.comment) {
      const text = `${group.reviewComment}: ${escapeHtml(review.comment)}`;
      await this.edges.telegram.send({ chatId, threadId, text, options: { ...FORMAT, ...reply } });
    }
    const photos = await this.db
      .select()
      .from(reviewPhotos)
      .where(and(eq(reviewPhotos.reviewId, id), isNotNull(reviewPhotos.fileKey)))
      .orderBy(asc(reviewPhotos.id));
    for (const photo of photos) {
      if (photo.postedAt !== null) continue;
      const bytes = await this.edges.files.get(photo.fileKey!);
      if (bytes)
        await this.edges.telegram.send({
          chatId,
          threadId,
          text: '',
          options: reply,
          photo: { bytes },
        });
      await this.db
        .update(reviewPhotos)
        .set({ postedAt: this.edges.clock.now() })
        .where(eq(reviewPhotos.id, photo.id));
    }
    await this.db
      .update(reviews)
      .set({ followUpPostedAt: this.edges.clock.now() })
      .where(eq(reviews.id, id));
  }
}

/** `2026-11-09 15:00`, Asia/Tashkent. */
function tashkentText(d: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tashkent',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
  return parts;
}
