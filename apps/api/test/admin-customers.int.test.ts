import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OrderStatus } from '@lummi/contracts';
import { customers, eq, orders } from '@lummi/db';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { isFulfilled } from '../src/orders/fulfilled';
import { OrderStatusService, type TransitionActor } from '../src/order-status/order-status.service';
import { payWithCredit, uniqueReceiptImage } from './harness/payments';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-11T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir, limit: 6 });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const machine = () => t.app.get(OrderStatusService);
const ali: TestUser = { id: 71, first_name: 'Ali', last_name: 'Valiyev', username: 'ali_v' };
const vali: TestUser = { id: 72, first_name: 'Vali', language_code: 'uz' };
const sora: TestUser = { id: 73, first_name: 'Sora', last_name: 'Karimova' };

/** Places one order of `qty` 10 ml of the first fragrance; returns its number. */
async function place(user: TestUser, phone: string, qty = 1) {
  const [slug] = await slugsOf(t, 1);
  const client = await shopper(t, user, phone);
  await client.cart.addLine({ body: { slug: slug!, ml: 10, qty } });
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

/** Walks an order forward: the receipt goes in through the intake (#28), the rest are real transitions. */
async function walkTo(
  number: number,
  status: Exclude<OrderStatus, 'awaiting_payment' | 'cancelled' | 'returned'>,
) {
  const [order] = await t.db.select().from(orders).where(eq(orders.number, number));
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order!.customerId, number, await uniqueReceiptImage(), {
      fileName: null,
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  if (status === 'receipt_review') return;
  // the money arrives and the receipt AI confirms it (#32): the only way to «Оплата подтверждена»
  await payWithCredit(t, order!, sent.receipt.id);
  if (status === 'payment_confirmed') return;
  const mgr: TransitionActor = { type: 'staff', id: manager.staff.id };
  const path = [
    ['accepted', 'accept', mgr, undefined],
    ['assembling', 'start_assembly', mgr, undefined],
    ['handed_to_bts', 'hand_to_bts', mgr, { trackingNumber: 'BTS 4471 0098' }],
    ['delivered', 'deliver', mgr, undefined],
  ] as const;
  let from: OrderStatus = 'payment_confirmed';
  for (const [to, action, actor, payload] of path) {
    const out = await machine().transition(order!.id, action, actor, from, payload as never);
    if (out.kind !== 'done') throw new Error(`${action}: ${out.kind}`);
    if (to === status) return;
    from = to;
  }
}
async function cancel(number: number) {
  const [order] = await t.db.select().from(orders).where(eq(orders.number, number));
  const out = await machine().transition(
    order!.id,
    'cancel',
    { type: 'customer', id: order!.customerId },
    'awaiting_payment',
    { reason: 'customer_cancelled' },
  );
  if (out.kind !== 'done') throw new Error(`cancel: ${out.kind}`);
}
const totalOf = async (number: number) =>
  (await t.db.select().from(orders).where(eq(orders.number, number)))[0]!.total;

async function page(query: Record<string, string> = {}, as: StaffSession = manager) {
  const res = await as.client.admin.customers.list({ query });
  if (res.status !== 200) throw new Error(`customers ${res.status}`);
  return res.body;
}

describe('Fulfilled orders', () => {
  it('is delivered and not returned, nothing else', () => {
    expect(isFulfilled('delivered')).toBe(true);
    for (const s of [
      'awaiting_payment',
      'receipt_review',
      'payment_confirmed',
      'accepted',
      'assembling',
      'handed_to_bts',
      'returned',
      'cancelled',
    ] as const) {
      expect(isFulfilled(s)).toBe(false);
    }
  });
});

describe('total spent', () => {
  it('counts delivered orders only; the orders count counts every order', async () => {
    const delivered = await place(ali, '998901110001', 1);
    const delivered2 = await place(ali, '998901110001', 2);
    const awaiting = await place(ali, '998901110001', 1);
    const cancelled = await place(ali, '998901110001', 1);
    const paid = await place(ali, '998901110001', 1);
    const onTheWay = await place(ali, '998901110001', 1);
    await walkTo(delivered, 'delivered');
    await walkTo(delivered2, 'delivered');
    await cancel(cancelled);
    await walkTo(paid, 'payment_confirmed');
    await walkTo(onTheWay, 'handed_to_bts');
    void awaiting;

    const { items } = await page();
    const row = items.find((c) => c.telegramId === ali.id)!;
    expect(row.ordersCount).toBe(6);
    expect(row.totalSpent).toBe((await totalOf(delivered)) + (await totalOf(delivered2)));
    expect(row.totalSpent).toBeGreaterThan(0);

    const detail = await manager.client.admin.customers.get({ params: { id: row.id } });
    expect(detail.status === 200 && detail.body.totalSpent).toBe(row.totalSpent);
  });

  it('is zero for a customer with no orders, and for one with only unfulfilled ones', async () => {
    await place(vali, '998901110002');
    await t.signIn(sora);
    const { items } = await page();
    expect(items.find((c) => c.telegramId === vali.id)).toMatchObject({
      ordersCount: 1,
      totalSpent: 0,
    });
    expect(items.find((c) => c.telegramId === sora.id)).toMatchObject({
      ordersCount: 0,
      totalSpent: 0,
    });
  });
});

describe('the list', () => {
  it('carries name, username, phone, language and bot_blocked', async () => {
    await place(ali, '998901110001');
    await t.db.update(customers).set({ botBlocked: true }).where(eq(customers.telegramId, ali.id));
    const { items } = await page();
    expect(items.find((c) => c.telegramId === ali.id)).toMatchObject({
      name: 'Ali Valiyev',
      username: 'ali_v',
      phone: '+998901110001',
      language: 'ru',
      botBlocked: true,
    });
  });

  it('is open to the owner and the manager, and closed to signed-out and shopper sessions', async () => {
    expect((await owner.client.admin.customers.list({ query: {} })).status).toBe(200);
    expect((await manager.client.admin.customers.list({ query: {} })).status).toBe(200);
    expect((await t.client.admin.customers.list({ query: {} })).status).toBe(401);
    const { token } = await t.signIn(ali);
    for (const path of ['/admin/customers', '/admin/customers/1']) {
      const res = await fetch(`${t.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
    }
  });

  it('searches by name, @username and phone digits', async () => {
    await place(ali, '998901110001');
    await place(vali, '998902220002');
    await t.signIn(sora);
    const names = async (q: string) => (await page({ q })).items.map((c) => c.telegramId);
    expect(await names('valiyev')).toEqual([ali.id]);
    expect(await names('ali v')).toEqual([ali.id]);
    expect(await names('@ALI_v')).toEqual([ali.id]);
    expect(await names('+998 90 222')).toEqual([vali.id]);
    expect(await names('0002')).toEqual([vali.id]);
    expect(await names('nobody')).toEqual([]);
    // wildcards in what staff type are text, not patterns
    expect(await names('%')).toEqual([]);
    // the total follows the search, not the table ("ali" is inside both Ali and Vali)
    expect((await page({ q: 'ali' })).total).toBe(2);
  });

  it('ignores apostrophe variants in names, whichever way they were typed', async () => {
    await t.signIn({ id: 81, first_name: 'Oʻktam', last_name: 'Gʻaniyev' });
    await t.signIn({ id: 82, first_name: 'Dilnoza' });
    for (const q of ["o'ktam", 'o’ktam', 'oʻktam', 'oktam', "g'aniyev"]) {
      expect(
        (await page({ q })).items.map((c) => c.telegramId),
        q,
      ).toEqual([81]);
    }
  });

  it('sorts by total spent, by orders and by newest', async () => {
    const a1 = await place(ali, '998901110001', 1);
    const v1 = await place(vali, '998902220002', 3);
    const v2 = await place(vali, '998902220002', 1);
    await walkTo(a1, 'delivered');
    await walkTo(v1, 'delivered');
    await t.edges.clock.set(new Date('2026-11-11T11:00:00Z'));
    await t.signIn(sora);
    void v2;
    const ids = async (sort: string) => (await page({ sort })).items.map((c) => c.telegramId);
    expect(await ids('spent')).toEqual([vali.id, ali.id, sora.id]);
    expect(await ids('orders')).toEqual([vali.id, ali.id, sora.id]);
    expect((await ids('newest'))[0]).toBe(sora.id);
    expect((await page()).items[0]?.telegramId).toBe(sora.id); // newest is the default
  });

  it('pages, and says how many there are', async () => {
    for (let i = 0; i < 5; i++) await t.signIn({ id: 1000 + i, first_name: `User${i}` });
    const first = await page({ pageSize: '2' });
    expect(first).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(first.items).toHaveLength(2);
    const last = await page({ pageSize: '2', page: '3' });
    expect(last.items).toHaveLength(1);
    const seen = new Set(
      [...(await page({ pageSize: '2', page: '2' })).items, ...first.items, ...last.items].map(
        (c) => c.id,
      ),
    );
    expect(seen.size).toBe(5);
  });

  it('refuses a page size above the maximum', async () => {
    const res = await fetch(`${t.baseUrl}/admin/customers?pageSize=500`, {
      headers: { cookie: manager.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe('the customer page', () => {
  it('lists every order, all statuses, newest first', async () => {
    const first = await place(ali, '998901110001');
    t.edges.clock.set(new Date('2026-11-11T12:00:00Z'));
    const second = await place(ali, '998901110001');
    await cancel(second);
    await walkTo(first, 'delivered');
    const [row] = (await page()).items;
    const res = await manager.client.admin.customers.get({ params: { id: row!.id } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.orders.map((o) => [o.number, o.status])).toEqual([
      [second, 'cancelled'],
      [first, 'delivered'],
    ]);
    expect(res.body.orders[0]).toMatchObject({ total: await totalOf(second) });
    expect(res.body).toMatchObject({ name: 'Ali Valiyev', phone: '+998901110001' });
  });

  it('answers 404 for an unknown customer', async () => {
    expect((await manager.client.admin.customers.get({ params: { id: 99999 } })).status).toBe(404);
  });
});
