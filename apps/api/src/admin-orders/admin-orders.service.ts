import {
  ORDER_NUMBER_MAX,
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
  type FulfilBody,
  type OrderAction,
  type OrderStatus,
  type PaymentState,
  type ReceiptVerdict,
  type ReceiptRejectReason,
  type RejectReceiptBody,
  type StaffCancelBody,
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
  receipts,
  sql,
  staff,
  type Db,
  type OrderRow,
} from '@lummi/db';
import { Inject, Injectable } from '@nestjs/common';
import { AuditQueryService } from '../audit/audit-query.service';
import { cancellationOf } from '../order-status/history';
import { OrderStatusService, type TransitionOutcome } from '../order-status/order-status.service';
import { linesOf, toOrderDto } from '../orders/orders.service';
import { ReceiptRejection, type RejectReceiptOutcome } from '../payment/receipt-rejection';
import { readShopCard } from '../payment/shop-card.service';
import { readSettings } from '../settings/settings.service';
import { DB } from '../tokens';

type ListQuery = { page: number; pageSize: number } & Omit<AdminOrdersQuery, 'page' | 'pageSize'>;
type CreditsQuery = {
  page: number;
  pageSize: number;
  linked: 'all' | 'unlinked' | 'linked';
} & Omit<AdminCreditsQuery, 'page' | 'pageSize' | 'linked'>;

/** What a staff move on an order answers (#33): the order page now, or why not. */
export type MoveOutcome =
  | { kind: 'done'; order: AdminOrderDto }
  | { kind: 'not_found' }
  /** The order (or the receipt) moved on meanwhile: nothing changed; the page as it is now. */
  | { kind: 'conflict'; code: 'status_changed' | 'receipt_changed'; order: AdminOrderDto }
  | { kind: 'refused'; code: TransitionRefusal | 'note_too_long'; max?: number }
  | { kind: 'try_again' };

/** The words of the one payment-state rule, typed against their enums. */
const PAID_BY: OrderAction = 'confirm_payment';
const UNDER_CHECK: OrderStatus = 'receipt_review';
const HELD: ReceiptVerdict = 'manual_review';
const STATE = {
  paid: 'paid',
  manual_review: 'manual_review',
  checking: 'checking',
  unpaid: 'unpaid',
} as const satisfies Record<PaymentState, PaymentState>;

/**
 * Where an order's money stands (contracts `PAYMENT_STATES`, the one definition): paid once a
 * payment was confirmed, whatever came after; otherwise what its receipt under check waits for.
 * The columns are named with their table: in a one-table select Drizzle leaves the table out, and
 * a bare `id` inside the subqueries would be theirs.
 */
const paymentState = sql<PaymentState>`case
  when exists (select 1 from order_events pe where pe.order_id = "orders"."id" and pe.action = ${PAID_BY}) then ${STATE.paid}
  when "orders"."status" = ${UNDER_CHECK} and exists (select 1 from receipts pr where pr.order_id = "orders"."id" and pr.verdict = ${HELD}) then ${STATE.manual_review}
  when "orders"."status" = ${UNDER_CHECK} then ${STATE.checking}
  else ${STATE.unpaid}
end`;

/** The digits of a phone as stored (E.164 with `+`), for a search by part of the number. */
const digitsOf = (column: unknown) =>
  sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;

/** A number the column can hold: anything longer is no order, so 404 rather than a DB error. */
const knownNumber = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= ORDER_NUMBER_MAX;

const customerName = (c: { firstName: string; lastName: string | null }) =>
  c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;

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
    @Inject(OrderStatusService) private readonly status: OrderStatusService,
    @Inject(ReceiptRejection) private readonly rejection: ReceiptRejection,
    @Inject(AuditQueryService) private readonly auditQuery: AuditQueryService,
  ) {}

  /** Newest first. A search puts the order with that number first, then phone matches. */
  async list(q: ListQuery): Promise<AdminOrdersPageDto> {
    const conditions = [];
    if (q.status) conditions.push(eq(orders.status, q.status));
    if (q.payment) conditions.push(sql`(${paymentState}) = ${q.payment}`);
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
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where);
    const rows = await this.db
      .select({ order: orders, customer: customers, payment: paymentState })
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
    const items = rows.map(({ order: o, customer: c, payment }): AdminOrderListItemDto => {
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
      };
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
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
    const limits = await readSettings(this.db, ['receipts.rejectNoteMaxLength']);
    return {
      order: toOrderDto(o, await linesOf(this.db, o.id), await cancellationOf(this.db, o.id)),
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
      // the link to the order is #32's (`PaymentConfirmation`); none is made before it
      credit: null,
      events,
      audit: await this.auditQuery.forTarget('order', o.id),
      limits: { rejectNoteMax: limits['receipts.rejectNoteMaxLength'] },
    };
  }

  /** The order's history, oldest first, with the actor's name. */
  private async events(orderId: number): Promise<AdminOrderEventDto[]> {
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
      };
    });
  }

  /** Credits newest first; «Не привязано» are those no order holds. */
  async credits(q: CreditsQuery): Promise<AdminCreditsPageDto> {
    const conditions = [];
    // no order holds a credit before #32 links them: every credit is «Не привязано» until then
    if (q.linked === 'linked') conditions.push(sql`false`);
    if (q.amount !== undefined) conditions.push(eq(credits.amountSom, q.amount));
    if (q.from) conditions.push(sql`${credits.occurredAt} >= ${dayStart(q.from).toISOString()}`);
    if (q.to) conditions.push(sql`${credits.occurredAt} < ${dayStart(q.to, 1).toISOString()}`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(credits)
      .where(where);
    const rows = await this.db
      .select()
      .from(credits)
      .where(where)
      .orderBy(desc(credits.occurredAt), desc(credits.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const card = await readShopCard(this.db);
    const last4 = card?.number.slice(-4) ?? null;
    return {
      items: rows.map((c) => toCreditDto(c, last4, null)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
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
      case 'not_found':
      case 'refused':
      case 'try_again':
        return out.kind === 'refused' ? { kind: 'refused', code: out.code } : { kind: out.kind };
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
): AdminCreditDto {
  return {
    id: c.id,
    occurredAt: c.occurredAt.toISOString(),
    amountTiyin: c.amountTiyin,
    amountSom: c.amountSom ?? null,
    cardMask: c.cardMask,
    onShopCard: shopCardLast4 !== null && c.cardLast4 === shopCardLast4,
    counterparty: c.counterparty,
    order,
  };
}
