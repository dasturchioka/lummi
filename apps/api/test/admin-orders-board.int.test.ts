import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOARD_STATUSES,
  type AdminOrdersBoardDto,
  type AdminOrdersBoardQuery,
  type OrderStatus,
} from '@lummi/contracts';
import { btsPoints, eq, receipts } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminOrdersService } from '../src/admin-orders/admin-orders.service';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { ReceiptsService } from '../src/receipts/receipts.service';
import {
  cancelByStaff,
  fulfilTo,
  orderRow,
  pay,
  placeOrder,
  returnWhole,
  tashkent,
  type Shopper,
} from './harness/fulfilment';
import { samarkandPoint, shopper, slugs } from './harness/orders';
import { uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/** Seam 1 (ADR 0028): the orders board (#52) over HTTP, as staff open it. */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await seedCatalog(t.db, { materialsDir });
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-16 09:00'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 51, first_name: 'Ali', last_name: 'Karimov', language_code: 'ru' };
const vali: TestUser = { id: 52, first_name: 'Vali', language_code: 'uz' };

/** A fresh session for `user` at the clock's now, with the phone shared and one 10 ml in the cart. */
async function cartOf(user: TestUser, phone: string, slug: string, qty = 1): Promise<Shopper> {
  const client = await shopper(t, user, phone);
  const add = await client.cart.addLine({ body: { slug, ml: 10, qty } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  return client;
}

/** An order placed at the Tashkent time `at`, of `qty` × the `n`th fragrance's 10 ml. */
async function orderAt(at: string, user = ali, n = 0, qty = 1, phone = '998901112233') {
  t.edges.clock.set(tashkent(at));
  const slug = (await slugs(t, n + 1))[n]!;
  return (await placeOrder(t, await cartOf(user, phone, slug, qty))).number;
}

/** The shopper sends a receipt at the clock's now: «Чек на проверке». */
async function sendReceipt(number: number) {
  const order = await orderRow(t, number);
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  return sent.receipt.id;
}

async function board(query: AdminOrdersBoardQuery = {}): Promise<AdminOrdersBoardDto> {
  const { client } = await t.managerSession();
  const res = await client.admin.orders.board({ query });
  if (res.status !== 200) throw new Error(`board ${res.status}`);
  return res.body;
}

const column = (b: AdminOrdersBoardDto, status: OrderStatus) => {
  const c = b.columns.find((x) => x.status === status);
  if (!c) throw new Error(`no column ${status}`);
  return c;
};
const numbersIn = (b: AdminOrdersBoardDto, status: OrderStatus) =>
  column(b, status).cards.map((c) => c.number);

describe('the orders board', () => {
  it('a shopper is refused; the owner and a manager open it (not taken for an order number)', async () => {
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/orders/board`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    for (const session of [await t.ownerSession(), await t.managerSession()]) {
      const open = await session.client.admin.orders.board({ query: {} });
      expect(open.status).toBe(200);
    }
  });

  it('an empty shop has every column, in the funnel’s order, with nothing in it', async () => {
    const b = await board();
    expect(b.columns.map((c) => c.status)).toEqual([...BOARD_STATUSES]);
    expect(b.columns.every((c) => c.count === 0 && c.sum === 0 && c.cards.length === 0)).toBe(true);
    expect(b.at).toBe(tashkent('2026-11-16 09:00').toISOString());
    expect(b.recentDays).toBe(14);
    expect(b.limit).toBe(50);
  });

  it('each order sits in its status with what the card shows; a work column puts the longest wait first', async () => {
    const first = await orderAt('2026-11-15 10:00', ali, 0, 2);
    const second = await orderAt('2026-11-15 11:00', vali, 1, 1, '998935556677');
    const third = await orderAt('2026-11-15 12:00', ali, 2);
    // the third reaches «Оплата подтверждена» first, the first one later: the first waits less there
    t.edges.clock.set(tashkent('2026-11-15 13:00'));
    await pay(t, third);
    t.edges.clock.set(tashkent('2026-11-15 14:00'));
    await pay(t, first);
    t.edges.clock.set(tashkent('2026-11-16 09:00'));

    const b = await board();
    expect(numbersIn(b, 'awaiting_payment')).toEqual([second]);
    expect(numbersIn(b, 'payment_confirmed')).toEqual([third, first]);
    const paid = column(b, 'payment_confirmed');
    expect(paid.count).toBe(2);
    expect(paid.sum).toBe((await orderRow(t, first)).total + (await orderRow(t, third)).total);

    const card = paid.cards[1]!;
    const point = await samarkandPoint(t);
    expect(card).toEqual({
      number: first,
      status: 'payment_confirmed',
      payment: 'paid',
      refundOwed: false,
      statusSince: tashkent('2026-11-15 14:00').toISOString(),
      total: (await orderRow(t, first)).total,
      itemCount: 2,
      customer: { name: 'Ali Karimov' },
      city: point.city,
      region: { ru: expect.stringMatching(/^Самарк/), uz: expect.any(String) },
      isGift: false,
    });
    // never moved: in its status since checkout
    expect(column(b, 'awaiting_payment').cards[0]).toMatchObject({
      statusSince: tashkent('2026-11-15 11:00').toISOString(),
      payment: 'unpaid',
      customer: { name: 'Vali' },
    });
  });

  it('a receipt under check says whether the AI is on it or it waits for a person', async () => {
    const checking = await orderAt('2026-11-16 07:00');
    const held = await orderAt('2026-11-16 07:10', vali, 1, 1, '998935556677');
    t.edges.clock.set(tashkent('2026-11-16 08:00'));
    await sendReceipt(checking);
    const receiptId = await sendReceipt(held);
    await t.db.update(receipts).set({ verdict: 'manual_review' }).where(eq(receipts.id, receiptId));
    t.edges.clock.set(tashkent('2026-11-16 09:00'));

    const cards = column(await board(), 'receipt_review').cards;
    expect(cards.map((c) => [c.number, c.payment])).toEqual([
      [checking, 'checking'],
      [held, 'manual_review'],
    ]);
  });

  it('a typed address has no city: the card falls back to the region', async () => {
    t.edges.clock.set(tashkent('2026-11-16 08:00'));
    const client = await cartOf(ali, '998901112233', (await slugs(t, 1))[0]!);
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
    const res = await client.orders.create({
      body: {
        recipientName: 'Ali Valiyev',
        recipientPhone: '+998901234567',
        delivery: {
          kind: 'typed',
          regionId: point.regionId,
          text: 'Ургут, рядом с базаром, дом 12',
        },
        consent: true,
        confirmedTotal: checkout.body.quote.total,
        confirmedDiscount: checkout.body.quote.discount,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    if (res.status !== 201) throw new Error(`order ${res.status}`);
    const [card] = column(await board(), 'awaiting_payment').cards;
    expect(card).toMatchObject({ city: null, region: { ru: expect.stringMatching(/^Самарк/) } });
  });

  it('delivered, cancelled and returned show only the last 14 Tashkent days, newest first', async () => {
    // delivered on the 2nd: 15 days ago, out; the 3rd is day one of the fourteen
    const old = await orderAt('2026-11-02 09:00');
    await pay(t, old);
    await fulfilTo(t, old, 'delivered');
    const edge = await orderAt('2026-11-03 00:10', vali, 1, 1, '998935556677');
    await pay(t, edge);
    await fulfilTo(t, edge, 'delivered');
    const recent = await orderAt('2026-11-15 18:00', ali, 2);
    await pay(t, recent);
    await fulfilTo(t, recent, 'delivered');
    t.edges.clock.set(tashkent('2026-11-15 19:00'));
    await returnWhole(t, recent, 'Флакон протёк в дороге');
    const cancelledOld = await orderAt('2026-11-01 12:00', vali, 3, 1, '998935556677');
    await cancelByStaff(t, cancelledOld);
    const cancelledNew = await orderAt('2026-11-16 08:00', ali, 4);
    await cancelByStaff(t, cancelledNew, 'out_of_stock');
    t.edges.clock.set(tashkent('2026-11-16 09:00'));

    const b = await board();
    expect(numbersIn(b, 'delivered')).toEqual([edge]);
    expect(column(b, 'delivered').count).toBe(1);
    expect(numbersIn(b, 'returned')).toEqual([recent]);
    expect(numbersIn(b, 'cancelled')).toEqual([cancelledNew]);
    expect(column(b, 'cancelled').count).toBe(1);
  });

  it('newest first in a history column; a cancelled paid order owes its money back', async () => {
    const paidThenCancelled = await orderAt('2026-11-14 09:00');
    await pay(t, paidThenCancelled);
    t.edges.clock.set(tashkent('2026-11-14 10:00'));
    await cancelByStaff(t, paidThenCancelled, 'out_of_stock');
    const unpaidCancelled = await orderAt('2026-11-15 09:00', vali, 1, 1, '998935556677');
    await cancelByStaff(t, unpaidCancelled);
    t.edges.clock.set(tashkent('2026-11-16 09:00'));

    const cards = column(await board(), 'cancelled').cards;
    expect(cards.map((c) => [c.number, c.payment, c.refundOwed])).toEqual([
      [unpaidCancelled, 'unpaid', false],
      [paidThenCancelled, 'paid', true],
    ]);
  });

  it('a column carries at most its limit of cards and still counts and adds up them all', async () => {
    const numbers = [
      await orderAt('2026-11-16 06:00'),
      await orderAt('2026-11-16 06:30', vali, 1, 1, '998935556677'),
      await orderAt('2026-11-16 07:00', ali, 2),
    ];
    t.edges.clock.set(tashkent('2026-11-16 09:00'));
    const b = await t.app.get(AdminOrdersService).board({}, 2);
    const waiting = column(b, 'awaiting_payment');
    expect(waiting.cards.map((c) => c.number)).toEqual(numbers.slice(0, 2));
    expect(waiting.count).toBe(3);
    let sum = 0;
    for (const n of numbers) sum += (await orderRow(t, n)).total;
    expect(waiting.sum).toBe(sum);
    expect(b.limit).toBe(2);
  });

  it('the search, the payment state and the dates narrow every column', async () => {
    const aliOrder = await orderAt('2026-11-14 10:00');
    const valiOrder = await orderAt('2026-11-15 10:00', vali, 1, 1, '998935556677');
    await pay(t, valiOrder);
    t.edges.clock.set(tashkent('2026-11-16 09:00'));
    const everywhere = (b: AdminOrdersBoardDto) =>
      b.columns.flatMap((c) => c.cards.map((x) => x.number));

    expect(everywhere(await board({ q: '93 555' }))).toEqual([valiOrder]);
    expect(everywhere(await board({ q: String(aliOrder) }))).toEqual([aliOrder]);
    expect(everywhere(await board({ payment: 'unpaid' }))).toEqual([aliOrder]);
    expect(everywhere(await board({ from: '2026-11-15' }))).toEqual([valiOrder]);
    expect(everywhere(await board({ to: '2026-11-14' }))).toEqual([aliOrder]);
    const none = await board({ q: '7777777' });
    expect(none.columns.every((c) => c.count === 0 && c.sum === 0)).toBe(true);
  });

  it('a city written with a BTS point stays as the order froze it', async () => {
    const number = await orderAt('2026-11-16 08:00');
    const point = await samarkandPoint(t);
    await t.db.update(btsPoints).set({ city: 'Переименован' }).where(eq(btsPoints.id, point.id));
    const [card] = column(await board(), 'awaiting_payment').cards;
    expect(card).toMatchObject({ number, city: point.city });
  });
});
