import {
  addDays,
  BOARD_COLUMN_LIMIT,
  BOARD_HISTORY_STATUSES,
  BOARD_RECENT_DAYS,
  BOARD_STATUSES,
  CREDIT_OPTIONS_LIMIT,
  formatLocalDate,
  tashkentDay,
  type AdminBoardCardDto,
  type AdminOrdersBoardDto,
  type AdminOrdersBoardQuery,
  lastDayOf,
  ORDER_NUMBER_MAX,
  PAYMENT_LINK_REASON_MIN,
  tashkentDayStart as dayStart,
  RECEIPT_REJECT_REASONS,
  type AdminCreditDto,
  type AdminCreditsPageDto,
  type AdminCreditsQuery,
  type AdminOrderDto,
  type AdminOrderEventDto,
  type AdminOrderListItemDto,
  type AdminOrdersPageDto,
  type AdminOrdersQuery,
  type AdminReceiptDto,
  type CreditLinkFilter,
  type CreditOptionsDto,
  type ReceiptCheckDto,
  type StaffConfirmBody,
  type FulfilBody,
  type PaymentState,
  type ReceiptRejectReason,
  type RefundBody,
  type RejectReceiptBody,
  type StaffCancelBody,
  type StaffReturnBody,
  type TransitionRefusal,
} from '@lummi/contracts';
import {
  and,
  asc,
  credits,
  customers,
  desc,
  eq,
  inArray,
  orderEvents,
  orderLines,
  orders,
  receiptChecks,
  receipts,
  sql,
  staff,
  type CreditRow,
  type Db,
  type OrderRow,
  type SQL,
} from '@lummi/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditQueryService } from '../audit/audit-query.service';
import { ReviewsService } from '../reviews/reviews.service';
import { cancellationOf } from '../order-status/history';
import { OrderStatusService, type TransitionOutcome } from '../order-status/order-status.service';
import { customerName, enteredStatus, PAID_BY, paymentState } from '../orders/order-read';
import { linesOf, toOrderDto } from '../orders/orders.service';
import { PaymentConfirmation, type ConfirmPaymentOutcome } from '../payment/payment-confirmation';
import { ReceiptRejection, type RejectReceiptOutcome } from '../payment/receipt-rejection';
import { CreditMarks, type CreditMarkOutcome } from '../payment/credit-marks';
import {
  ACCEPTED_VERDICTS,
  creditC,
  creditsFor,
  FREE_CREDIT,
  NOT_FOR_ORDER,
  UNLINKED,
} from '../payment/rules';
import { heldEntitlement } from '../entitlements/entitlements';
import { readShopCard } from '../payment/shop-card.service';
import { orderMoney, refundOwed, refundedSum, refundsOf } from '../refunds/order-money';
import { Refunds } from '../refunds/refunds';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES } from '../tokens';
import type { Edges } from '../edges';
import { rightsOpenedBy } from '../upgrade-rights/upgrade-rights';

type ListQuery = { page: number; pageSize: number } & Omit<AdminOrdersQuery, 'page' | 'pageSize'>;
type CreditsQuery = {
  page: number;
  pageSize: number;
  linked: CreditLinkFilter;
} & Omit<AdminCreditsQuery, 'page' | 'pageSize' | 'linked'>;

/** What a staff move on an order answers (#33): the order page now, or why not. */
export type MoveOutcome =
  | { kind: 'done'; order: AdminOrderDto }
  | { kind: 'not_found' }
  /**
   * The order, the receipt or the credit moved on meanwhile (another manager, the AI, the
   * shopper, a sweep): nothing changed; the page as it is now.
   */
  | {
      kind: 'conflict';
      code: 'status_changed' | 'receipt_changed' | 'credit_taken' | 'refunds_changed';
      order: AdminOrderDto;
    }
  | {
      kind: 'refused';
      code:
        | TransitionRefusal
        | 'note_too_long'
        | 'reason_required'
        | 'reason_invalid'
        | 'credit_mismatch'
        | 'not_paid'
        | 'refund_too_large'
        | 'invalid_date';
      min?: number;
      max?: number;
      mismatch?: ('amount' | 'card')[];
      what?: 'before_order' | 'amount' | 'card';
    }
  | { kind: 'try_again' };

