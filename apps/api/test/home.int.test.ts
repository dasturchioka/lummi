import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminHome, HomeQueue } from '@lummi/contracts';
import {
  and,
  backupStatus,
  eq,
  errorEvents,
  fragrances,
  paymentPauses,
  receipts,
  reviews,
  shopCard,
  userbotHeartbeat,
  volumes,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { ReceiptsService } from '../src/receipts/receipts.service';
import {
  cancelByStaff,
  fulfilTo,
  orderRow,
  pay,
  placeOrder,
  refund,
  returnWhole,
  tashkent,
} from './harness/fulfilment';
import { shopper, slugs } from './harness/orders';
import { recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the admin Home (#48) over HTTP, as the owner and a manager open it. The queue
 * counts are checked against the lists their rows link to; the 7-day figure and the bars against
 * the sales report (#42).
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-14 08:00'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 4801, first_name: 'Ali', last_name: 'Karimov', language_code: 'ru' };
const MIN = 60;

let picked = 0;
/** An order of one 10 ml bottle (a different fragrance each time) placed at Tashkent `at`. */
async function orderAt(at: string) {
  t.edges.clock.set(tashkent(at));
  const [slug] = (await slugs(t, 40)).slice(picked++ % 40);
  const client = await shopper(t, ali, '998901112233');
  const add = await client.cart.addLine({ body: { slug: slug!, ml: 10, qty: 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  return (await placeOrder(t, client)).number;
}

/** The shopper sends a receipt at Tashkent `at`; the AI could not confirm it (#32's verdict). */
async function heldReceipt(number: number, at: string) {
  t.edges.clock.set(tashkent(at));
  const order = await orderRow(t, number);
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  await t.db
    .update(receipts)
    .set({ verdict: 'manual_review', reviewReason: 'not_confirmed' })
    .where(eq(receipts.id, sent.receipt.id));
  return sent.receipt.id;
}

async function payAt(number: number, at: string) {
  t.edges.clock.set(tashkent(at));
  await pay(t, number);
}

async function homeAs(role: 'owner' | 'manager', at?: string): Promise<AdminHome> {
  if (at) t.edges.clock.set(tashkent(at));
  const session = role === 'owner' ? await t.ownerSession() : await t.managerSession();
  const res = await session.client.admin.home();
  if (res.status !== 200) throw new Error(`home ${res.status}`);
  return res.body;
}

describe('the admin Home: who sees what', () => {
  it('is for staff only: without a session it is 401', async () => {
    const res = await t.client.admin.home();
    expect(res.status).toBe(401);
  });

  it('gives the owner the sales strip and the system line, and a manager neither', async () => {
    const owner = await homeAs('owner');
    expect(owner.role).toBe('owner');
    expect(owner).toHaveProperty('sales');
    expect(owner).toHaveProperty('system');

    const manager = await homeAs('manager');
    expect(manager.role).toBe('manager');
    expect(Object.keys(manager).sort()).toEqual(['at', 'cardMissing', 'now', 'queues', 'role']);
    expect(JSON.stringify(manager)).not.toMatch(/sales|system|paid|backup|errors|net/);
  });

  it('answers in Tashkent time', async () => {
    const home = await homeAs('manager', '2026-11-14 23:59');
    expect(home.at).toEqual({ day: '2026-11-14', time: '23:59' });
    const next = await homeAs('manager', '2026-11-15 00:00');
    expect(next.at).toEqual({ day: '2026-11-15', time: '00:00' });
  });
});

describe('the work queue', () => {
  it('reads «Всё сделано» when nothing waits', async () => {
    const home = await homeAs('manager');
    expect(home.now).toEqual({ kind: 'clear' });
    for (const q of [
      'receipts',
      'accept',
      'assemble',
      'bts',
      'credits',
      'refunds',
      'reviews',
    ] as const)
      expect(home.queues[q]).toMatchObject({ count: 0, since: null, waitedSeconds: null });
    expect(home.queues.stock).toEqual({ count: 0, out: 0, low: 0, first: null });
  });

  it('counts each queue and dates its oldest item', async () => {
    // receipts held for a person: the older one at 09:40
    const a = await orderAt('2026-11-14 09:30');
    await heldReceipt(a, '2026-11-14 09:40');
    const b = await orderAt('2026-11-14 09:45');
    await heldReceipt(b, '2026-11-14 09:50');
    // a receipt still waiting for its credit is not a person's yet
    const c = await orderAt('2026-11-14 09:00');
    t.edges.clock.set(tashkent('2026-11-14 09:05'));
    const order = await orderRow(t, c);
    await t.app.get(ReceiptsService).submit(order.customerId, c, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
    // paid at 08:20 and 08:30: two to accept, the oldest paid at 08:20
    const p1 = await orderAt('2026-11-14 08:10');
    await payAt(p1, '2026-11-14 08:20');
    const p2 = await orderAt('2026-11-14 08:15');
    await payAt(p2, '2026-11-14 08:30');
    // accepted yesterday at 18:40; assembling since 07:10
    const acc = await orderAt('2026-11-13 18:00');
    await payAt(acc, '2026-11-13 18:30');
    t.edges.clock.set(tashkent('2026-11-13 18:40'));
    await fulfilTo(t, acc, 'accepted');
    const asm = await orderAt('2026-11-14 06:00');
    await payAt(asm, '2026-11-14 06:10');
    t.edges.clock.set(tashkent('2026-11-14 07:10'));
    await fulfilTo(t, asm, 'assembling');
    // a credit no order holds, 60 000,50 at 07:49
    await recordCredit(t, { som: 60_000, tiyin: 50, at: tashkent('2026-11-14 07:49') });
    // paid, then cancelled at 09:15: its money is owed back
    const cancelled = await orderAt('2026-11-14 09:00');
    await payAt(cancelled, '2026-11-14 09:05');
    t.edges.clock.set(tashkent('2026-11-14 09:15'));
    await cancelByStaff(t, cancelled);
    // stock: one volume sold out, one at the threshold, a hidden fragrance's sold out (not counted)
    const [outSlug, lowSlug, hiddenSlug] = (await slugs(t, 67)).slice(60);
    const volumeOf = async (slug: string, ml: number) => {
      const [v] = await t.db
        .select({ id: volumes.id, fragranceId: volumes.fragranceId, name: fragrances.name })
        .from(volumes)
        .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
        .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
      return v!;
    };
    const out = await volumeOf(outSlug!, 30);
    const low = await volumeOf(lowSlug!, 50);
    const hidden = await volumeOf(hiddenSlug!, 10);
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, out.id));
    await t.db.update(volumes).set({ onHand: 3 }).where(eq(volumes.id, low.id));
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, hidden.id));
    await t.db
      .update(fragrances)
      .set({ hidden: true })
      .where(eq(fragrances.id, hidden.fragranceId));
    // a review finished at 08:05 waits for a decision; another is published
    const delivered = await orderRow(t, acc);
    t.edges.clock.set(tashkent('2026-11-14 08:05'));
    await t.db.insert(reviews).values([
      {
        orderId: delivered.id,
        customerId: delivered.customerId,
        rating: 5,
        comment: 'Очень стойкий',
        step: 'done',
        stepAt: tashkent('2026-11-14 08:05'),
        createdAt: tashkent('2026-11-14 08:01'),
      },
      {
        orderId: (await orderRow(t, asm)).id,
        customerId: delivered.customerId,
        rating: 4,
        step: 'done',
        stepAt: tashkent('2026-11-14 08:02'),
        published: true,
        publishedAt: tashkent('2026-11-14 08:06'),
        createdAt: tashkent('2026-11-14 08:01'),
      },
    ]);

    const home = await homeAs('manager', '2026-11-14 10:00');
    const q = home.queues;
    expect(q.receipts).toEqual({
      count: 2,
      since: { day: '2026-11-14', time: '09:40' },
      waitedSeconds: 20 * MIN,
    });
    expect(q.accept).toEqual({
      count: 2,
      since: { day: '2026-11-14', time: '08:20' },
      waitedSeconds: 100 * MIN,
    });
    expect(q.assemble).toEqual({
      count: 1,
      since: { day: '2026-11-13', time: '18:40' },
      waitedSeconds: (15 * 60 + 20) * MIN,
    });
    expect(q.bts).toEqual({
      count: 1,
      since: { day: '2026-11-14', time: '07:10' },
      waitedSeconds: 170 * MIN,
    });
    expect(q.credits).toEqual({
      count: 1,
      since: { day: '2026-11-14', time: '07:49' },
      waitedSeconds: 131 * MIN,
      oldestAmountTiyin: 6_000_050,
    });
    expect(q.refunds).toEqual({
      count: 1,
      since: { day: '2026-11-14', time: '09:15' },
      waitedSeconds: 45 * MIN,
    });
    expect(q.stock).toEqual({
      count: 2,
      out: 1,
      low: 1,
      first: { kind: 'volume', name: out.name, ml: 30, available: 0, level: 'zero' },
    });
    expect(q.reviews).toEqual({
      count: 1,
      since: { day: '2026-11-14', time: '08:05' },
      waitedSeconds: 115 * MIN,
    });

    // every row's link opens a list of exactly its items
    const manager = (await t.managerSession()).client.admin;
    const orders = async (query: object) => {
      const res = await manager.orders.list({ query });
      return res.status === 200 ? res.body.total : -1;
    };
    const links: Record<Exclude<HomeQueue, 'stock'>, () => Promise<number>> = {
      receipts: () => orders({ payment: 'manual_review' }),
      accept: () => orders({ status: 'payment_confirmed' }),
      assemble: () => orders({ status: 'accepted' }),
      bts: () => orders({ status: 'assembling' }),
      credits: async () => {
        const res = await manager.credits.list({ query: { linked: 'unlinked' } });
        return res.status === 200 ? res.body.total : -1;
      },
      refunds: () => orders({ payment: 'refund_owed' }),
      reviews: async () => {
        const res = await manager.reviews.list({ query: { state: 'waiting' } });
        return res.status === 200 ? res.body.total : -1;
      },
    };
    for (const [key, listed] of Object.entries(links))
      expect([key, await listed()]).toEqual([key, q[key as keyof typeof links].count]);
    const stock = await manager.stock.list({
      query: { filter: 'low', visibility: 'visible', pageSize: 50 },
    });
    expect(stock.status === 200 && stock.body.rows.map((r) => r.key).sort()).toEqual(
      [`v${out.id}`, `v${low.id}`].sort(),
    );

    // the first queue that is not empty is the Now item: the receipt
    expect(home.now).toMatchObject({ kind: 'receipt', number: a, waitedSeconds: 20 * MIN });
  });

  it('lists refund owed until the refunds cover what paid the order', async () => {
    const n = await orderAt('2026-11-13 10:00');
    await payAt(n, '2026-11-13 10:05');
    t.edges.clock.set(tashkent('2026-11-13 10:10'));
    await fulfilTo(t, n, 'delivered');
    t.edges.clock.set(tashkent('2026-11-13 12:00'));
    await returnWhole(t, n, 'Не подошёл аромат');
    const paid = (await orderRow(t, n)).amountDue;

    let home = await homeAs('manager', '2026-11-14 09:00');
    expect(home.queues.refunds.count).toBe(1);
    expect(home.now).toMatchObject({ kind: 'refund', number: n, status: 'returned', owed: paid });

    await refund(t, n, paid - 1000, '2026-11-14');
    home = await homeAs('manager');
    expect(home.now).toMatchObject({ kind: 'refund', owed: 1000 });
    await refund(t, n, 1000, '2026-11-14');
    home = await homeAs('manager');
    expect(home.queues.refunds.count).toBe(0);
    expect(home.now).toEqual({ kind: 'clear' });
  });
});

describe('reviews waiting for a decision', () => {
  /** A review of a fresh order, as the bot leaves it: `step` and when it got there. */
  async function review(at: string, step: 'comment' | 'photos' | 'done', rating = 5) {
    const n = await orderAt(at);
    const o = await orderRow(t, n);
    const [r] = await t.db
      .insert(reviews)
      .values({
        orderId: o.id,
        customerId: o.customerId,
        rating,
        step,
        stepAt: tashkent(at),
        createdAt: tashkent(at),
      })
      .returning();
    return { id: r!.id, number: n };
  }

  it('counts finished reviews nobody decided, within reviews.homeQueueDays', async () => {
    const old = await review('2026-11-06 12:00', 'done'); // 8 days before: past the 7-day default
    await review('2026-11-14 08:30', 'comment'); // the customer is still writing
    const decided = await review('2026-11-12 10:00', 'done');
    const hidden = await review('2026-11-12 11:00', 'done');
    const waiting = await review('2026-11-13 09:00', 'done', 2);
    const owner = await t.ownerSession();
    // published, then hidden again: decided, so it never comes back
    for (const published of [true, false])
      await owner.client.admin.reviews.setPublished({
        params: { id: hidden.id },
        body: { published },
      });
    await owner.client.admin.reviews.setPublished({
      params: { id: decided.id },
      body: { published: true },
    });

    let home = await homeAs('manager', '2026-11-14 09:00');
    expect(home.queues.reviews).toEqual({
      count: 1,
      since: { day: '2026-11-13', time: '09:00' },
      waitedSeconds: 24 * 60 * MIN,
    });
    expect(home.now).toMatchObject({ kind: 'review', number: waiting.number, rating: 2 });
    const manager = (await t.managerSession()).client.admin;
    const listed = await manager.reviews.list({ query: { state: 'waiting' } });
    expect(listed.status === 200 && listed.body.items.map((r) => r.id)).toEqual([waiting.id]);

    // a longer window brings the older one back, in the Home and in its list alike
    await owner.client.admin.settings.update({
      params: { key: 'reviews.homeQueueDays' },
      body: { value: 10 },
    });
    home = await homeAs('manager');
    expect(home.queues.reviews.count).toBe(2);
    expect(home.now).toMatchObject({ kind: 'review', number: old.number });
    const longer = await manager.reviews.list({ query: { state: 'waiting' } });
    expect(longer.status === 200 && longer.body.total).toBe(2);
  });
});

describe('the Now item', () => {
  it('measures a held receipt against the alert setting, with its candidate credit', async () => {
    const n = await orderAt('2026-11-14 09:00');
    await heldReceipt(n, '2026-11-14 09:10');
    const due = (await orderRow(t, n)).amountDue;
    await recordCredit(t, { som: due, at: tashkent('2026-11-14 09:08') });
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'payments.uncheckedReceiptAlertSeconds' },
      body: { value: 600 },
    });

    const home = await homeAs('manager', '2026-11-14 09:16');
    expect(home.now).toEqual({
      kind: 'receipt',
      number: n,
      customer: 'Ali Karimov',
      amountDue: due,
      waitedSeconds: 6 * MIN,
      alertSeconds: 600,
      alerted: false,
      reviewReason: 'not_confirmed',
      credit: {
        amountTiyin: due * 100,
        at: { day: '2026-11-14', time: '09:08' },
        cardLast4: '1234',
      },
    });
  });

  it('names who confirmed a payment waiting to be accepted', async () => {
    const n = await orderAt('2026-11-14 09:00');
    await payAt(n, '2026-11-14 09:05');
    const home = await homeAs('manager', '2026-11-14 09:46');
    const o = await orderRow(t, n);
    expect(home.now).toMatchObject({
      kind: 'accept',
      number: n,
      customer: 'Ali Karimov',
      total: o.total,
      line: { ml: 10, qty: 1 },
      moreLines: 0,
      since: { day: '2026-11-14', time: '09:05' },
      waitedSeconds: 41 * MIN,
      confirmedBy: { type: 'ai' },
    });
  });

  it('gives the slot to an open Humo pause for both roles', async () => {
    const n = await orderAt('2026-11-14 09:00');
    await heldReceipt(n, '2026-11-14 09:10');
    await t.db.insert(userbotHeartbeat).values({ seenAt: tashkent('2026-11-14 09:20') });
    await t.db
      .insert(paymentPauses)
      .values({ cause: 'heartbeat', startedAt: tashkent('2026-11-14 09:20') });

    for (const role of ['owner', 'manager'] as const) {
      const home = await homeAs(role, '2026-11-14 09:54');
      expect(home.now).toEqual({
        kind: 'humo_pause',
        silentSeconds: 34 * MIN,
        lastSignal: { day: '2026-11-14', time: '09:20' },
      });
      expect(home.queues.receipts.count).toBe(1);
    }
    const owner = await homeAs('owner');
    expect(owner.role === 'owner' && owner.system.humo).toEqual({
      beatSeconds: 34 * MIN,
      paused: true,
    });
  });

  it('without a shop card: the owner is asked to set it, a manager keeps their item', async () => {
    const n = await orderAt('2026-11-14 09:00');
    await payAt(n, '2026-11-14 09:05');
    await t.db.delete(shopCard);

    const owner = await homeAs('owner', '2026-11-14 09:30');
    expect(owner).toMatchObject({ cardMissing: true, now: { kind: 'no_card' } });
    const manager = await homeAs('manager');
    expect(manager).toMatchObject({ cardMissing: true, now: { kind: 'accept', number: n } });
  });
});

describe('the owner strip', () => {
  it('counts money in today from payments confirmed since Tashkent midnight', async () => {
    // a week ago (Saturday 7 November): one paid at 00:30, one at 09:30 (after this hour)
    const w1 = await orderAt('2026-11-07 00:20');
    await payAt(w1, '2026-11-07 00:30');
    const w2 = await orderAt('2026-11-07 09:20');
    await payAt(w2, '2026-11-07 09:30');
    // yesterday 23:59 (not today), today 00:00 and 08:00
    const y = await orderAt('2026-11-13 23:50');
    await payAt(y, '2026-11-13 23:59');
    const d1 = await orderAt('2026-11-13 23:55');
    await payAt(d1, '2026-11-14 00:00');
    const d2 = await orderAt('2026-11-14 07:50');
    await payAt(d2, '2026-11-14 08:00');
    // a credit that paid nothing is not money for an order
    await recordCredit(t, { som: 99_000, at: tashkent('2026-11-14 08:30') });

    const due = async (n: number) => (await orderRow(t, n)).amountDue;
    const today = (await due(d1)) + (await due(d2));
    const home = await homeAs('owner', '2026-11-14 09:00');
    if (home.role !== 'owner') throw new Error('not the owner');
    expect(home.sales.paidToday).toEqual({
      orders: 2,
      received: today,
      average: Math.round(today / 2),
    });
    expect(home.sales.paidWeekAgo).toEqual({
      orders: 1,
      received: await due(w1),
      average: await due(w1),
    });

    // the cards open the orders list on `paidOn`: the same orders, the one paid after midnight
    // for an order placed before it included
    const owner = await t.ownerSession();
    const paidOn = async (day: string) => {
      const res = await owner.client.admin.orders.list({ query: { paidOn: day } });
      if (res.status !== 200) throw new Error(`orders ${res.status}`);
      return res.body.items.map((i) => i.number).sort((a, b) => a - b);
    };
    expect(await paidOn('2026-11-14')).toEqual([d1, d2].sort((a, b) => a - b));
    expect(await paidOn('2026-11-13')).toEqual([y]);
    expect(await paidOn('2026-11-07')).toEqual([w1, w2].sort((a, b) => a - b));
  });

  it('opens on paidOn exactly the orders it counts, whatever came after', async () => {
    // paid today, then cancelled and the money sent back: still money in today
    const back = await orderAt('2026-11-14 07:00');
    await payAt(back, '2026-11-14 07:10');
    await cancelByStaff(t, back);
    await refund(t, back, (await orderRow(t, back)).amountDue, '2026-11-14');
    // a credit with no receipt, linked by a manager
    const linked = await orderAt('2026-11-14 07:30');
    t.edges.clock.set(tashkent('2026-11-14 07:40'));
    const creditId = await recordCredit(t, { som: (await orderRow(t, linked)).amountDue });
    const manager = await t.managerSession();
    const confirmed = await manager.client.admin.orders.confirmPayment({
      params: { number: linked },
      body: { creditId, receiptId: null },
    });
    expect(confirmed.status).toBe(200);

    const home = await homeAs('owner', '2026-11-14 09:00');
    if (home.role !== 'owner') throw new Error('not the owner');
    const owner = await t.ownerSession();
    const list = (query: Record<string, string>) => owner.client.admin.orders.list({ query });
    const res = await list({ paidOn: '2026-11-14' });
    if (res.status !== 200) throw new Error(`orders ${res.status}`);
    expect(res.body.items.map((i) => i.number).sort((a, b) => a - b)).toEqual(
      [back, linked].sort((a, b) => a - b),
    );
    expect(res.body.total).toBe(home.sales.paidToday.orders);
    // with the other filters, and a day that is no day
    const cancelled = await list({ paidOn: '2026-11-14', status: 'cancelled' });
    expect(cancelled.status === 200 && cancelled.body.items.map((i) => i.number)).toEqual([back]);
    const nonsense = await fetch(`${t.baseUrl}/admin/orders?paidOn=yesterday`, {
      headers: { cookie: owner.cookie },
    });
    expect(nonsense.status).toBe(400);
  });

  it('counts a credit with tiyin in whole so’m', async () => {
    const n = await orderAt('2026-11-14 08:00');
    const order = await orderRow(t, n);
    const sent = await t.app
      .get(ReceiptsService)
      .submit(order.customerId, n, await uniqueReceiptImage(), {
        fileName: 'c.png',
        source: 'miniapp',
      });
    if (sent.kind !== 'submitted') throw new Error(sent.kind);
    const creditId = await recordCredit(t, { som: order.amountDue, tiyin: 75 });
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.confirmPayment({
      params: { number: n },
      body: {
        receiptId: sent.receipt.id,
        creditId,
        reason: 'Перевели с копейками, сумма та же',
      },
    });
    expect(res.status).toBe(200);
    const home = await homeAs('owner');
    expect(home.role === 'owner' && home.sales.paidToday).toEqual({
      orders: 1,
      received: order.amountDue,
      average: order.amountDue,
    });
  });

  it('takes the 7-day net sales and the 14 bars from the sales report', async () => {
    for (const [placed, delivered] of [
      ['2026-11-01 10:00', '2026-11-02 12:00'],
      ['2026-11-05 10:00', '2026-11-07 23:59'],
      ['2026-11-07 10:00', '2026-11-08 00:01'],
      ['2026-11-12 10:00', '2026-11-14 08:30'],
    ] as const) {
      const n = await orderAt(placed);
      await payAt(n, placed.replace(':00', ':05'));
      await fulfilTo(t, n, 'handed_to_bts');
      t.edges.clock.set(tashkent(delivered));
      await fulfilTo(t, n, 'delivered');
    }
    const home = await homeAs('owner', '2026-11-14 09:00');
    if (home.role !== 'owner') throw new Error('not the owner');
    const owner = (await t.ownerSession()).client.admin;
    const report = async (from: string, to: string) => {
      const res = await owner.reports.sales({ query: { from, to } });
      if (res.status !== 200) throw new Error(`report ${res.status}`);
      return res.body;
    };
    const week = await report('2026-11-08', '2026-11-14');
    const before = await report('2026-11-01', '2026-11-07');
    const fortnight = await report('2026-11-01', '2026-11-14');
    expect(home.sales.week).toEqual({ from: '2026-11-08', to: '2026-11-14', net: week.totals.net });
    expect(home.sales.previousWeek).toEqual({
      from: '2026-11-01',
      to: '2026-11-07',
      net: before.totals.net,
    });
    expect(home.sales.days).toEqual(fortnight.days.map((d) => ({ day: d.day, net: d.net })));
    expect(home.sales.days).toHaveLength(14);
    expect(week.totals.orders).toBe(2);
    expect(before.totals.orders).toBe(2);
  });

  it('reports the userbot, the last backup and the errors of the last 24 hours', async () => {
    await t.db.insert(userbotHeartbeat).values({ seenAt: tashkent('2026-11-14 08:59') });
    await t.db.insert(backupStatus).values({ lastSuccessAt: tashkent('2026-11-14 03:00') });
    const seen = (fingerprint: string, at: string) => ({
      fingerprint,
      errorClass: 'Error',
      route: 'GET /x',
      frames: 'a.ts',
      firstSeenAt: tashkent(at),
      lastSeenAt: tashkent(at),
    });
    await t.db
      .insert(errorEvents)
      .values([
        seen('a', '2026-11-13 09:01'),
        seen('b', '2026-11-14 08:00'),
        seen('c', '2026-11-13 08:59'),
      ]);

    const home = await homeAs('owner', '2026-11-14 09:00');
    expect(home.role === 'owner' && home.system).toEqual({
      humo: { beatSeconds: 60, paused: false },
      backup: { at: { day: '2026-11-14', time: '03:00' }, stale: false },
      errors24h: 2,
    });

    await t.db.delete(backupStatus);
    await t.db.delete(userbotHeartbeat);
    const later = await homeAs('owner');
    expect(later.role === 'owner' && later.system).toMatchObject({
      humo: { beatSeconds: null },
      backup: { at: null, stale: true },
    });
  });
});
