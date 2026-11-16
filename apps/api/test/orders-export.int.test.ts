import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminOrdersQuery, CreateOrderBody } from '@lummi/contracts';
import { and, auditLog, btsPoints, eq, fragrances, orders, regions } from '@lummi/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { shopper } from './harness/orders';
import { payWithCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/** Seam 1 (ADR 0028): the orders Excel export (#56): the list's filters, the owner only, audited. */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const ali: TestUser = { id: 41, first_name: 'Ali', last_name: 'Karimov', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

let t: TestApp;
let owner: StaffSession;
let slugs: string[];
const numbers: Record<'unpaid' | 'checking' | 'paid' | 'late', number> = {} as never;

type Shopper = Awaited<ReturnType<typeof shopper>>;

async function placeOrder(client: Shopper, picks: string[]): Promise<number> {
  for (const slug of picks) {
    const add = await client.cart.addLine({ body: { slug, ml: 10, qty: 1 } });
    if (add.status !== 200) throw new Error(`add ${add.status}`);
  }
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await client.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({
    body: {
      recipientName: 'Ali Valiyev',
      recipientPhone: '+998901234567',
      delivery: { kind: 'point', pointId: point!.id },
      consent: true,
      confirmedTotal: checkout.body.quote.total,
      confirmedDiscount: checkout.body.quote.discount,
      idempotencyKey: randomUUID(),
    } satisfies CreateOrderBody,
  });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

async function sendReceipt(number: number) {
  const [order] = await t.db.select().from(orders).where(eq(orders.number, number));
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order!.customerId, number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  return { order: order!, receiptId: sent.receipt.id };
}

beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  slugs = (await t.db.select({ slug: fragrances.slug }).from(fragrances))
    .map((r) => r.slug)
    .sort()
    .slice(0, 4);
  const aliClient = await shopper(t, ali, '998901112233');
  const valiClient = await shopper(t, vali, '998935556677');
  t.edges.clock.set(new Date('2026-11-07T18:30:00Z')); // the 7th, 23:30 in Tashkent
  numbers.unpaid = await placeOrder(aliClient, [slugs[0]!]);
  t.edges.clock.set(new Date('2026-11-08T09:00:00Z'));
  numbers.checking = await placeOrder(valiClient, [slugs[1]!]);
  await sendReceipt(numbers.checking);
  numbers.paid = await placeOrder(aliClient, [slugs[2]!, slugs[0]!]);
  const { order, receiptId } = await sendReceipt(numbers.paid);
  await payWithCredit(t, order, receiptId);
  t.edges.clock.set(new Date('2026-11-08T19:30:00Z')); // the 9th, 00:30 in Tashkent
  numbers.late = await placeOrder(valiClient, [slugs[3]!]);
});
afterAll(() => t.close());

const filterSets: AdminOrdersQuery[] = [
  {},
  { status: 'awaiting_payment' },
  { payment: 'paid' },
  { from: '2026-11-08', to: '2026-11-08' },
  { from: '2026-11-09' },
  { q: '5556677' },
  { q: String(1001) },
  { status: 'receipt_review', from: '2026-11-08' },
  { paidOn: '2026-11-08' },
  { paidOn: '2026-11-08', payment: 'paid', q: '1112233' },
  { q: '0000000000' },
];

function exportUrl(filters: AdminOrdersQuery, lang?: string) {
  const params = new URLSearchParams({ ...(lang ? { lang } : {}) });
  for (const [k, v] of Object.entries(filters)) if (v !== undefined) params.set(k, String(v));
  return `${t.baseUrl}/admin/orders/export?${params}`;
}

async function exported(filters: AdminOrdersQuery, lang?: string) {
  const res = await fetch(exportUrl(filters, lang), { headers: { cookie: owner.cookie } });
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  return { res, ws: wb.worksheets[0]! };
}

/** Every order number the list shows for the filters, over all its pages (two to a page). */
async function listed(filters: AdminOrdersQuery) {
  const all: number[] = [];
  for (let page = 1; ; page++) {
    const res = await owner.client.admin.orders.list({ query: { ...filters, page, pageSize: 2 } });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    all.push(...res.body.items.map((i) => i.number));
    if (all.length >= res.body.total) return all;
  }
}

describe('the orders export', () => {
  it('has the same orders, in the same order, as the list for the same filters', async () => {
    for (const filters of filterSets) {
      const { ws } = await exported(filters);
      const fromFile = ws
        .getColumn(1)
        .values.slice(2)
        .map((v) => Number(v));
      expect(fromFile, JSON.stringify(filters)).toEqual(await listed(filters));
    }
    // the sample is not trivial: some filters keep some orders and drop others
    expect((await listed({})).length).toBe(4);
    expect(await listed({ from: '2026-11-08', to: '2026-11-08' })).toHaveLength(2);
    expect(await listed({ paidOn: '2026-11-08' })).toEqual([numbers.paid]);
  });

  it("has the columns, whole so'm, and who confirmed the payment", async () => {
    const { res, ws } = await exported({});
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    expect(res.headers.get('content-disposition')).toContain('.xlsx');
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Номер',
      'Создан',
      'Статус',
      'Оплата',
      'Оплату подтвердил',
      'Покупатель',
      'Телефон',
      'Получатель',
      'Телефон получателя',
      'Регион',
      'Пункт BTS / адрес',
      'Состав',
      'Товары',
      'Скидка',
      'Источник скидки',
      'Доставка',
      'Итого',
      'Трек-номер BTS',
      'Возвращено',
    ]);
    const col = (key: string) =>
      [
        'number',
        'created',
        'status',
        'payment',
        'confirmedBy',
        'customer',
        'phone',
        'recipient',
        'recipientPhone',
        'region',
        'point',
        'items',
        'subtotal',
        'discount',
        'discountSource',
        'delivery',
        'total',
        'tracking',
        'refunded',
      ].indexOf(key) + 1;
    const rowOf = (n: number) => {
      for (let i = 2; i <= ws.rowCount; i++)
        if (ws.getRow(i).getCell(1).value === n) return ws.getRow(i);
      throw new Error(`no row for ${n}`);
    };
    const paid = rowOf(numbers.paid);
    const [row] = await t.db.select().from(orders).where(eq(orders.number, numbers.paid));
    expect(paid.getCell(col('subtotal')).value).toBe(row!.itemsSubtotal);
    expect(paid.getCell(col('delivery')).value).toBe(row!.deliveryFee);
    expect(paid.getCell(col('total')).value).toBe(row!.total);
    expect(paid.getCell(col('discount')).value).toBe(row!.discountAmount);
    for (const key of ['subtotal', 'discount', 'delivery', 'total', 'refunded'])
      expect(Number.isInteger(paid.getCell(col(key)).value), key).toBe(true);
    expect(paid.getCell(col('status')).value).toBe('Оплата подтверждена');
    expect(paid.getCell(col('payment')).value).toBe('Оплачен');
    expect(String(paid.getCell(col('confirmedBy')).value)).not.toBe('');
    expect(String(paid.getCell(col('items')).value).split('\n')).toHaveLength(2);
    expect(paid.getCell(col('customer')).value).toBe('Ali Karimov');
    // Tashkent wall clock: 2026-11-08 09:00 UTC is 14:00 there
    expect((paid.getCell(col('created')).value as Date).toISOString()).toBe(
      '2026-11-08T14:00:00.000Z',
    );
    expect(rowOf(numbers.unpaid).getCell(col('confirmedBy')).value).toBe('');
    expect(rowOf(numbers.unpaid).getCell(col('payment')).value).toBe('Не оплачен');
  });

  it('writes the headers in the admin language', async () => {
    const { ws } = await exported({}, 'uz');
    expect(ws.getRow(1).getCell(1).value).toBe('Raqam');
    expect(ws.getRow(1).getCell(4).value).toBe('Toʻlov');
  });

  it("is the owner's: a manager gets 403, no session 401, a bad filter 422", async () => {
    const manager = await t.managerSession();
    const asManager = await fetch(exportUrl({}), { headers: { cookie: manager.cookie } });
    expect(asManager.status).toBe(403);
    expect((await fetch(exportUrl({}))).status).toBe(401);
    const bad = await fetch(`${t.baseUrl}/admin/orders/export?status=nope`, {
      headers: { cookie: owner.cookie },
    });
    expect(bad.status).toBe(422);
    expect(
      (
        await fetch(`${t.baseUrl}/admin/orders/export?from=2026-13-40`, {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(422);
  });

  it('audits each export with the filters and the row count, and a refused one not at all', async () => {
    const before = await t.db.select().from(auditLog).where(eq(auditLog.action, 'orders.exported'));
    await fetch(exportUrl({ from: '2026-11-08', to: '2026-11-08' }), {
      headers: { cookie: (await t.managerSession()).cookie },
    });
    await exported({ from: '2026-11-08', to: '2026-11-08' });
    const log = await t.db.select().from(auditLog).where(eq(auditLog.action, 'orders.exported'));
    expect(log).toHaveLength(before.length + 1);
    expect(log.at(-1)).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'orders',
      payload: { filters: { from: '2026-11-08', to: '2026-11-08' }, count: 2 },
    });
  });
});
