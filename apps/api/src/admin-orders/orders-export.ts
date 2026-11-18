import {
  promoGiftValue,
  utcToTashkent,
  type AdminOrdersExportFilters,
  type AdminOrdersExportParams,
  type Discount,
} from '@lummi/contracts';
import {
  and,
  asc,
  customers,
  eq,
  orderEvents,
  orderLines,
  orders,
  sql,
  staff,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import { fill, type Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { ordersMessages } from '@lummi/i18n/orders';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { customerName, PAID_BY } from '../orders/order-read';
import { MONEY, sheet } from '../reports/report-workbook';
import { DB } from '../tokens';
import { listedOrders, orderFilters } from './admin-orders.service';

const WHEN = 'dd.mm.yyyy hh:mm';

/** `GET /admin/orders/export` (#56): the orders the list's filters match, one row each. */
@Injectable()
export class OrdersExport {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The file, and the audit entry (the filters and the row count) in the same transaction. */
  async workbook(staffId: number, query: AdminOrdersExportParams) {
    const { lang, ...filters } = query;
    // one snapshot for every read: a payment confirmed meanwhile never shows «Не оплачен»
    // beside the name of who confirmed it (the audit entry is written in it too)
    return this.db.transaction(
      async (tx) => {
        const rows = await rowsFor(tx, filters);
        await this.audit.record(tx, {
          actor: { type: 'staff', id: staffId },
          action: 'orders.exported',
          targetType: 'orders',
          payload: { filters, count: rows.length },
        });
        return ordersWorkbook(rows, lang);
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}

async function rowsFor(db: DbOrTx, filters: AdminOrdersExportFilters) {
  const orderRows = await listedOrders(db, filters);
  // the lines and the confirmations of the same orders, read through the same conditions (no id
  // list to bind), one read after the other: a transaction has one connection
  const { conditions } = orderFilters(filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const lines = await db
    .select({ line: orderLines })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(where)
    .orderBy(asc(orderLines.orderId), asc(orderLines.position));
  const confirmations = await db
    .select({
      orderId: orderEvents.orderId,
      actorType: orderEvents.actorType,
      staffName: staff.name,
    })
    .from(orderEvents)
    .innerJoin(orders, eq(orders.id, orderEvents.orderId))
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(
      staff,
      sql`${orderEvents.actorType} = 'staff' and ${orderEvents.actorId} = ${staff.id}`,
    )
    .where(and(eq(orderEvents.action, PAID_BY), ...(where ? [where] : [])))
    .orderBy(asc(orderEvents.id));
  const linesOf = new Map<number, (typeof lines)[number]['line'][]>();
  for (const { line } of lines)
    linesOf.set(line.orderId, [...(linesOf.get(line.orderId) ?? []), line]);
  // the last confirmation, as the order page reads it
  const confirmedBy = new Map<number, (typeof confirmations)[number]>();
  for (const c of confirmations) confirmedBy.set(c.orderId, c);
  return orderRows.map((r) => ({
    ...r,
    lines: linesOf.get(r.order.id) ?? [],
    confirmation: confirmedBy.get(r.order.id) ?? null,
  }));
}

type ExportRow = Awaited<ReturnType<typeof rowsFor>>[number];

/** The discount's source as the order page words it. */
function discountSource(d: Discount | null, language: Language): string {
  if (!d) return '';
  const detail = adminMessages[language].admin.orders.detail;
  const src = detail.discountSource;
  if (d.type !== 'promo_code') return src[d.type];
  return fill(d.gift ? detail.promoGiftSource : src.promo_code, { code: d.code });
}

/** The workbook: one sheet, in the admin's language; money cells are numbers in whole so'm. */
async function ordersWorkbook(rows: ExportRow[], language: Language): Promise<Buffer> {
  const o = adminMessages[language].admin.orders;
  const x = o.export;
  const status = ordersMessages[language].orders.status;
  const wb = new ExcelJS.Workbook();
  wb.title = o.title;

  const ws = sheet(wb, o.title, [
    { header: x.number, key: 'number', width: 10 },
    { header: x.created, key: 'created', width: 17, numFmt: WHEN },
    { header: x.status, key: 'status', width: 20 },
    { header: x.payment, key: 'payment', width: 18 },
    { header: x.confirmedBy, key: 'confirmedBy', width: 18 },
    { header: x.customer, key: 'customer', width: 24 },
    { header: x.phone, key: 'phone', width: 18 },
    { header: x.recipient, key: 'recipient', width: 24 },
    { header: x.recipientPhone, key: 'recipientPhone', width: 18 },
    { header: x.region, key: 'region', width: 20 },
    { header: x.point, key: 'point', width: 36 },
    { header: x.items, key: 'items', width: 44 },
    { header: x.subtotal, key: 'subtotal', width: 16, numFmt: MONEY },
    { header: x.discount, key: 'discount', width: 14, numFmt: MONEY },
    { header: x.discountSource, key: 'discountSource', width: 24 },
    { header: x.delivery, key: 'delivery', width: 14, numFmt: MONEY },
    { header: x.total, key: 'total', width: 16, numFmt: MONEY },
    { header: x.tracking, key: 'tracking', width: 20 },
    { header: x.refunded, key: 'refunded', width: 16, numFmt: MONEY },
  ]);

  for (const { order: ord, customer: c, payment, refunded, lines, confirmation } of rows) {
    const point = ord.pointName
      ? [ord.pointCode, ord.pointName, ord.pointCity, ord.pointAddress].filter(Boolean).join(', ')
      : (ord.typedAddress ?? '');
    ws.addRow({
      number: ord.number,
      created: tashkentWallClock(ord.createdAt),
      status: status[ord.status],
      payment: o.payment[payment],
      confirmedBy: !confirmation
        ? ''
        : confirmation.actorType === 'ai'
          ? o.detail.actor.ai
          : (confirmation.staffName ?? ''),
      customer: customerName(c),
      phone: c.phone ?? '',
      recipient: ord.recipientName,
      recipientPhone: ord.recipientPhone,
      region: language === 'uz' ? ord.regionNameUz : ord.regionNameRu,
      point,
      items: lines
        .map((l) => {
          const name = language === 'uz' ? l.nameUz : l.nameRu;
          const item =
            l.kind === 'volume'
              ? `${name}, ${l.ml} ${x.ml} × ${l.qty}`
              : `${name} (${o.detail.setOf}) × ${l.qty}`;
          return l.promoGift ? `${o.detail.promoGift}: ${item}` : item;
        })
        .join('\n'),
      // a gift code's gift at its regular price in both, as the reports count it (ADR 0039)
      subtotal: ord.itemsSubtotal + promoGiftValue(ord.discount),
      discount: ord.discountAmount + promoGiftValue(ord.discount),
      discountSource: discountSource(ord.discount, language),
      delivery: ord.deliveryFee,
      total: ord.total,
      tracking: ord.trackingNumber ?? '',
      refunded,
    });
  }
  ws.getColumn('items').alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** An instant as the Tashkent wall clock in an Excel date cell (Excel dates carry no zone). */
function tashkentWallClock(instant: Date): Date {
  const t = utcToTashkent(instant);
  return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
}