/** What a «Не для заказа» unmark answers (#49): the credit as it is now, or why not. */
export type CreditUnmarkAnswer =
  | { kind: 'done' | 'credit_taken' | 'credit_changed'; credit: AdminCreditDto }
  | { kind: 'not_found' };
/** What a «Не для заказа» mark answers (#49): as an unmark, or a note over the setting. */
export type CreditMarkAnswer = CreditUnmarkAnswer | { kind: 'note_too_long'; max: number };

/** The digits of a phone as stored (E.164 with `+`), for a search by part of the number. */
const digitsOf = (column: unknown) =>
  sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;

/** A number the column can hold: anything longer is no order, so 404 rather than a DB error. */
const knownNumber = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= ORDER_NUMBER_MAX;

/**
 * The orders list's filters as conditions on `orders` joined with `customers` (the list and the
 * board read them alike), and the order number the search names, which the list puts first.
 */
export function orderFilters(q: Omit<ListQuery, 'page' | 'pageSize'>): {
  conditions: SQL[];
  byNumber: number | null;
} {
  const conditions: SQL[] = [];
  if (q.status) conditions.push(eq(orders.status, q.status));
  if (q.payment === 'refund_owed') conditions.push(refundOwed());
  else if (q.payment) conditions.push(sql`(${paymentState}) = ${q.payment}`);
  if (q.from) conditions.push(sql`${orders.createdAt} >= ${dayStart(q.from).toISOString()}`);
  if (q.to) conditions.push(sql`${orders.createdAt} < ${dayStart(q.to, 1).toISOString()}`);
  const digits = q.q?.replace(/\D/g, '') ?? null;
  // an order number fits in nine digits; a phone is searched by four digits or more
  const byNumber = digits && Number(digits) <= ORDER_NUMBER_MAX ? Number(digits) : null;
  if (digits !== null) {
    const matches = [];
    if (byNumber !== null) matches.push(eq(orders.number, byNumber));
    if (digits.length >= 4)
      matches.push(
        sql`${digitsOf(orders.recipientPhone)} like ${`%${digits}%`}`,
        sql`${digitsOf(customers.phone)} like ${`%${digits}%`}`,
      );
    conditions.push(matches.length > 0 ? sql`(${sql.join(matches, sql` or `)})` : sql`false`);
  }
  return { conditions, byNumber };
}

/**
 * The admin orders panel (#33): the list and the order page staff resolve any question from, the
 * credits list, and the staff moves. Every move goes through `transition()` (ADR 0011) with the
 * staff member as the actor; a rejection goes through `ReceiptRejection`, which also gives the
 * receipt its verdict.
 */
