import type { AdminOrdersExportFilters, AdminOrdersExportParams, Discount } from '@lummi/contracts';
import {
  and,
  asc,
  customers,
  desc,
  eq,
  inArray,
  orderEvents,
  orderLines,
  orders,
  sql,
  staff,
  type Db,
  type DbOrTx,
} from '@lummi/db';
import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { ordersMessages } from '@lummi/i18n/orders';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { customerName, PAID_BY, paymentState } from '../orders/order-read';
import { refundedSum } from '../refunds/order-money';
import { MONEY, sheet } from '../reports/report-workbook';
import { DB } from '../tokens';
import { orderFilters } from './admin-orders.service';

/** Uzbekistan keeps UTC+05:00 all year: an instant shifted by it reads as the Tashkent wall clock. */
const TASHKENT_MS = 5 * 3600_000;
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
    return this.db.transaction(async (tx) => {
      const rows = await rowsFor(tx, filters);
      await this.audit.record(tx, {
        actor: { type: 'staff', id: staffId },
        action: 'orders.exported',
        targetType: 'orders',
        payload: { filters, count: rows.length },
      });
      return ordersWorkbook(rows, lang);
    });
  }
}

async function rowsFor(db: DbOrTx, filters: AdminOrdersExportFilters) {
  const { conditions, byNumber } = orderFilters(filters);
  const orderRows = await db
    .select({ order: orders, customer: customers, payment: paymentState, refunded: refundedSum() })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      ...(byNumber !== null ? [sql`${orders.number} = ${byNumber} desc`] : []),
      desc(orders.number),
    );
  const ids = orderRows.map((r) => r.order.id);
  const [lines, confirmations] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select()
            .from(orderLines)
            .where(inArray(orderLines.orderId, ids))
            .orderBy(asc(orderLines.orderId), asc(orderLines.position)),
          db
            .select({
              orderId: orderEvents.orderId,
              actorType: orderEvents.actorType,
              staffName: staff.name,
            })
            .from(orderEvents)
            .leftJoin(
              staff,
              sql`${orderEvents.actorType} = 'staff' and ${orderEvents.actorId} = ${staff.id}`,
            )
            .where(and(inArray(orderEvents.orderId, ids), eq(orderEvents.action, PAID_BY)))
            .orderBy(asc(orderEvents.id)),
        ]);
  return orderRows.map((r) => ({
    ...r,
    lines: lines.filter((l) => l.orderId === r.order.id),
    // the first confirmation is the one that matched the money
    confirmation: confirmations.find((c) => c.orderId === r.order.id) ?? null,
  }));
}

type Row = Awaited<ReturnType<typeof rowsFor>>[number];

/** The discount's source as the order page words it. */
function discountSource(d: Discount | null, language: Language): string {
  if (!d) return '';
  const src = adminMessages[language].admin.orders.detail.discountSource;
  return d.type === 'promo_code' ? src.promo_code.replace('{code}', d.code) : src[d.type];
}

/** The workbook: one sheet, in the admin's language; money cells are numbers in whole so'm. */
export async function ordersWorkbook(rows: Row[], language: Language): Promise<Buffer> {
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
      created: new Date(ord.createdAt.getTime() + TASHKENT_MS),
      status: status[ord.status],
      payment: o.payment[payment],
      confirmedBy: !confirmation
        ? ''
        : confirmation.actorType === 'ai'
          ? x.byAi
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
          return l.kind === 'volume'
            ? `${name}, ${l.ml} ${x.ml} × ${l.qty}`
            : `${name} (${o.detail.setOf}) × ${l.qty}`;
        })
        .join('\n'),
      subtotal: ord.itemsSubtotal,
      discount: ord.discountAmount,
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
