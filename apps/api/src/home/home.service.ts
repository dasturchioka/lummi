import {
  formatLocalDate,
  HOME_QUEUES,
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
  type CreditRow,
  type Db,
  type OrderRow,
  type PaymentPauseRow,
  type StaffRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import {
  customerName,
  enteredStatus,
  firstConfirmationIn,
  paymentState,
} from '../orders/order-read';
import { matchesStockQuery, stockRows } from '../admin/stock-admin.service';
import type { Edges } from '../edges';
import { creditC, creditsFor, FREE_CREDIT } from '../payment/rules';
import { lastFour, readShopCard } from '../payment/shop-card.service';
import { orderMoney, refundOwed } from '../refunds/order-money';
import { lastTashkentDays, roundedAverage } from '../reports/report-range';
import { salesSummary } from '../reports/sales-summary';
import { awaitingDecision } from '../reviews/reviews.service';
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

/** A queue's oldest item: its row id and since when it waits. */
type Oldest = { id: number; since: Date };

/** A queue as the Home reads it: how many wait, and the oldest of them (null when none). */
type Waiting<T = Oldest> = { count: number; oldest: T | null };

type WaitingQueues = Record<Exclude<HomeQueue, 'stock' | 'credits'>, Waiting> & {
  /** The oldest free credit's whole row: the Now item is built from it. */
  credits: Waiting<CreditRow>;
};

/** The oldest unlinked credit as the Now item, from the row the queue read already. */
function creditItem(c: CreditRow, now: Date, card: { number: string } | null): HomeNow {
  return {
    kind: 'credit',
    id: c.id,
    amountTiyin: c.amountTiyin,
    at: moment(c.occurredAt),
    waitedSeconds: secondsBetween(c.occurredAt, now),
    cardLast4: c.cardLast4,
    onShopCard: card !== null && lastFour(card) === c.cardLast4,
    counterparty: c.counterparty,
  };
}

/**
 * One query per queue: the oldest row (`order by … limit 1`) with the count of all of them
 * (`count(*) over ()`, taken before the limit). An empty queue answers no row.
 */
const total = sql<number>`count(*) over ()`.mapWith(Number);
function waitingOf<T extends { n: number }>(rows: T[]): Waiting<Omit<T, 'n'>> {
  const [first] = rows;
  if (!first) return { count: 0, oldest: null };
  const { n, ...oldest } = first;
  return { count: n, oldest };
}

/** The status an order waits in for each fulfilment queue. */
const STATUS_QUEUES = {
  accept: 'payment_confirmed',
  assemble: 'accepted',
  bts: 'assembling',
} as const satisfies Partial<Record<HomeQueue, OrderStatus>>;

/**
 * The admin Home (#48): the work queue in its fixed order (`HOME_QUEUES`), each queue's count and
 * oldest item, the Now item with its facts (`pickNow`), the pause and card state; for the owner,
 * money in today and #42's net sales (`salesSummary`, the one net-sales computation), and the
 * system line. Each queue counts exactly what its list shows behind its link: the receipts the
 * orders list calls `manual_review`, the orders in a status, free credits (`FREE_CREDIT`: no order
 * holds them, nobody marked them «Не для заказа»), `refund_owed`,
 * stock `low` among visible fragrances, reviews waiting for a decision. Both roles read the shop
 * card (a manager's answer carries only whether one is set); the sales and the system line are
 * read for the owner only.
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
      this.waiting(now),
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

  private async waiting(now: Date): Promise<WaitingQueues> {
    const byStatus = (status: OrderStatus) =>
      this.db
        .select({ id: orders.id, since: enteredStatus, n: total })
        .from(orders)
        .where(eq(orders.status, status))
        .orderBy(asc(enteredStatus), asc(orders.number))
        .limit(1);
    const held = sql<Date>`min(${receipts.createdAt})`.mapWith(receipts.createdAt);
    const [receiptsHeld, accept, assemble, bts, creditsFree, refunds, reviewsWaiting] =
      await Promise.all([
        // the orders list's `manual_review`: the oldest receipt held for a person dates it
        this.db
          .select({ id: orders.id, since: held, n: total })
          .from(receipts)
          .innerJoin(orders, eq(orders.id, receipts.orderId))
          .where(
            and(eq(receipts.verdict, 'manual_review'), sql`(${paymentState}) = 'manual_review'`),
          )
          .groupBy(orders.id)
          .orderBy(asc(held), asc(orders.id))
          .limit(1),
        byStatus(STATUS_QUEUES.accept),
        byStatus(STATUS_QUEUES.assemble),
        byStatus(STATUS_QUEUES.bts),
        // «Не привязано», as the credits list reads it: no order holds it, not marked (#49)
        this.db
          .select({ credit: creditC, n: total })
          .from(creditC)
          .where(FREE_CREDIT)
          .orderBy(asc(creditC.occurredAt), asc(creditC.id))
          .limit(1),
        this.db
          .select({ id: orders.id, since: enteredStatus, n: total })
          .from(orders)
          .where(refundOwed())
          .orderBy(asc(enteredStatus), asc(orders.number))
          .limit(1),
        awaitingDecision(this.db, now).then((waiting) =>
          this.db
            .select({ id: reviews.id, since: reviews.stepAt, n: total })
            .from(reviews)
            .where(waiting)
            .orderBy(asc(reviews.stepAt), asc(reviews.id))
            .limit(1),
        ),
      ]);
    const [credit] = creditsFree;
    return {
      receipts: waitingOf(receiptsHeld),
      accept: waitingOf(accept),
      assemble: waitingOf(assemble),
      bts: waitingOf(bts),
      credits: credit ? { count: credit.n, oldest: credit.credit } : { count: 0, oldest: null },
      refunds: waitingOf(refunds),
      reviews: waitingOf(reviewsWaiting),
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
    const head = ({ count, oldest }: Waiting<{ since: Date }>): HomeQueueHead => ({
      count,
      since: oldest ? moment(oldest.since) : null,
      waitedSeconds: oldest ? secondsBetween(oldest.since, now) : null,
    });
    return {
      receipts: head(waiting.receipts),
      accept: head(waiting.accept),
      assemble: head(waiting.assemble),
      bts: head(waiting.bts),
      credits: {
        ...head({
          count: waiting.credits.count,
          oldest: waiting.credits.oldest && { since: waiting.credits.oldest.occurredAt },
        }),
        oldestAmountTiyin: waiting.credits.oldest?.amountTiyin ?? null,
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
        return this.receiptItem(waiting.receipts.oldest!, now);
      case 'accept':
      case 'assemble':
      case 'bts':
        return this.orderItem(pick, waiting[pick].oldest!, now);
      case 'credits':
        return creditItem(waiting.credits.oldest!, now, ctx.card);
      case 'refunds':
        return this.refundItem(waiting.refunds.oldest!, now);
      case 'reviews':
        return this.reviewItem(waiting.reviews.oldest!, now);
    }
  }

  private async pauseItem(pause: PaymentPauseRow, now: Date): Promise<HomeNow> {
    const [[beat], [lastCredit]] = await Promise.all([
      this.db.select({ at: userbotHeartbeat.seenAt }).from(userbotHeartbeat),
      this.db
        .select({ at: sql`max(${humoMessages.receivedAt})`.mapWith(humoMessages.receivedAt) })
        .from(credits)
        .innerJoin(humoMessages, eq(humoMessages.messageId, credits.humoMessageId)),
    ]);
    // the last sign of life the pause is about: the userbot's heartbeat, or Humo's last credit
    const signal = pause.cause === 'heartbeat' ? (beat?.at ?? null) : (lastCredit?.at ?? null);
    const since = signal && signal < pause.startedAt ? signal : pause.startedAt;
    return {
      kind: 'humo_pause',
      silentSeconds: secondsBetween(since, now),
      lastSignal: signal ? moment(signal) : null,
    };
  }

  private async receiptItem(head: Oldest, now: Date): Promise<HomeNow> {
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
        .select()
        .from(credits)
        .where(sql`${credits.id} in (${creditsFor(order.id)})`)
        .orderBy(asc(credits.occurredAt), asc(credits.id))
        .limit(1),
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
            amountTiyin: credit.amountTiyin,
            at: moment(credit.occurredAt),
            cardLast4: credit.cardLast4,
          }
        : null,
    };
  }

  private async orderItem(
    kind: 'accept' | 'assemble' | 'bts',
    head: Oldest,
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

  private async refundItem(head: Oldest, now: Date): Promise<HomeNow> {
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

  private async reviewItem(head: Oldest, now: Date): Promise<HomeNow> {
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
   * of day. Net sales: one #42 `salesSummary` over the last 14 days (today included); its days are
   * the bars, and its last 7 and first 7 days are «Чистые продажи, 7 дней» and the week before.
   */
  private async sales(now: Date): Promise<HomeSales> {
    const today = formatLocalDate(tashkentDay(now));
    const midnight = tashkentDayStart(today);
    const WEEK_MS = 7 * 86_400_000;
    const [paidToday, paidWeekAgo, fortnight] = await Promise.all([
      this.paidBetween(midnight, now),
      this.paidBetween(new Date(midnight.getTime() - WEEK_MS), new Date(now.getTime() - WEEK_MS)),
      salesSummary(this.db, lastTashkentDays(14, now)),
    ]);
    const days = fortnight.days.map((d) => ({ day: d.day, net: d.net }));
    const week = (part: typeof days) => ({
      from: part[0]!.day,
      to: part.at(-1)!.day,
      net: part.reduce((sum, d) => sum + d.net, 0),
    });
    return {
      paidToday,
      paidWeekAgo,
      week: week(days.slice(7)),
      previousWeek: week(days.slice(0, 7)),
      days,
    };
  }

  /**
   * Orders whose payment was first confirmed within [from, to], and the credits that paid them.
   * It reads the confirmations in that stretch (`order_events_confirmed_idx`) and keeps each
   * order's first one only (`firstConfirmationIn`, the rule the orders list's `paidOn` filter
   * shares, so the cards open exactly the orders they count). `to` is included.
   */
  async paidBetween(from: Date, to: Date): Promise<PaidFigures> {
    const { rows } = await this.db.execute<{ orders: number; received: string }>(sql`
      select count(*)::int as orders, coalesce(sum(c.amount_tiyin / 100), 0)::bigint as received
      from ${orderEvents} e
      join ${orders} o on o.id = e.order_id
      join ${credits} c on c.id = o.credit_id
      where ${firstConfirmationIn(from, new Date(to.getTime() + 1))}`);
    const n = Number(rows[0]?.orders ?? 0);
    // a credit with tiyin counts in whole so'm, as an order's money does (`orderMoney`)
    const received = Number(rows[0]?.received ?? 0);
    return { orders: n, received, average: roundedAverage(received, n) };
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
