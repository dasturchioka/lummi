import type {
  CheckoutDto,
  CreateOrderInput,
  Discount,
  OrderDto,
  OrderLineDto,
  OrderStatus,
  OrderSummaryDto,
} from '@lummi/contracts';
import {
  and,
  asc,
  btsPoints,
  cartLines,
  carts,
  customers,
  desc,
  eq,
  inArray,
  orderLines,
  orders,
  regions,
  volumes,
  type BtsPointRow,
  type CustomerRow,
  type Db,
  type DbOrTx,
  type OrderLineRow,
  type OrderRow,
  type OrderStatusValue,
  type RegionRow,
} from '@lummi/db';
import { fill, formatDateTime, formatMoney } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { loadCartQuote } from '../cart/load-cart';
import { toRegionDto } from '../delivery/dto';
import type { Edges } from '../edges';
import type { Env } from '../env';
import { OutboxService } from '../outbox/outbox.service';
import { readSettings } from '../settings/settings.service';
import { DB, EDGES, ENV } from '../tokens';

/** The contract's statuses and the DB enum are one list (compile-time check). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const statusesMatch: Same<OrderStatus, OrderStatusValue> = true;
void statusesMatch;

export type CreateOutcome =
  | { kind: 'created'; order: OrderDto }
  | { kind: 'phone_required' }
  | { kind: 'conflict'; code: 'total_changed' | 'nothing_to_order'; checkout: CheckoutDto }
  | {
      kind: 'invalid';
      code: 'consent_required' | 'unknown_point' | 'unknown_region' | 'gift_message_too_long';
    };

/** Where the parcel goes: a point from our list (its region), or a typed address in a region. */
type Destination =
  | { kind: 'point'; region: RegionRow; point: BtsPointRow }
  | { kind: 'typed'; region: RegionRow; text: string };

