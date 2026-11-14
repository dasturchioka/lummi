import {
  addDays,
  formatLocalDate,
  HOME_QUEUES,
  parseLocalDate,
  tashkentDay,
  tashkentDayStart,
  utcToTashkent,
  type AdminHome,
  type HomeNow,
  type HomeQueue,
  type HomeQueueHead,
  type HomeQueues,
  type HomeSales,
  type HomeStockItem,
  type HomeSystem,
  type OrderStatus,
  type PaidFigures,
  type TashkentMoment,
} from '@lummi/contracts';
import {
  and,
  asc,
  backupStatus,
  credits,
  customers,
  eq,
  errorEvents,
  gte,
  humoMessages,
  isNull,
  orderEvents,
  orderLines,
  orders,
  paymentPauses,
  receipts,
  reviews,
  sql,
  staff,
  userbotHeartbeat,
  type Db,
  type OrderRow,
  type PaymentPauseRow,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { customerName, paymentState } from '../admin-orders/admin-orders.service';
import { matchesStockQuery, stockRows } from '../admin/stock-admin.service';
import type { Edges } from '../edges';
import { CANDIDATE } from '../payment/rules';
import { readShopCard } from '../payment/shop-card.service';
import { orderMoney, refundOwed } from '../refunds/order-money';
import { daysEnding, lastTashkentDays, salesSummary } from '../reports/sales-summary';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import { pickNow } from './now-picker';

/** An instant on the Tashkent wall clock. */
export function moment(at: Date): TashkentMoment {
  const t = utcToTashkent(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return { day: formatLocalDate(tashkentDay(at)), time: `${two(t.hour)}:${two(t.minute)}` };
}

const secondsBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/** `received ÷ orders` to the so'm, halves up (as the sales report's average check); null without orders. */
const averageOf = (received: number, n: number) =>
  n === 0 ? null : Math.floor((2 * received + n) / (2 * n));

/** One queue's items, oldest first: the row id and since when it waits. */
type Waiting = { id: number; since: Date };

type WaitingQueues = Record<Exclude<HomeQueue, 'stock' | 'credits'>, Waiting[]> & {
  credits: (Waiting & { amountTiyin: number })[];
};

/** The status an order waits in for each fulfilment queue. */
const STATUS_QUEUES = {
  accept: 'payment_confirmed',
  assemble: 'accepted',
  bts: 'assembling',
} as const satisfies Partial<Record<HomeQueue, OrderStatus>>;

/** When the order last entered its current status (its history, ADR 0011); its creation if none. */
const enteredStatus =
  sql<Date>`coalesce((select max(ev.created_at) from ${orderEvents} ev where ev.order_id = "orders"."id" and ev.to_status = "orders"."status"), "orders"."created_at")`.mapWith(
    orders.createdAt,
  );

/** The order's first payment confirmation. */
const confirmedAt = sql`(select min(pe.created_at) from ${orderEvents} pe where pe.order_id = "orders"."id" and pe.action = 'confirm_payment')`;

/**
 * The admin Home (#48): the work queue in its fixed order (`HOME_QUEUES`), each queue's count and
 * oldest item, the Now item with its facts (`pickNow`), the pause and card state; for the owner,
 * money in today and #42's net sales (`salesSummary`, the one net-sales computation), and the
 * system line. Each queue counts exactly what its list shows behind its link: the receipts the
 * orders list calls `manual_review`, the orders in a status, unlinked credits, `refund_owed`,
 * stock `low` among visible fragrances, unpublished reviews. A manager's answer is built without
 * reading any owner data.
 */
@Injectable()
export class HomeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
  ) {}

  async home(member: StaffRow): Promise<AdminHome> {
    const now = this.edges.clock.now();
    const [card, [pause], waiting, stock] = await Promise.all([
      readShopCard(this.db),
      this.db.select().from(paymentPauses).where(isNull(paymentPauses.endedAt)),
      this.waiting(),
      this.stock(),
    ]);
    const queues = this.queues(waiting, stock, now);
    const counts = Object.fromEntries(HOME_QUEUES.map((q) => [q, queues[q].count])) as Record<
      HomeQueue,
      number
    >;
    const cardMissing = card === null;
    const pick = pickNow({ role: member.role, cardMissing, paused: Boolean(pause), counts });
    const nowItem = await this.nowItem(pick, { waiting, stock, pause, now, card });
    const base = { at: moment(now), cardMissing, now: nowItem, queues };
    if (member.role !== 'owner') return { role: 'manager', ...base };
    const [sales, system] = await Promise.all([this.sales(now), this.system(now, Boolean(pause))]);
    return { role: 'owner', ...base, sales, system };
  }

  // ---- the queues

  private async waiting(): Promise<WaitingQueues> {
    const byStatus = (status: OrderStatus) =>
      this.db
        .select({ id: orders.id, since: enteredStatus })
        .from(orders)
        .where(eq(orders.status, status))
        .orderBy(asc(enteredStatus), asc(orders.number));
    const [receiptsHeld, accept, assemble, bts, creditsFree, refunds, reviewsHidden] =
      await Promise.all([
        // the orders list's `manual_review`: the oldest receipt held for a person dates it
        this.db
          .select({
            id: orders.id,
            since: sql<Date>`min(${receipts.createdAt})`.mapWith(receipts.createdAt),
          })
          .from(orders)
          .innerJoin(
            receipts,
            and(eq(receipts.orderId, orders.id), eq(receipts.verdict, 'manual_review')),
          )
          .where(sql`(${paymentState}) = 'manual_review'`)
          .groupBy(orders.id)
          .orderBy(asc(sql`min(${receipts.createdAt})`), asc(orders.id)),
        byStatus(STATUS_QUEUES.accept),
        byStatus(STATUS_QUEUES.assemble),
        byStatus(STATUS_QUEUES.bts),
        // «Не привязано», as the credits list reads it: no order holds it
        this.db
          .select({ id: credits.id, since: credits.occurredAt, amountTiyin: credits.amountTiyin })
          .from(credits)
          .leftJoin(orders, eq(orders.creditId, credits.id))
          .where(isNull(orders.id))
          .orderBy(asc(credits.occurredAt), asc(credits.id)),
        this.db
          .select({ id: orders.id, since: enteredStatus })
          .from(orders)
          .where(refundOwed())
          .orderBy(asc(enteredStatus), asc(orders.number)),
        this.db
          .select({ id: reviews.id, since: reviews.createdAt })
          .from(reviews)
          .where(eq(reviews.published, false))
          .orderBy(asc(reviews.createdAt), asc(reviews.id)),
      ]);
    return {
      receipts: receiptsHeld,
      accept,
      assemble,
      bts,
      credits: creditsFree,
      refunds,
      reviews: reviewsHidden,
    };
  }

  /**
   * The stock page's `filter=low&visibility=visible`: nothing available, or at most the threshold,
   * among what the shop sells (a hidden fragrance is not for sale). Nothing left first, then the
   * fewest available, then the page's order.
   */
  private async stock(): Promise<HomeStockItem[]> {
    const { 'stock.lowAvailableThreshold': threshold } = await readSettings(this.db, [
      'stock.lowAvailableThreshold',
    ]);
    const { volumes, discovery } = await stockRows(this.db, threshold);
    const rows = [discovery, ...volumes].filter((r) =>
      matchesStockQuery(r, { filter: 'low', visibility: 'visible' }),
    );
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => a.r.available - b.r.available || a.i - b.i)
      .map(({ r }) => ({
        kind: r.kind,
        name: r.name,
        ml: r.ml,
        available: r.available,
        level: r.level === 'zero' ? ('zero' as const) : ('low' as const),
      }));
  }

  private queues(waiting: WaitingQueues, stock: HomeStockItem[], now: Date): HomeQueues {
    const head = (items: Waiting[]): HomeQueueHead => {
      const first = items[0];
      return {
        count: items.length,
        since: first ? moment(first.since) : null,
        waitedSeconds: first ? secondsBetween(first.since, now) : null,
      };
    };
    return {
      receipts: head(waiting.receipts),
      accept: head(waiting.accept),
      assemble: head(waiting.assemble),
      bts: head(waiting.bts),
      credits: {
        ...head(waiting.credits),
        oldestAmountTiyin: waiting.credits[0]?.amountTiyin ?? null,
      },
      refunds: head(waiting.refunds),
      stock: {
        count: stock.length,
        out: stock.filter((s) => s.level === 'zero').length,
        low: stock.filter((s) => s.level === 'low').length,
        first: stock[0] ?? null,
      },
      reviews: head(waiting.reviews),
    };
  }

  // ---- the Now item

  private async nowItem(
    pick: ReturnType<typeof pickNow>,
    ctx: {
      waiting: WaitingQueues;
      stock: HomeStockItem[];
      pause: PaymentPauseRow | undefined;
      now: Date;
      card: { number: string } | null;
    },
  ): Promise<HomeNow> {
    const { waiting, now } = ctx;
    switch (pick) {
      case 'clear':
        return { kind: 'clear' };
      case 'no_card':
        return { kind: 'no_card' };
      case 'humo_pause':
        return this.pauseItem(ctx.pause!, now);
      case 'stock':
        return { kind: 'stock', item: ctx.stock[0]! };
      case 'receipts':
        return this.receiptItem(waiting.receipts[0]!, now);
      case 'accept':
      case 'assemble':
      case 'bts':
        return this.orderItem(pick, waiting[pick][0]!, now);
      case 'credits':
        return this.creditItem(waiting.credits[0]!.id, now, ctx.card);
      case 'refunds':
        return this.refundItem(waiting.refunds[0]!, now);
      case 'reviews':
        return this.reviewItem(waiting.reviews[0]!, now);
    }
  }

  private async pauseItem(pause: PaymentPauseRow, now: Date): Promise<HomeNow> {
    const [[beat], [lastCredit], [underCheck]] = await Promise.all([
      this.db.select({ at: userbotHeartbeat.seenAt }).from(userbotHeartbeat),
      this.db
        .select({ at: sql`max(${humoMessages.receivedAt})`.mapWith(humoMessages.receivedAt) })
        .from(credits)
        .innerJoin(humoMessages, eq(humoMessages.messageId, credits.humoMessageId)),
      this.db
        .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
        .from(orders)
        .where(eq(orders.status, 'receipt_review')),
    ]);
    // the last sign of life the pause is about: the userbot's heartbeat, or Humo's last credit
    const signal = pause.cause === 'heartbeat' ? (beat?.at ?? null) : (lastCredit?.at ?? null);
    const since = signal && signal < pause.startedAt ? signal : pause.startedAt;
    return {
      kind: 'humo_pause',
      silentSeconds: secondsBetween(since, now),
      lastSignal: signal ? moment(signal) : null,
      underCheck: underCheck?.n ?? 0,
    };
  }

  private async receiptItem(head: Waiting, now: Date): Promise<HomeNow> {
    const order = await this.order(head.id);
    const [[held], [customer], settings, [credit]] = await Promise.all([
      this.db
        .select()
        .from(receipts)
        .where(and(eq(receipts.orderId, order.id), eq(receipts.verdict, 'manual_review')))
        .orderBy(asc(receipts.createdAt), asc(receipts.id))
        .limit(1),
      this.db.select().from(customers).where(eq(customers.id, order.customerId)),
      readSettings(this.db, ['payments.uncheckedReceiptAlertSeconds']),
      // the first Candidate credit (#32's rule): what the manager compares the receipt with
      this.db
        .execute<{ amount_tiyin: string; occurred_at: string | Date; card_last4: string }>(
          sql`select c.amount_tiyin, c.occurred_at, c.card_last4 from ${credits} c
            join ${orders} o on o.id = ${order.id} left join shop_card sc on true
            where ${CANDIDATE} order by c.occurred_at asc, c.id asc limit 1`,
        )
        .then((r) => r.rows),
    ]);
    return {
      kind: 'receipt',
      number: order.number,
      customer: customer ? customerName(customer) : '',
      amountDue: order.amountDue,
      waitedSeconds: secondsBetween(head.since, now),
      alertSeconds: settings['payments.uncheckedReceiptAlertSeconds'],
      alerted: held?.uncheckedAlertAt != null,
      reviewReason: held?.reviewReason ?? null,
      credit: credit
        ? {
            amountTiyin: Number(credit.amount_tiyin),
            at: moment(new Date(credit.occurred_at)),
            cardLast4: credit.card_last4,
          }
        : null,
    };
  }

  private async orderItem(
    kind: 'accept' | 'assemble' | 'bts',
    head: Waiting,
    now: Date,
  ): Promise<HomeNow> {
    const order = await this.order(head.id);
    const [facts, [confirmed]] = await Promise.all([
      this.orderFacts(order),
      kind === 'accept'
        ? this.db
            .select({ type: orderEvents.actorType, name: staff.name })
            .from(orderEvents)
            .leftJoin(staff, eq(staff.id, orderEvents.actorId))
            .where(
              and(eq(orderEvents.orderId, order.id), eq(orderEvents.action, 'confirm_payment')),
            )
            .orderBy(asc(orderEvents.id))
            .limit(1)
        : Promise.resolve([]),
    ]);
    const timing = { since: moment(head.since), waitedSeconds: secondsBetween(head.since, now) };
    if (kind !== 'accept') return { kind, ...facts, ...timing };
    return {
      kind,
      ...facts,
      ...timing,
      confirmedBy:
        confirmed?.type === 'staff'
          ? { type: 'staff', name: confirmed.name ?? null }
          : { type: 'ai' },
    };
  }

  private async creditItem(
    id: number,
    now: Date,
    card: { number: string } | null,
  ): Promise<HomeNow> {
    const [c] = await this.db.select().from(credits).where(eq(credits.id, id));
    if (!c) throw new Error(`credit ${id} is gone`);
    return {
      kind: 'credit',
      amountTiyin: c.amountTiyin,
      at: moment(c.occurredAt),
      waitedSeconds: secondsBetween(c.occurredAt, now),
      cardLast4: c.cardLast4,
      onShopCard: card !== null && card.number.slice(-4) === c.cardLast4,
      counterparty: c.counterparty,
    };
  }

  private async refundItem(head: Waiting, now: Date): Promise<HomeNow> {
    const order = await this.order(head.id);
    const [[customer], money] = await Promise.all([
      this.db.select().from(customers).where(eq(customers.id, order.customerId)),
      orderMoney(this.db, order),
    ]);
    return {
      kind: 'refund',
      number: order.number,
      customer: customer ? customerName(customer) : '',
      status: order.status === 'returned' ? 'returned' : 'cancelled',
      owed: money.owed,
      since: moment(head.since),
      waitedSeconds: secondsBetween(head.since, now),
    };
  }

  private async reviewItem(head: Waiting, now: Date): Promise<HomeNow> {
    const [row] = await this.db
      .select({ review: reviews, number: orders.number, customer: customers })
      .from(reviews)
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .innerJoin(customers, eq(customers.id, reviews.customerId))
      .where(eq(reviews.id, head.id));
    if (!row) throw new Error(`review ${head.id} is gone`);
    return {
      kind: 'review',
      number: row.number,
      customer: customerName(row.customer),
      rating: row.review.rating,
      comment: row.review.comment,
      since: moment(head.since),
      waitedSeconds: secondsBetween(head.since, now),
    };
  }

  private async order(id: number): Promise<OrderRow> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!o) throw new Error(`order ${id} is gone`);
    return o;
  }

  /** Who, how much, the first line as bought, how many more, and where it goes. */
  private async orderFacts(o: OrderRow) {
    const [[customer], lines] = await Promise.all([
      this.db.select().from(customers).where(eq(customers.id, o.customerId)),
      this.db
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, o.id))
        .orderBy(asc(orderLines.position)),
    ]);
    const first = lines[0];
    if (!first) throw new Error(`order ${o.number} has no lines`);
    return {
      number: o.number,
      customer: customer ? customerName(customer) : '',
      total: o.total,
      line: { name: { ru: first.nameRu, uz: first.nameUz }, ml: first.ml, qty: first.qty },
      moreLines: lines.length - 1,
      region: { ru: o.regionNameRu, uz: o.regionNameUz },
    };
  }

  // ---- the owner's strip and system line

  /**
   * Money in today: payments confirmed since Tashkent midnight up to now, and their linked credits
   * in whole so'm (the money on the card), against the same weekday a week ago up to the same time
   * of day. Net sales: #42's `salesSummary` over the last 7 days and the 7 before, whose 14 days
   * are the bars.
   */
  private async sales(now: Date): Promise<HomeSales> {
    const today = formatLocalDate(tashkentDay(now));
    const midnight = tashkentDayStart(today);
    const WEEK_MS = 7 * 86_400_000;
    const week = lastTashkentDays(7, now);
    const previous = daysEnding(formatLocalDate(addDays(parseLocalDate(week.from), -1)), 7);
    const [paidToday, paidWeekAgo, current, before] = await Promise.all([
      this.paidBetween(midnight, now),
      this.paidBetween(new Date(midnight.getTime() - WEEK_MS), new Date(now.getTime() - WEEK_MS)),
      salesSummary(this.db, week),
      salesSummary(this.db, previous),
    ]);
    return {
      paidToday,
      paidWeekAgo,
      week: { from: current.from, to: current.to, net: current.totals.net },
      previousWeek: { from: before.from, to: before.to, net: before.totals.net },
      days: [...before.days, ...current.days].map((d) => ({ day: d.day, net: d.net })),
    };
  }

  /** Orders whose payment was first confirmed within [from, to], and the credits that paid them. */
  async paidBetween(from: Date, to: Date): Promise<PaidFigures> {
    const [row] = await this.db
      .select({
        orders: sql<number>`count(*)::int`.mapWith(Number),
        // a credit with tiyin counts in whole so'm, as an order's money does (`orderMoney`)
        received: sql<number>`coalesce(sum(${credits.amountTiyin} / 100), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(orders)
      .innerJoin(credits, eq(credits.id, orders.creditId))
      .where(
        and(
          sql`${confirmedAt} >= ${from.toISOString()}::timestamptz`,
          sql`${confirmedAt} <= ${to.toISOString()}::timestamptz`,
        ),
      );
    const n = row?.orders ?? 0;
    const received = row?.received ?? 0;
    return { orders: n, received, average: averageOf(received, n) };
  }

  private async system(now: Date, paused: boolean): Promise<HomeSystem> {
    const [[beat], [backup], settings, [errors]] = await Promise.all([
      this.db.select({ at: userbotHeartbeat.seenAt }).from(userbotHeartbeat),
      this.db.select({ at: backupStatus.lastSuccessAt }).from(backupStatus),
      readSettings(this.db, ['ops.backupStaleSeconds']),
      this.db
        .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
        .from(errorEvents)
        .where(gte(errorEvents.lastSeenAt, new Date(now.getTime() - 86_400_000))),
    ]);
    const backupAt = backup?.at ?? null;
    return {
      humo: { beatSeconds: beat ? secondsBetween(beat.at, now) : null, paused },
      backup: {
        at: backupAt ? moment(backupAt) : null,
        stale:
          !backupAt ||
          now.getTime() - backupAt.getTime() > settings['ops.backupStaleSeconds'] * 1000,
      },
      errors24h: errors?.n ?? 0,
    };
  }
}
