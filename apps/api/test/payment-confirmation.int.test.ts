import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, credits, eq, fragrances, orderEvents, orders, outbox, receipts } from '@lummi/db';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { orderBody, samarkandPoint, shopper } from './harness/orders';
import { recordCredit } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the one door that links a Credit to an order and confirms its payment
 * (ADR 0011, 0012). The receipt AI (#32) and a manager in the admin panel (#33) both go through it.
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
  t.edges.clock.set(new Date('2026-11-09T10:00:30Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** One 10 ml bottle ordered by Ali; the order as stored and a client of its shopper. */
async function placeOrder(user: TestUser = ali, phone = '998901234567') {
  const client = await shopper(t, user, phone);
  const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
  if ((await client.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: 1 } })).status !== 200)
    throw new Error('add');
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  const [order] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  return { order: order!, client };
}

const confirm = (input: Parameters<PaymentConfirmation['confirmPayment']>[0]) =>
  t.app.get(PaymentConfirmation).confirmPayment(input);

/** A small receipt screenshot for the intake. */
const RECEIPT_IMAGE = sharp({
  create: { width: 300, height: 600, channels: 3, background: '#ffffff' },
})
  .png()
  .toBuffer();

/** The shopper sends a receipt for the order (#28): the order is then «Чек на проверке». */
async function sendReceipt(order: { customerId: number; number: number }) {
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, order.number, await RECEIPT_IMAGE, {
      fileName: null,
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`receipt: ${sent.kind}`);
  return sent.receipt.id;
}