/**
 * Checkout and the customer's orders (ADR 0001, 0010, 0011, 0012). An order is created in one
 * transaction that re-quotes the cart under a lock on its stock rows, so the last unit is sold
 * once, and freezes everything it was sold with into a snapshot.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(EDGES) private readonly edges: Edges,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /**
   * The cart as checkout shows it: quoted with the tariff of `regionId` (the chosen point's
   * region), else the saved delivery city's, else the default. An unknown region is ignored.
   */
  async checkout(
    customerId: number,
    regionId?: number,
    tx: DbOrTx = this.db,
  ): Promise<CheckoutDto | null> {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) return null;
    const [region] =
      regionId === undefined ? [] : await tx.select().from(regions).where(eq(regions.id, regionId));
    return this.checkoutOf(tx, c, region ?? null);
  }

  private async checkoutOf(
    tx: DbOrTx,
    c: CustomerRow,
    region: RegionRow | null,
  ): Promise<CheckoutDto> {
    const loaded = await loadCartQuote(
      tx,
      this.edges.clock.now(),
      c.id,
      region ? { deliveryTariff: region.deliveryTariff } : {},
    );
    const { 'orders.giftMessageMaxLength': giftMessageMax } = await readSettings(tx, [
      'orders.giftMessageMaxLength',
    ]);
    return {
      quote: loaded.quote,
      itemCount: loaded.lines.filter((l) => !l.soldOut).reduce((n, l) => n + l.qty, 0),
      region: region ? toRegionDto(region) : null,
      deliveryCity: loaded.city,
      phone: c.phone,
      recipientName: [c.firstName, c.lastName].filter(Boolean).join(' '),
      needsConsent: c.dataConsentAt === null,
      giftMessageMax,
    };
  }

  /**
   * Creates the order, all in one transaction:
   * 1. the cart row and the stock rows of its lines are locked (`FOR UPDATE`), so a concurrent
   *    checkout for the same last unit waits here and then sees this order's reserve;
   * 2. the quote is recomputed under that lock with the destination region's tariff, its lines
   *    capped at available; a total other than the one the shopper confirmed is refused (409)
   *    with the new checkout, since they will transfer exactly that amount;
   * 3. the order and its lines are written as a snapshot, with `reserve_until`, «Ожидает оплаты»
   *    and its number; the lines are the reserve (ADR 0010);
   * 4. the ordered cart lines are removed, consent is stored on the first order, and the
   *    "order created" message goes into the outbox.
   */
  async create(customerId: number, input: CreateOrderInput): Promise<CreateOutcome | null> {
    return this.outbox.withTx(async (tx) => {
      const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!c) return null;
      if (!c.phone) return { kind: 'phone_required' } as const;
      if (c.dataConsentAt === null && !input.consent)
        return { kind: 'invalid', code: 'consent_required' } as const;

      const settings = await readSettings(tx, [
        'orders.reserveTtlSeconds',
        'orders.giftMessageMaxLength',
      ]);
      const giftMessage = input.gift && input.giftMessage ? input.giftMessage : null;
      if (giftMessage && giftMessage.length > settings['orders.giftMessageMaxLength'])
        return { kind: 'invalid', code: 'gift_message_too_long' } as const;
      const destination = await this.destination(tx, input.delivery);
      if ('code' in destination) return { kind: 'invalid', code: destination.code } as const;
      const { region } = destination;

      // 1. Freeze the cart, then the stock of every line in id order (no deadlock between checkouts).
      await tx
        .select({ id: carts.customerId })
        .from(carts)
        .where(eq(carts.customerId, c.id))
        .for('update');
      const wanted = await tx
        .select({ volumeId: cartLines.volumeId })
        .from(cartLines)
        .where(eq(cartLines.customerId, c.id));
      if (wanted.length > 0) {
        await tx
          .select({ id: volumes.id })
          .from(volumes)
          .where(
            inArray(
              volumes.id,
              wanted.map((w) => w.volumeId),
            ),
          )
          .orderBy(asc(volumes.id))
          .for('update');
      }

      // 2. Re-quote under the lock: lines are capped at available (on hand - reserve).
      const now = this.edges.clock.now();
      const loaded = await loadCartQuote(tx, now, c.id, { deliveryTariff: region.deliveryTariff });
      const { quote } = loaded;
      const bought = loaded.lines.filter((l) => !l.soldOut);
      const conflict = async (code: 'total_changed' | 'nothing_to_order') =>
        ({ kind: 'conflict', code, checkout: await this.checkoutOf(tx, c, region) }) as const;
      if (quote.itemsSubtotal === 0 || bought.length === 0) return conflict('nothing_to_order');
      if (quote.total !== input.confirmedTotal) return conflict('total_changed');
      // The check under the lock: every line fits in what is available (the quote capped them).
      if (bought.some((l) => l.qty > l.available)) return conflict('total_changed');

      // 3. The snapshot.
      const reserveUntil = new Date(now.getTime() + settings['orders.reserveTtlSeconds'] * 1000);
      const positionOf = new Map(bought.map((l, i) => [String(l.lineId), i]));
      const discount: Discount | null =
        quote.discount?.type === 'upgrade_right'
          ? { ...quote.discount, lineKey: String(positionOf.get(quote.discount.lineKey) ?? 0) }
          : quote.discount;
      const point = destination.kind === 'point' ? destination.point : null;
      const [order] = await tx
        .insert(orders)
        .values({
          customerId: c.id,
          status: 'awaiting_payment',
          reserveUntil,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          regionId: region.id,
          regionNameRu: region.nameRu,
          regionNameUz: region.nameUz,
          btsPointId: point?.id ?? null,
          pointCode: point?.code ?? null,
          pointName: point?.name ?? null,
          pointCity: point?.city ?? null,
          pointAddress: point?.address ?? null,
          pointLandmark: point?.landmark ?? null,
          pointHours: point?.hours ?? null,
          typedAddress: destination.kind === 'typed' ? destination.text : null,
          comment: input.comment ? input.comment : null,
          isGift: input.gift,
          giftMessage,
          itemsSubtotal: quote.itemsSubtotal,
          discount,
          discountAmount: quote.discount?.amount ?? 0,
          deliveryFee: quote.deliveryFee,
          thresholdBase: quote.thresholdBase,
          thresholdBaseAmount: quote.thresholdBaseAmount,
          total: quote.total,
          amountDue: quote.total,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!order) throw new Error('order insert returned nothing');
      const lines = await tx
        .insert(orderLines)
        .values(
          bought.map((l, position) => {
            const priced = quote.lines.find((q) => q.key === String(l.lineId));
            if (!priced) throw new Error(`quote has no line ${l.lineId}`);
            return {
              orderId: order.id,
              position,
              kind: 'volume' as const,
              volumeId: l.volumeId,
              fragranceId: l.fragranceId,
              slug: l.slug,
              // a fragrance has one name in both languages (ADR 0018); a set line (#22) has two
              nameRu: l.name,
              nameUz: l.name,
              brand: l.brand,
              ml: l.ml,
              photo: l.photo,
              unitPrice: priced.unitPrice,
              regularUnitPrice: priced.regularUnitPrice,
              markedDown: priced.markedDown,
              qty: priced.qty,
              lineTotal: priced.lineTotal,
            };
          }),
        )
        .returning();

      // 4. The cart, consent, audit and the message.
      await tx.delete(cartLines).where(
        and(
          eq(cartLines.customerId, c.id),
          inArray(
            cartLines.id,
            bought.map((l) => l.lineId),
          ),
        ),
      );
      if (c.dataConsentAt === null) {
        await tx
          .update(customers)
          .set({ dataConsentAt: now, updatedAt: now })
          .where(eq(customers.id, c.id));
        await this.audit.record(tx, {
          actor: { type: 'customer', id: c.id },
          action: 'customer.data_consent_given',
          targetType: 'customer',
          targetId: c.id,
          payload: { order: order.number },
        });
      }
      await this.audit.record(tx, {
        actor: { type: 'customer', id: c.id },
        action: 'order.created',
        targetType: 'order',
        targetId: order.id,
        payload: { number: order.number, total: order.total, status: order.status },
      });
      await this.outbox.enqueue(tx, this.createdMessage(c, order));
      return { kind: 'created', order: toOrderDto(order, lines) } as const;
    });
  }

  /** The customer's orders, newest first. */
  async list(customerId: number): Promise<OrderSummaryDto[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt), desc(orders.id));
    if (rows.length === 0) return [];
    const lines = await this.db
      .select({
        orderId: orderLines.orderId,
        qty: orderLines.qty,
        photo: orderLines.photo,
      })
      .from(orderLines)
      .where(
        inArray(
          orderLines.orderId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(orderLines.orderId), asc(orderLines.position));
    return rows.map((o) => {
      const own = lines.filter((l) => l.orderId === o.id);
      return {
        number: o.number,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        total: o.total,
        itemCount: own.reduce((n, l) => n + l.qty, 0),
        photos: own.flatMap((l) => (l.photo ? [l.photo] : [])).slice(0, 3),
        isGift: o.isGift,
      };
    });
  }

  /** One of the customer's orders by number; another customer's is not found. */
  async get(customerId: number, number: number): Promise<OrderDto | null> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.number, number)));
    if (!order) return null;
    const lines = await this.db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, order.id))
      .orderBy(asc(orderLines.position));
    return toOrderDto(order, lines);
  }

  private async destination(
    tx: DbOrTx,
    delivery: CreateOrderInput['delivery'],
  ): Promise<Destination | { code: 'unknown_point' | 'unknown_region' }> {
    if (delivery.kind === 'point') {
      const [row] = await tx
        .select({ point: btsPoints, region: regions })
        .from(btsPoints)
        .innerJoin(regions, eq(regions.id, btsPoints.regionId))
        .where(and(eq(btsPoints.id, delivery.pointId), eq(btsPoints.active, true)));
      return row ? { kind: 'point', ...row } : { code: 'unknown_point' };
    }
    const [region] = await tx.select().from(regions).where(eq(regions.id, delivery.regionId));
    return region ? { kind: 'typed', region, text: delivery.text } : { code: 'unknown_region' };
  }

  /** "Order created" in the customer's language, with «Открыть заказ» opening the order (spec 2026-11-07). */
  private createdMessage(c: CustomerRow, order: OrderRow) {
    const t = dictionaries[c.language].bot;
    const url = this.env.MINIAPP_URL ? orderUrl(this.env.MINIAPP_URL, order.number) : null;
    return {
      chatId: c.telegramId,
      text: fill(t.orderCreated, {
        number: String(order.number),
        amount: formatMoney(order.amountDue, c.language),
        until: formatDateTime(order.reserveUntil, c.language),
      }),
      options: url
        ? { reply_markup: { inline_keyboard: [[{ text: t.openOrder, web_app: { url } }]] } }
        : {},
    };
  }
}