@Injectable()
export class AdminOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(ReceiptRejection) private readonly rejection: ReceiptRejection,
    @Inject(PaymentConfirmation) private readonly payments: PaymentConfirmation,
    @Inject(AuditQueryService) private readonly auditQuery: AuditQueryService,
    @Inject(Refunds) private readonly refunds: Refunds,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(CreditMarks) private readonly marks: CreditMarks,
  ) {}

  /** Newest first. A search puts the order with that number first, then phone matches. */
  async list(q: ListQuery): Promise<AdminOrdersPageDto> {
    const { conditions, byNumber } = orderFilters(q);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where);
    const refunded = refundedSum();
    const rows = await this.db
      .select({ order: orders, customer: customers, payment: paymentState, refunded })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(
        ...(byNumber !== null ? [sql`${orders.number} = ${byNumber} desc`] : []),
        desc(orders.number),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const lines =
      rows.length === 0
        ? []
        : await this.db
            .select()
            .from(orderLines)
            .where(
              inArray(
                orderLines.orderId,
                rows.map((r) => r.order.id),
              ),
            )
            .orderBy(asc(orderLines.orderId), asc(orderLines.position));
    const items = rows.map(
      ({ order: o, customer: c, payment, refunded }): AdminOrderListItemDto => {
        const own = lines.filter((l) => l.orderId === o.id);
        const first = own[0];
        if (!first) throw new Error(`order ${o.number} has no lines`);
        return {
          number: o.number,
          status: o.status,
          payment,
          createdAt: o.createdAt.toISOString(),
          total: o.total,
          itemCount: own.reduce((n, l) => n + l.qty, 0),
          firstLine: { name: { ru: first.nameRu, uz: first.nameUz }, ml: first.ml, qty: first.qty },
          lineCount: own.length,
          customer: { id: c.id, name: customerName(c), phone: c.phone },
          recipient: { name: o.recipientName, phone: o.recipientPhone },
          region: { ru: o.regionNameRu, uz: o.regionNameUz },
          isGift: o.isGift,
          refunded,
        };
      },
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * The orders board (#52): for each status in the funnel's order, how many orders are in it and
   * their totals, and its first `limit` cards: the work columns put the longest wait first, the
   * history columns (delivered, cancelled, returned) hold only the last `BOARD_RECENT_DAYS`
   * Tashkent days, newest first. The list's search, payment state and dates narrow every column.
   */
  async board(q: AdminOrdersBoardQuery, limit = BOARD_COLUMN_LIMIT): Promise<AdminOrdersBoardDto> {
    const now = this.edges.clock.now();
    const firstDay = formatLocalDate(addDays(tashkentDay(now), -(BOARD_RECENT_DAYS - 1)));
    const history = sql`"orders"."status" in (${sql.join(
      BOARD_HISTORY_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    )})`;
    const recent = sql`(not ${history} or ${enteredStatus} >= ${dayStart(firstDay).toISOString()})`;
    const where = and(...orderFilters(q).conditions, recent);

    const totals = await this.db
      .select({
        status: orders.status,
        count: sql<number>`count(*)::int`.mapWith(Number),
        sum: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`.mapWith(Number),
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .groupBy(orders.status);

    // one rank per column: oldest in status first, or newest first in a history column
    const rank = sql<number>`row_number() over (partition by "orders"."status" order by
      case when ${history} then -extract(epoch from ${enteredStatus}) else extract(epoch from ${enteredStatus}) end,
      case when ${history} then -"orders"."number" else "orders"."number" end)`;
    const ranked = this.db
      .select({ id: orders.id, rank: rank.as('rank') })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .as('ranked');
    const items =
      sql<number>`(select coalesce(sum(l.qty), 0) from ${orderLines} l where l.order_id = "orders"."id")`.mapWith(
        Number,
      );
    const rows = await this.db
      .select({
        order: orders,
        customer: customers,
        payment: paymentState,
        owed: sql<boolean>`(${refundOwed()})`,
        since: enteredStatus,
        items,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(ranked, eq(ranked.id, orders.id))
      .where(sql`${ranked.rank} <= ${limit}`)
      .orderBy(ranked.rank);

    return {
      at: now.toISOString(),
      recentDays: BOARD_RECENT_DAYS,
      limit,
      columns: BOARD_STATUSES.map((status) => {
        const total = totals.find((x) => x.status === status);
        return {
          status,
          count: total?.count ?? 0,
          sum: total?.sum ?? 0,
          cards: rows
            .filter((r) => r.order.status === status)
            .map(({ order: o, customer: c, payment, owed, since, items }): AdminBoardCardDto => ({
              number: o.number,
              status: o.status,
              payment,
              refundOwed: owed,
              statusSince: since.toISOString(),
              total: o.total,
              itemCount: items,
              customer: { name: customerName(c) },
              city: o.pointCity,
              region: { ru: o.regionNameRu, uz: o.regionNameUz },
              isGift: o.isGift,
            })),
        };
      }),
    };
  }

  /** The order page by its number; null when there is no such order. */
  async page(number: number): Promise<AdminOrderDto | null> {
    if (!knownNumber(number)) return null;
    const [o] = await this.db.select().from(orders).where(eq(orders.number, number));
    return o ? this.pageOf(o) : null;
  }

  private async pageOf(o: OrderRow): Promise<AdminOrderDto> {
    const [[customer], [{ payment } = { payment: 'unpaid' as PaymentState }], events, rows] =
      await Promise.all([
        this.db.select().from(customers).where(eq(customers.id, o.customerId)),
        this.db.select({ payment: paymentState }).from(orders).where(eq(orders.id, o.id)),
        this.events(o.id),
        this.db
          .select()
          .from(receipts)
          .where(eq(receipts.orderId, o.id))
          .orderBy(desc(receipts.createdAt), desc(receipts.id)),
      ]);
    if (!customer) throw new Error(`order ${o.number} has no customer`);
    const limits = await readSettings(this.db, [
      'receipts.rejectNoteMaxLength',
      'payments.linkReasonMaxLength',
    ]);
    const checks =
      rows.length === 0
        ? []
        : await this.db
            .select()
            .from(receiptChecks)
            .where(
              inArray(
                receiptChecks.receiptId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(desc(receiptChecks.id));
    const confirmations = events.filter((e) => e.action === PAID_BY);
    const card = await readShopCard(this.db);
    return {
      order: toOrderDto(o, await linesOf(this.db, o.id), await cancellationOf(this.db, o.id)),
      shopCardLast4: card?.number.slice(-4) ?? null,
      trackingNumber: o.trackingNumber,
      payment,
      customer: {
        id: customer.id,
        telegramId: customer.telegramId,
        name: customerName(customer),
        username: customer.username,
        phone: customer.phone,
        language: customer.language,
      },
      receipts: rows.map((r): AdminReceiptDto => {
        const rejected = events.findLast(
          (e) => e.action === 'reject_receipt' && e.receiptId === r.id,
        );
        if (rejected && rejected.actor.id === null)
          throw new Error(`order ${o.number}: a rejection without its manager`);
        const confirmed = confirmations.findLast((e) => e.receiptId === r.id);
        return {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          source: r.source,
          verdict: r.verdict,
          fileName: r.fileName,
          kind: r.kind,
          size: r.size,
          width: r.width,
          height: r.height,
          reviewReason: r.reviewReason,
          checks: checks.filter((c) => c.receiptId === r.id).map(toCheckDto),
          confirmation:
            ACCEPTED_VERDICTS.includes(r.verdict) && confirmed
              ? { by: confirmerOf(confirmed), at: confirmed.at }
              : null,
          rejection:
            r.verdict === 'rejected' && rejected
              ? {
                  reason: rejectReason(rejected.reason),
                  note: rejected.note,
                  by: { id: rejected.actor.id!, name: rejected.actor.name },
                  at: rejected.at,
                }
              : null,
        };
      }),
      credit: await this.matchedCredit(o, confirmations.at(-1)),
      money: await orderMoney(this.db, o),
      refunds: await refundsOf(this.db, o.id),
      returned: returnedOf(o, events),
      returnPreview: o.status === 'delivered' ? await this.returnPreview(o) : null,
      // the page's history as the contract has it: the link details stay with the credit
      review: await this.reviews.ofOrder(o.id),
      events: events.map(({ creditId: _credit, link: _link, returnLines: _lines, ...e }) => e),
      audit: await this.auditQuery.forTarget('order', o.id),
      limits: {
        rejectNoteMax: limits['receipts.rejectNoteMaxLength'],
        linkReasonMin: PAYMENT_LINK_REASON_MIN,
        linkReasonMax: limits['payments.linkReasonMaxLength'],
      },
    };
  }

  /** The Credit that paid the order (#32 links it), with how its confirmation recorded the link. */
  private async matchedCredit(
    o: OrderRow,
    confirmed: EventRow | undefined,
  ): Promise<AdminOrderDto['credit']> {
    if (o.creditId === null) return null;
    const [c] = await this.db.select().from(credits).where(eq(credits.id, o.creditId));
    if (!c || !confirmed)
      throw new Error(`order ${o.number}: a credit link without its confirmation`);
    const card = await readShopCard(this.db);
    return {
      ...toCreditDto(c, card?.number.slice(-4) ?? null, { number: o.number }),
      link: {
        differenceTiyin: confirmed.link?.differenceTiyin ?? c.amountTiyin - o.amountDue * 100,
        offShopCard: confirmed.link?.offShopCard ?? false,
        reason: confirmed.reason,
        by: confirmerOf(confirmed),
        at: confirmed.at,
      },
    };
  }

  /** The order's history, oldest first, with the actor's name. */
  private async events(orderId: number): Promise<EventRow[]> {
    const rows = await this.db
      .select({
        e: orderEvents,
        staffName: staff.name,
        customerFirst: customers.firstName,
        customerLast: customers.lastName,
      })
      .from(orderEvents)
      .leftJoin(
        staff,
        sql`${orderEvents.actorType} = 'staff' and ${orderEvents.actorId} = ${staff.id}`,
      )
      .leftJoin(
        customers,
        sql`${orderEvents.actorType} = 'customer' and ${orderEvents.actorId} = ${customers.id}`,
      )
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.id));
    return rows.map(({ e, staffName, customerFirst, customerLast }) => {
      const p = e.payload;
      const text = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        id: e.id,
        at: e.createdAt.toISOString(),
        from: e.fromStatus,
        to: e.toStatus,
        action: e.action,
        actor: {
          type: e.actorType,
          id: e.actorId,
          name:
            staffName ??
            (customerFirst === null
              ? null
              : customerName({ firstName: customerFirst, lastName: customerLast })),
        },
        reason: e.reason,
        note: text(p.note),
        trackingNumber: text(p.trackingNumber),
        receiptId: typeof p.receiptId === 'number' ? p.receiptId : null,
        creditId: typeof p.creditId === 'number' ? p.creditId : null,
        ...(e.action === 'return' ? { returnLines: returnLinesOf(p.lines) ?? undefined } : {}),
        ...(e.action === PAID_BY
          ? {
              link: {
                differenceTiyin: typeof p.differenceTiyin === 'number' ? p.differenceTiyin : 0,
                offShopCard: p.offShopCard === true,
              },
            }
          : {}),
      };
    });
  }

  /**
   * Credits newest first: the order each paid, or «Не привязано» (no order holds it and nobody
   * marked it, `FREE_CREDIT`), or «Не для заказа» with who marked it, when and why (#49).
   */
  async credits(q: CreditsQuery): Promise<AdminCreditsPageDto> {
    const c = creditC;
    const conditions: SQL[] = [];
    if (q.linked === 'linked') conditions.push(sql`not (${UNLINKED})`);
    if (q.linked === 'unlinked') conditions.push(FREE_CREDIT);
    if (q.linked === 'not_for_order') conditions.push(NOT_FOR_ORDER);
    if (q.amount !== undefined) conditions.push(eq(c.amountSom, q.amount));
    if (q.from) conditions.push(sql`${c.occurredAt} >= ${dayStart(q.from).toISOString()}`);
    if (q.to) conditions.push(sql`${c.occurredAt} < ${dayStart(q.to, 1).toISOString()}`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [[{ total } = { total: 0 }], rows, card, limits] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(c)
        .where(where),
      this.db
        .select({ credit: c, number: orders.number, markedBy: staff.name })
        .from(c)
        .leftJoin(orders, eq(orders.creditId, c.id))
        .leftJoin(staff, eq(staff.id, c.notForOrderBy))
        .where(where)
        .orderBy(desc(c.occurredAt), desc(c.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      readShopCard(this.db),
      readSettings(this.db, ['payments.creditMarkNoteMaxLength']),
    ]);
    const last4 = card?.number.slice(-4) ?? null;
    return {
      items: rows.map((r) =>
        toCreditDto(r.credit, last4, r.number === null ? null : { number: r.number }, r.markedBy),
      ),
      total,
      page: q.page,
      pageSize: q.pageSize,
      limits: { markNoteMax: limits['payments.creditMarkNoteMaxLength'] },
    };
  }

  /** «Не для заказа» (#49) through `CreditMarks`, by this staff member: the credit as it is now. */
  async markNotForOrder(staffId: number, id: number, note?: string): Promise<CreditMarkAnswer> {
    const out = await this.marks.mark(staffId, id, note);
    return out.kind === 'not_found' || out.kind === 'note_too_long' ? out : this.creditAnswer(out);
  }

  /** «Вернуть в поступления» (#49): the mark comes off; the credit as it is now. */
  async unmarkNotForOrder(staffId: number, id: number): Promise<CreditUnmarkAnswer> {
    const out = await this.marks.unmark(staffId, id);
    return out.kind === 'not_found' ? out : this.creditAnswer(out);
  }

  private async creditAnswer(
    out: Exclude<CreditMarkOutcome, { kind: 'not_found' | 'note_too_long' }>,
  ): Promise<CreditUnmarkAnswer> {
    return { kind: out.kind, credit: await this.creditDto(out.credit) };
  }

  /** One credit as the list shows it: the order it paid, or its mark with who set it. */
  private async creditDto(c: CreditRow): Promise<AdminCreditDto> {
    const [[payer], [marker], card] = await Promise.all([
      this.db.select({ number: orders.number }).from(orders).where(eq(orders.creditId, c.id)),
      c.notForOrderBy === null
        ? Promise.resolve([])
        : this.db.select({ name: staff.name }).from(staff).where(eq(staff.id, c.notForOrderBy)),
      readShopCard(this.db),
    ]);
    return toCreditDto(c, card?.number.slice(-4) ?? null, payer ?? null, marker?.name ?? null);
  }

  /**
   * The credits a manager may link to the order: its Candidate credits (#32's rule, `rules.ts`),
   * oldest first, then the other free credits from the order's minute on, newest first. One from
   * before the order never pays it, and one marked «Не для заказа» pays none (#49): neither is
   * offered.
   */
  async creditOptions(number: number): Promise<CreditOptionsDto | null> {
    if (!knownNumber(number)) return null;
    const [o] = await this.db.select().from(orders).where(eq(orders.number, number));
    if (!o) return null;
    const over = (which: 'candidates' | 'others') =>
      sql`${credits.id} in (${creditsFor(o.id, which)})`;
    const [candidates, others, [{ total } = { total: 0 }], card] = await Promise.all([
      this.db
        .select()
        .from(credits)
        .where(over('candidates'))
        .orderBy(asc(credits.occurredAt), asc(credits.id))
        .limit(CREDIT_OPTIONS_LIMIT),
      this.db
        .select()
        .from(credits)
        .where(over('others'))
        .orderBy(desc(credits.occurredAt), desc(credits.id))
        .limit(CREDIT_OPTIONS_LIMIT),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(credits)
        .where(over('others')),
      readShopCard(this.db),
    ]);
    const last4 = card?.number.slice(-4) ?? null;
    const option = (c: typeof credits.$inferSelect) => ({
      ...toCreditDto(c, last4, null),
      differenceTiyin: c.amountTiyin - o.amountDue * 100,
    });
    return {
      amountDue: o.amountDue,
      candidates: candidates.map(option),
      others: others.map(option),
      othersTotal: total,
    };
  }

  /**
   * Links the credit the manager picked and confirms the payment through #32's one door,
   * `PaymentConfirmation` (actor: that staff member): with the order's waiting receipt, or none
   * while the order is «Ожидает оплаты». A credit of another amount or card needs a reason.
   */
  async confirmPayment(
    staffId: number,
    number: number,
    body: StaffConfirmBody,
  ): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const out: ConfirmPaymentOutcome = await this.payments.confirmPayment({
      orderId: id,
      creditId: body.creditId,
      receiptId: body.receiptId,
      actor: { type: 'staff', id: staffId },
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    const now = async () => {
      const [o] = await this.db.select().from(orders).where(eq(orders.id, id));
      return this.pageOf(o!);
    };
    switch (out.kind) {
      case 'confirmed':
        return { kind: 'done', order: await this.pageOf(out.order) };
      case 'conflict':
        return { kind: 'conflict', code: 'status_changed', order: await this.pageOf(out.order) };
      case 'credit_taken':
        return { kind: 'conflict', code: 'credit_taken', order: await now() };
      case 'receipt_not_waiting':
      case 'duplicate_receipt':
        return { kind: 'conflict', code: 'receipt_changed', order: await now() };
      case 'reason_required':
        return { kind: 'refused', code: 'reason_required', mismatch: out.mismatch };
      case 'reason_invalid':
        return { kind: 'refused', code: 'reason_invalid', min: out.min, max: out.max };
      case 'credit_mismatch':
        return { kind: 'refused', code: 'credit_mismatch', what: out.what };
      case 'refused':
        return { kind: 'refused', code: out.code };
      case 'not_found':
        return { kind: 'not_found' };
      case 'try_again':
        return { kind: 'try_again' };
    }
  }

  /** One fulfilment step, by a staff member, from the status they saw. */
  async fulfil(staffId: number, number: number, body: FulfilBody): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const actor = { type: 'staff' as const, id: staffId };
    const out =
      body.action === 'hand_to_bts'
        ? await this.status.transition(id, 'hand_to_bts', actor, body.expectedStatus, {
            trackingNumber: body.trackingNumber,
          })
        : await this.status.transition(id, body.action, actor, body.expectedStatus, undefined);
    return this.answer(out);
  }

  /** A staff cancel with a TZ §6 reason (and a note kept in the history). */
  async cancel(staffId: number, number: number, body: StaffCancelBody): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const out = await this.status.transition(
      id,
      'cancel',
      { type: 'staff', id: staffId },
      body.expectedStatus,
      { reason: body.reason, ...(body.note ? { note: body.note } : {}) },
    );
    return this.answer(out);
  }

  /** The receipt the manager looked at, turned down with a reason the shopper reads. */
  async rejectReceipt(
    staffId: number,
    number: number,
    body: RejectReceiptBody,
  ): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const out: RejectReceiptOutcome = await this.rejection.reject({
      orderId: id,
      receiptId: body.receiptId,
      reason: body.reason,
      note: body.note,
      staffId,
    });
    switch (out.kind) {
      case 'rejected':
        return { kind: 'done', order: await this.pageOf(out.order) };
      case 'conflict':
        return { kind: 'conflict', code: 'status_changed', order: await this.pageOf(out.order) };
      case 'receipt_changed':
        return { kind: 'conflict', code: 'receipt_changed', order: await this.pageOf(out.order) };
      case 'note_too_long':
        return { kind: 'refused', code: 'note_too_long', max: out.max };
      case 'refused':
        return { kind: 'refused', code: out.code };
      case 'not_found':
        return { kind: 'not_found' };
      case 'try_again':
        return { kind: 'try_again' };
    }
  }

  /**
   * The whole delivered order came back (ADR 0006): «Возвращён» through `transition()`, with the
   * staff member's reason and a back-to-stock flag per line. On hand, the discount source and the
   * rights the order opened follow in the move (`EFFECTS.return`, ADR 0005, 0010).
   */
  async returnOrder(staffId: number, number: number, body: StaffReturnBody): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const { expectedStatus, ...payload } = body;
    const out = await this.status.transition(
      id,
      'return',
      { type: 'staff', id: staffId },
      expectedStatus,
      payload,
    );
    return this.answer(out);
  }

  /**
   * What a return of this delivered order would do now (ADR 0005, 0010), read by the same rules
   * the move writes with: the lines to flag, the discount source it holds and whether it comes
   * back, and the upgrade rights it opened, which close.
   */
  private async returnPreview(o: OrderRow): Promise<NonNullable<AdminOrderDto['returnPreview']>> {
    const now = this.edges.clock.now();
    const lines = await linesOf(this.db, o.id);
    return {
      lines: lines.map((l) => ({ position: l.position })),
      discount: await this.heldDiscount(o, now),
      rights: await rightsOpenedBy(this.db, o.id, now),
    };
  }

  private async heldDiscount(
    o: OrderRow,
    now: Date,
  ): Promise<NonNullable<AdminOrderDto['returnPreview']>['discount']> {
    const d = o.discount;
    if (d === null) return null;
    if (d.type === 'promo_code') return { type: 'promo_code', code: d.code };
    const held = await heldEntitlement(this.db, d, o.id, now);
    if (!held) return null;
    return {
      type: d.type,
      lost: held.lost,
      lastDay: formatLocalDate(lastDayOf(held.expiresAt)),
    };
  }

  /**
   * A Refund on a paid order (ADR 0006), recorded by the staff member: the amount, the day it was
   * sent and why. The status, the history and every discount stay as they are.
   */
  async refund(staffId: number, number: number, body: RefundBody): Promise<MoveOutcome> {
    const id = await this.idOf(number);
    if (id === null) return { kind: 'not_found' };
    const out = await this.refunds.record({ orderId: id, staffId, ...body });
    switch (out.kind) {
      case 'recorded':
        return { kind: 'done', order: await this.pageOf(out.order) };
      case 'refunds_changed':
        return { kind: 'conflict', code: 'refunds_changed', order: await this.pageOf(out.order) };
      case 'too_large':
        return { kind: 'refused', code: 'refund_too_large', max: out.max };
      case 'not_paid':
        return { kind: 'refused', code: 'not_paid' };
      case 'invalid_date':
        return { kind: 'refused', code: 'invalid_date' };
      case 'not_found':
      case 'try_again':
        return { kind: out.kind };
    }
  }

  private async idOf(number: number): Promise<number | null> {
    if (!knownNumber(number)) return null;
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.number, number));
    return row?.id ?? null;
  }

  private async answer(out: TransitionOutcome): Promise<MoveOutcome> {
    switch (out.kind) {
      case 'done':
        return { kind: 'done', order: await this.pageOf(out.order) };
      case 'conflict':
        return { kind: 'conflict', code: 'status_changed', order: await this.pageOf(out.order) };
      case 'refused':
        return { kind: 'refused', code: out.code };
      case 'not_found':
      case 'try_again':
        return { kind: out.kind };
    }
  }
}

/** A rejection event's reason as a preset; an unknown one (never written) is `other`. */
function rejectReason(reason: string | null): ReceiptRejectReason {
  return RECEIPT_REJECT_REASONS.includes(reason as ReceiptRejectReason)
    ? (reason as ReceiptRejectReason)
    : 'other';
}

export function toCreditDto(
  c: typeof credits.$inferSelect,
  shopCardLast4: string | null,
  order: { number: number } | null,
  /** The name of the staff member who marked it «Не для заказа»; null once they were removed. */
  markedBy: string | null = null,
): AdminCreditDto {
  return {
    id: c.id,
    occurredAt: c.occurredAt.toISOString(),
    amountTiyin: c.amountTiyin,
    amountSom: c.amountSom ?? null,
    cardMask: c.cardMask,
    cardLast4: c.cardLast4,
    onShopCard: shopCardLast4 !== null && c.cardLast4 === shopCardLast4,
    counterparty: c.counterparty,
    order,
    notForOrder:
      c.notForOrderAt !== null && c.notForOrderBy !== null
        ? {
            at: c.notForOrderAt.toISOString(),
            by: { id: c.notForOrderBy, name: markedBy },
            note: c.notForOrderNote,
          }
        : null,
  };
}

/**
 * A history row as the page reads it, with a confirmation's link details kept for the credit and
 * a return's per-line flags kept for the Return.
 */
type EventRow = AdminOrderEventDto & {
  creditId: number | null;
  link?: { differenceTiyin: number; offShopCard: boolean };
  returnLines?: NonNullable<AdminOrderDto['returned']>['lines'];
};

const log = new Logger('AdminOrders');

/**
 * A return's recorded flags (`order_events.payload.lines`, as `transition()` wrote them, in the
 * order staff sent them), by position: the order of `order.lines`. Null when the payload has
 * another shape.
 */
function returnLinesOf(raw: unknown): NonNullable<AdminOrderDto['returned']>['lines'] | null {
  if (!Array.isArray(raw)) return null;
  const lines: NonNullable<AdminOrderDto['returned']>['lines'] = [];
  for (const l of raw as { position?: unknown; backToStock?: unknown }[]) {
    if (typeof l?.position !== 'number' || typeof l.backToStock !== 'boolean') return null;
    lines.push({ position: l.position, backToStock: l.backToStock });
  }
  return lines.sort((a, b) => a.position - b.position);
}

/**
 * The Return of a «Возвращён» order, from its history: who, when, why, which lines went back. A
 * history row that does not say so (written by hand, an older shape) is logged and the page shows
 * the order without the Return block rather than not at all.
 */
function returnedOf(o: OrderRow, events: EventRow[]): AdminOrderDto['returned'] {
  if (o.status !== 'returned') return null;
  const e = events.findLast((x) => x.action === 'return');
  if (!e || e.actor.id === null || !e.returnLines || e.reason === null) {
    log.warn(`order ${o.number}: returned, but its history does not say how; no Return shown`);
    return null;
  }
  return {
    reason: e.reason,
    at: e.at,
    by: { id: e.actor.id, name: e.actor.name },
    lines: e.returnLines,
  };
}

/** Who confirmed a payment, from its history row: the receipt AI or a staff member. */
function confirmerOf(e: AdminOrderEventDto): NonNullable<AdminReceiptDto['confirmation']>['by'] {
  if (e.actor.type === 'ai') return { type: 'ai' };
  if (e.actor.type === 'staff' && e.actor.id !== null)
    return { type: 'staff', id: e.actor.id, name: e.actor.name };
  throw new Error(`event ${e.id}: a payment confirmed by ${e.actor.type}`);
}

/** One stored answer of the receipt AI, as the page shows it (read-only). */
function toCheckDto(c: typeof receiptChecks.$inferSelect): ReceiptCheckDto {
  const j = c.judgement;
  return {
    id: c.id,
    at: c.createdAt.toISOString(),
    candidates: c.candidateCreditIds.length,
    provider: j.provider,
    isReceipt: j.isReceipt,
    amountMatches: j.amountMatches,
    recipientMatches: j.recipientMatches,
    choiceConfidence: j.choiceConfidence,
    chosenCreditId: j.chosenCreditId,
    confirmed: j.confirmed,
    reason: j.reason ?? null,
    outcome: c.outcome,
  };
}