const orderNow = async (id: number) =>
  (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const receiptNow = async (id: number) =>
  (await t.db.select().from(receipts).where(eq(receipts.id, id)))[0]!;

/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table` and releases it only once
 * `waiters` sessions are blocked on a lock, so the race is real.
 */
async function whileTableLocked<T>(table: string, waiters: number, run: () => Promise<T>) {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    for (const deadline = Date.now() + 10_000; ;) {
      const { rows } = await locker.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity
         where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
      );
      if (rows[0]!.n >= waiters) break;
      if (Date.now() > deadline)
        throw new Error(`only ${rows[0]!.n} of ${waiters} sessions reached a lock`);
      await new Promise((r) => setTimeout(r, 20));
    }
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

/** The texts queued for shoppers (the outbox, ADR 0021), oldest first. */
const said = async () =>
  (await t.db.select().from(outbox).orderBy(asc(outbox.id))).map((r) => r.text);

describe('a manager links a credit that came with no receipt', () => {
  it('confirms the order: the credit is linked, the move is in the history and the audit by name, the shopper is told', async () => {
    const { order, client } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = await t.managerSession();

    const out = await confirm({
      orderId: order.id,
      creditId,
      receiptId: null,
      actor: { type: 'staff', id: manager.staff.id },
    });

    expect(out.kind).toBe('confirmed');
    const seen = await client.orders.get({ params: { number: order.number } });
    expect(seen.status === 200 && seen.body.status).toBe('payment_confirmed');
    const [linked] = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect(linked!.creditId).toBe(creditId);
    const events = await t.db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events.at(-1)).toMatchObject({
      action: 'confirm_payment',
      fromStatus: 'awaiting_payment',
      toStatus: 'payment_confirmed',
      actorType: 'staff',
      actorId: manager.staff.id,
      payload: { creditId, receiptId: null },
    });
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items).toMatchObject([
      {
        actorType: 'staff',
        actorName: manager.staff.name,
        targetId: String(order.id),
        payload: { number: order.number, creditId, receiptId: null },
      },
    ]);
    expect((await said()).at(-1)).toContain(`Оплата заказа № ${order.number} подтверждена`);
  });
});

describe('the credit must be able to pay the order', () => {
  it('a credit already linked is never reused: 409, the second order stays unpaid', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    expect(second.order.amountDue).toBe(first.order.amountDue);
    const creditId = await recordCredit(t, { som: first.order.amountDue });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    expect(
      (await confirm({ orderId: first.order.id, creditId, receiptId: null, actor: manager })).kind,
    ).toBe('confirmed');
    const messagesBefore = (await said()).length;

    const again = await confirm({
      orderId: second.order.id,
      creditId,
      receiptId: null,
      actor: manager,
    });

    expect(again).toEqual({ kind: 'credit_taken', orderId: first.order.id });
    expect(await orderNow(second.order.id)).toMatchObject({
      status: 'awaiting_payment',
      creditId: null,
    });
    expect((await orderNow(first.order.id)).creditId).toBe(creditId);
    expect(await said()).toHaveLength(messagesBefore);
  });

  it('the database itself refuses a second order for one credit', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const creditId = await recordCredit(t, { som: first.order.amountDue });
    await t.db.update(orders).set({ creditId }).where(eq(orders.id, first.order.id));
    await expect(
      t.db.update(orders).set({ creditId }).where(eq(orders.id, second.order.id)),
    ).rejects.toThrow();
  });

  it('another amount, or tiyin on top, never pays the order', async () => {
    const { order } = await placeOrder();
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    for (const credit of [
      { som: order.amountDue - 1 },
      { som: order.amountDue + 1000 },
      { som: order.amountDue, tiyin: 50 },
    ]) {
      const creditId = await recordCredit(t, credit);
      expect(
        await confirm({ orderId: order.id, creditId, receiptId: null, actor: manager }),
      ).toEqual({ kind: 'credit_mismatch', reason: 'amount' });
    }
    expect(await orderNow(order.id)).toMatchObject({ status: 'awaiting_payment', creditId: null });
  });

  it("a credit from before the order never pays it; one in the order's own minute does", async () => {
    // the order is created at 10:00:30; Humo writes minutes only
    const { order } = await placeOrder();
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const before = await recordCredit(t, {
      som: order.amountDue,
      at: new Date('2026-11-09T09:59:59Z'),
    });
    expect(
      await confirm({ orderId: order.id, creditId: before, receiptId: null, actor: manager }),
    ).toEqual({ kind: 'credit_mismatch', reason: 'before_order' });
    const sameMinute = await recordCredit(t, {
      som: order.amountDue,
      at: new Date('2026-11-09T10:00:05Z'),
    });
    expect(
      (await confirm({ orderId: order.id, creditId: sameMinute, receiptId: null, actor: manager }))
        .kind,
    ).toBe('confirmed');
  });

  it('an unknown order, credit or receipt is not found', async () => {
    const { order } = await placeOrder();
    const other = await placeOrder(vali, '998907654321');
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    expect(await confirm({ orderId: 9999, creditId, receiptId: null, actor: manager })).toEqual({
      kind: 'not_found',
      what: 'order',
    });
    expect(
      await confirm({ orderId: order.id, creditId: 9999, receiptId: null, actor: manager }),
    ).toEqual({ kind: 'not_found', what: 'credit' });
    // another order's receipt is not this order's
    const othersReceipt = await sendReceipt(other.order);
    await sendReceipt(order);
    expect(
      await confirm({ orderId: order.id, creditId, receiptId: othersReceipt, actor: manager }),
    ).toEqual({ kind: 'not_found', what: 'receipt' });
  });
});

describe('a receipt under check', () => {
  it('the AI confirms it: the receipt is AI-confirmed and the audit names the AI', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    const creditId = await recordCredit(t, { som: order.amountDue });

    const out = await confirm({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } });

    expect(out.kind).toBe('confirmed');
    expect(await orderNow(order.id)).toMatchObject({ status: 'payment_confirmed', creditId });
    expect((await receiptNow(receiptId)).verdict).toBe('ai_confirmed');
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items).toMatchObject([
      {
        actorType: 'ai',
        actorId: null,
        targetId: String(order.id),
        payload: { from: 'receipt_review', to: 'payment_confirmed', creditId, receiptId },
      },
    ]);
    expect((await said()).at(-1)).toContain(`Оплата заказа № ${order.number} подтверждена`);
  });

  it('a manager confirms one held for manual review: the receipt is manager-confirmed', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    await t.db.update(receipts).set({ verdict: 'manual_review' }).where(eq(receipts.id, receiptId));
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = await t.managerSession();

    const out = await confirm({
      orderId: order.id,
      creditId,
      receiptId,
      actor: { type: 'staff', id: manager.staff.id },
    });

    expect(out.kind).toBe('confirmed');
    expect((await receiptNow(receiptId)).verdict).toBe('manager_confirmed');
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'confirm_payment'));
    expect(event).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
  });

  it('the AI never confirms without a receipt, and nothing changes', async () => {
    const { order } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue });
    expect(
      await confirm({ orderId: order.id, creditId, receiptId: null, actor: { type: 'ai' } }),
    ).toEqual({ kind: 'refused', code: 'forbidden' });
    expect(await orderNow(order.id)).toMatchObject({ status: 'awaiting_payment', creditId: null });
  });

  it('the AI only links a credit on the shop card; a manager may link one from an earlier card', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    const creditId = await recordCredit(t, { som: order.amountDue, last4: '9999' });
    expect(
      await confirm({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } }),
    ).toEqual({ kind: 'credit_mismatch', reason: 'card' });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    expect((await confirm({ orderId: order.id, creditId, receiptId, actor: manager })).kind).toBe(
      'confirmed',
    );
  });

  it('a stale screen is a conflict: the order moved on, or a receipt arrived meanwhile', async () => {
    const { order } = await placeOrder();
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const receiptId = await sendReceipt(order);
    const creditId = await recordCredit(t, { som: order.amountDue });
    // the manager's screen still showed «Ожидает оплаты» with no receipt
    const stale = await confirm({ orderId: order.id, creditId, receiptId: null, actor: manager });
    expect(stale.kind === 'conflict' && stale.order.status).toBe('receipt_review');
    expect((await confirm({ orderId: order.id, creditId, receiptId, actor: manager })).kind).toBe(
      'confirmed',
    );
    // a second press
    const twice = await confirm({ orderId: order.id, creditId, receiptId, actor: manager });
    expect(twice.kind === 'conflict' && twice.order.status).toBe('payment_confirmed');
    expect(
      await t.db.select().from(orderEvents).where(eq(orderEvents.action, 'confirm_payment')),
    ).toHaveLength(1);
  });

  it('a receipt decided meanwhile is not confirmed again', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    await t.db.update(receipts).set({ verdict: 'rejected' }).where(eq(receipts.id, receiptId));
    const creditId = await recordCredit(t, { som: order.amountDue });
    expect(
      await confirm({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } }),
    ).toEqual({ kind: 'receipt_not_waiting', verdict: 'rejected' });
    expect((await orderNow(order.id)).status).toBe('receipt_review');
  });
});

describe('races', () => {
  it('two orders racing for one credit: exactly one is paid, the other hears credit_taken, never a 500', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const [r1, r2] = [await sendReceipt(first.order), await sendReceipt(second.order)];
    const creditId = await recordCredit(t, { som: first.order.amountDue });

    // both reach the credit's lock before either may take it
    const outs = await whileTableLocked('credits', 2, () =>
      Promise.all([
        confirm({ orderId: first.order.id, creditId, receiptId: r1, actor: { type: 'ai' } }),
        confirm({ orderId: second.order.id, creditId, receiptId: r2, actor: { type: 'ai' } }),
      ]),
    );

    expect(outs.map((o) => o.kind).sort()).toEqual(['confirmed', 'credit_taken']);
    const paid = await t.db.select().from(orders).where(eq(orders.creditId, creditId));
    expect(paid).toHaveLength(1);
    const loser = outs[0]!.kind === 'confirmed' ? second : first;
    const loserReceipt = loser === first ? r1 : r2;
    expect(await orderNow(loser.order.id)).toMatchObject({
      status: 'receipt_review',
      creditId: null,
    });
    // the loser keeps waiting for its own money
    expect((await receiptNow(loserReceipt)).verdict).toBe('pending');
    const [credit] = await t.db.select().from(credits).where(eq(credits.id, creditId));
    expect(credit).toBeDefined();
  });

  it('the AI and a manager confirming one order at once: one move, the other a conflict', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    const [c1, c2] = [
      await recordCredit(t, { som: order.amountDue }),
      await recordCredit(t, { som: order.amountDue }),
    ];
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };

    const outs = await whileTableLocked('orders', 2, () =>
      Promise.all([
        confirm({ orderId: order.id, creditId: c1, receiptId, actor: { type: 'ai' } }),
        confirm({ orderId: order.id, creditId: c2, receiptId, actor: manager }),
      ]),
    );

    expect(outs.map((o) => o.kind).sort()).toEqual(['confirmed', 'conflict']);
    expect(
      await t.db.select().from(orderEvents).where(eq(orderEvents.action, 'confirm_payment')),
    ).toHaveLength(1);
    // exactly one credit is linked; the other stays free for another order
    const linked = await t.db.select().from(orders).where(eq(orders.id, order.id));
    expect([c1, c2]).toContain(linked[0]!.creditId);
  });
});