/** The Mini App route of an order, under the Mini App's own URL (its path kept). */
export function orderUrl(miniAppUrl: string, number: number): string {
  const base = miniAppUrl.endsWith('/') ? miniAppUrl : `${miniAppUrl}/`;
  return new URL(`orders/${number}`, base).toString();
}

function toOrderDto(o: OrderRow, lines: OrderLineRow[]): OrderDto {
  return {
    number: o.number,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    reserveUntil: o.reserveUntil.toISOString(),
    recipient: { name: o.recipientName, phone: o.recipientPhone },
    delivery: {
      region: { ru: o.regionNameRu, uz: o.regionNameUz },
      point:
        o.pointCode === null
          ? null
          : {
              code: o.pointCode,
              name: o.pointName ?? '',
              city: o.pointCity ?? '',
              address: o.pointAddress ?? '',
              landmark: o.pointLandmark,
              hours: o.pointHours,
            },
      typed: o.typedAddress,
    },
    comment: o.comment,
    gift: { isGift: o.isGift, message: o.giftMessage },
    lines: [...lines].sort((a, b) => a.position - b.position).map(toLineDto),
    itemsSubtotal: o.itemsSubtotal,
    discount: (o.discount as Discount | null) ?? null,
    deliveryFee: o.deliveryFee,
    thresholdBase: o.thresholdBase,
    thresholdBaseAmount: o.thresholdBaseAmount,
    total: o.total,
    amountDue: o.amountDue,
  };
}

function toLineDto(l: OrderLineRow): OrderLineDto {
  return {
    kind: l.kind,
    slug: l.slug,
    name: { ru: l.nameRu, uz: l.nameUz },
    brand: l.brand,
    ml: l.ml,
    photo: l.photo,
    unitPrice: l.unitPrice,
    regularUnitPrice: l.regularUnitPrice,
    markedDown: l.markedDown,
    qty: l.qty,
    lineTotal: l.lineTotal,
    setComposition: l.setComposition?.map((f) => ({ name: f.name, brand: f.brand })) ?? null,
  };
}
