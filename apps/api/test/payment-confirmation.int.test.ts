import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  asc,
  credits,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
  inArray,
  orderEvents,
  orders,
  outbox,
  receipts,
} from '@lummi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { SettingsService } from '../src/settings/settings.service';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { orderBody, samarkandPoint, shopper } from './harness/orders';
import { payWithCredit, recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the one door that links a Credit to an order and confirms its payment
 * (ADR 0011, 0012). The receipt AI (#32) and a manager in the admin panel (#33) both go through it.
 */

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
  await t.seedCatalog();
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

/** The shopper sends a receipt for the order (#28): the order is then «Чек на проверке». */
async function sendReceipt(order: { customerId: number; number: number }, file?: Buffer) {
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, order.number, file ?? (await uniqueReceiptImage()), {
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

  it('another amount, or tiyin on top: never for the AI; a manager must say why', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    for (const credit of [
      { som: order.amountDue - 1 },
      { som: order.amountDue + 1000 },
      { som: order.amountDue, tiyin: 50 },
    ]) {
      const creditId = await recordCredit(t, credit);
      expect(
        await confirm({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } }),
      ).toEqual({ kind: 'credit_mismatch', what: 'amount' });
      // a reason never lets the AI through
      expect(
        await confirm({
          orderId: order.id,
          creditId,
          receiptId,
          actor: { type: 'ai' },
          reason: 'Округлил сумму',
        }),
      ).toEqual({ kind: 'credit_mismatch', what: 'amount' });
      expect(await confirm({ orderId: order.id, creditId, receiptId, actor: manager })).toEqual({
        kind: 'reason_required',
        mismatch: ['amount'],
      });
    }
    expect(await orderNow(order.id)).toMatchObject({ status: 'receipt_review', creditId: null });
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
  });

  it('a manager links an overpayment with a reason: the difference is in the history and the audit', async () => {
    const { order } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue + 1000 });
    const manager = await t.managerSession();
    const reason = 'Клиент округлил перевод, разницу вернём';

    const out = await confirm({
      orderId: order.id,
      creditId,
      receiptId: null,
      actor: { type: 'staff', id: manager.staff.id },
      reason: `  ${reason} `,
    });

    expect(out).toMatchObject({ kind: 'confirmed', offShopCard: false });
    const facts = {
      creditId,
      receiptId: null,
      amountDue: order.amountDue,
      creditAmountTiyin: (order.amountDue + 1000) * 100,
      differenceTiyin: 100_000,
      cardLast4: '1234',
      offShopCard: false,
    };
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'confirm_payment'));
    expect(event).toMatchObject({ reason, payload: facts });
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items[0]!.payload).toMatchObject({
      ...facts,
      reason,
    });
  });

  it('an underpayment by tiyin, with a reason, records the exact difference', async () => {
    const { order } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue - 1, tiyin: 50 });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const out = await confirm({
      orderId: order.id,
      creditId,
      receiptId: null,
      actor: manager,
      reason: 'Не хватает 50 тийинов, принимаем',
    });
    expect(out.kind).toBe('confirmed');
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'confirm_payment'));
    expect(event!.payload).toMatchObject({
      creditAmountTiyin: order.amountDue * 100 - 50,
      differenceTiyin: -50,
    });
  });

  it('a reason is a few characters at least, and no longer than the setting', async () => {
    const { order } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue + 1000 });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    await t.app.get(SettingsService).set('payments.linkReasonMaxLength', 30, { type: 'system' });
    for (const reason of ['  ', 'ok', 'x'.repeat(31)]) {
      expect(
        await confirm({ orderId: order.id, creditId, receiptId: null, actor: manager, reason }),
      ).toEqual({ kind: 'reason_invalid', min: 3, max: 30 });
    }
    expect(
      (
        await confirm({
          orderId: order.id,
          creditId,
          receiptId: null,
          actor: manager,
          reason: 'x'.repeat(30),
        })
      ).kind,
    ).toBe('confirmed');
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
    ).toEqual({ kind: 'credit_mismatch', what: 'before_order' });
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

  it('a credit on another card: never for the AI; a manager with a reason, marked off the shop card', async () => {
    const { order } = await placeOrder();
    const receiptId = await sendReceipt(order);
    const creditId = await recordCredit(t, { som: order.amountDue, last4: '9999' });
    expect(
      await confirm({ orderId: order.id, creditId, receiptId, actor: { type: 'ai' } }),
    ).toEqual({ kind: 'credit_mismatch', what: 'card' });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    expect(await confirm({ orderId: order.id, creditId, receiptId, actor: manager })).toEqual({
      kind: 'reason_required',
      mismatch: ['card'],
    });

    const out = await confirm({
      orderId: order.id,
      creditId,
      receiptId,
      actor: manager,
      reason: 'Перевёл на старую карту магазина',
    });

    expect(out).toMatchObject({ kind: 'confirmed', offShopCard: true });
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'confirm_payment'));
    expect(event).toMatchObject({
      reason: 'Перевёл на старую карту магазина',
      payload: { cardLast4: '9999', offShopCard: true, differenceTiyin: 0 },
    });
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

describe('the one door', () => {
  it('no one else makes the confirm_payment move, not even with a full payload', async () => {
    const { order } = await placeOrder();
    const creditId = await recordCredit(t, { som: order.amountDue });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const payload = {
      creditId,
      receiptId: null,
      amountDue: order.amountDue,
      creditAmountTiyin: order.amountDue * 100,
      differenceTiyin: 0,
      cardLast4: '1234',
      offShopCard: false,
    };
    const machine = t.app.get(OrderStatusService);

    expect(
      await machine.transition(order.id, 'confirm_payment', manager, 'awaiting_payment', payload),
    ).toEqual({ kind: 'refused', code: 'forbidden' });
    expect(
      await t.db.transaction((tx) =>
        machine.transitionIn(tx, order.id, 'confirm_payment', manager, 'awaiting_payment', payload),
      ),
    ).toEqual({ kind: 'refused', code: 'forbidden' });

    expect(await orderNow(order.id)).toMatchObject({ status: 'awaiting_payment', creditId: null });
    // the capability went to PaymentConfirmation when the app started, and only to it
    expect(() => machine.issueDoor('confirm_payment')).toThrow();
  });

  it('a unique violation on the link answers credit_taken, never a 500', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const creditId = await recordCredit(t, { som: first.order.amountDue });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    // a writer outside the door links the credit between the door's check and its write; it
    // skips the foreign-key check, which would otherwise wait on the door's lock on the credit
    const machine = t.app.get(OrderStatusService);
    const transitionIn = machine.transitionIn.bind(machine);
    vi.spyOn(machine, 'transitionIn').mockImplementationOnce(async (...args) => {
      const other = new pg.Client({ connectionString: t.env.DATABASE_URL });
      await other.connect();
      await other.query(`set session_replication_role = replica`);
      await other.query(`update orders set credit_id = $1 where id = $2`, [
        creditId,
        first.order.id,
      ]);
      await other.end();
      return transitionIn(...args);
    });

    const out = await confirm({
      orderId: second.order.id,
      creditId,
      receiptId: null,
      actor: manager,
    });

    expect(out).toEqual({ kind: 'credit_taken', orderId: first.order.id });
    expect(await orderNow(second.order.id)).toMatchObject({
      status: 'awaiting_payment',
      creditId: null,
    });
    vi.restoreAllMocks();
  });

  it('the AI never confirms a duplicate receipt (the same file on another order); a manager may', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const file = await uniqueReceiptImage();
    const receiptId = await sendReceipt(first.order, file);
    // the later copy takes the payment-not-found path at once (#36); the first waits for a person
    await sendReceipt(second.order, file);
    const creditId = await recordCredit(t, { som: first.order.amountDue });

    expect(
      await confirm({ orderId: first.order.id, creditId, receiptId, actor: { type: 'ai' } }),
    ).toEqual({ kind: 'duplicate_receipt' });
    expect(await orderNow(first.order.id)).toMatchObject({
      status: 'receipt_review',
      creditId: null,
    });
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    expect(
      (await confirm({ orderId: first.order.id, creditId, receiptId, actor: manager })).kind,
    ).toBe('confirmed');
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

describe('«Популярное» ranks by paid orders (#15, now that orders get paid)', () => {
  /** An order of whatever `fill` puts in Ali's cart, at the quoted total. */
  async function orderOf(fill: (c: Awaited<ReturnType<typeof shopper>>) => Promise<unknown>) {
    const client = await shopper(t, ali, '998901234567');
    await fill(client);
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
    const res = await client.orders.create({
      body: orderBody(point.id, checkout.body.quote.total),
    });
    if (res.status !== 201) throw new Error(`order ${res.status}`);
    return orderNow(
      (await t.db.select().from(orders).where(eq(orders.number, res.body.number)))[0]!.id,
    );
  }
  const bottle = (slug: string) => (c: Awaited<ReturnType<typeof shopper>>) =>
    c.cart.addLine({ body: { slug, ml: 10, qty: 1 } });
  /** Paid the way production pays: a receipt, then the credit the AI links to it. */
  async function pay(order: Awaited<ReturnType<typeof orderOf>>) {
    await payWithCredit(t, order, await sendReceipt(order));
  }
  async function topSlugs() {
    const { client } = await t.signIn();
    const res = await client.catalog.list({ query: { limit: 100 } });
    if (res.status !== 200) throw new Error(`catalog ${res.status}`);
    return res.body.items.map((i) => i.slug);
  }

  it('counts each paid order once per fragrance in a bottle or a builder set; never unpaid, cancelled, returned, old, or the Discovery set', async () => {
    const discoveryIds = (
      await t.db.select().from(discoverySetItems).where(eq(discoverySetItems.setKey, 'discovery'))
    ).map((i) => i.fragranceId);
    const all = await t.db.select().from(fragrances).orderBy(asc(fragrances.slug));
    const discoveryFive = all.filter((f) => discoveryIds.includes(f.id)).map((f) => f.slug);
    const [a, b, unpaid, cancelled, returned, old, ...rest] = all
      .filter((f) => !discoveryIds.includes(f.id))
      .map((f) => f.slug);
    const picks = rest.slice(0, 5);
    // nobody pinned; the ones that must not count are the newest, so any count would lift them
    await t.db
      .update(fragrances)
      .set({ isHit: false, createdAt: new Date('2026-01-01T00:00:00Z') });
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-11-01T00:00:00Z') })
      .where(inArray(fragrances.slug, [unpaid!, cancelled!, returned!, old!, ...discoveryFive]));
    await t.db
      .update(fragrances)
      .set({ createdAt: new Date('2026-02-01T00:00:00Z') })
      .where(eq(fragrances.slug, b!));
    await t.db.update(discoverySet).set({ onHand: 5 });

    // paid 40 days ago: outside the 30-day window
    t.edges.clock.set(new Date('2026-09-30T10:00:00Z'));
    await pay(await orderOf(bottle(old!)));
    t.edges.clock.set(new Date('2026-11-09T10:00:30Z'));

    await pay(await orderOf(bottle(a!)));
    await pay(await orderOf(bottle(a!)));
    // two bottles of b in one order are still one order
    await pay(
      await orderOf(async (c) => {
        await bottle(b!)(c);
        await c.cart.addLine({ body: { slug: b!, ml: 30, qty: 1 } });
      }),
    );
    await pay(await orderOf((c) => c.cart.addBuilder({ body: { slugs: picks, qty: 1 } })));
    await pay(await orderOf((c) => c.cart.addDiscovery({ body: { qty: 1 } })));
    await orderOf(bottle(unpaid!));
    const machine = t.app.get(OrderStatusService);
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const toCancel = await orderOf(bottle(cancelled!));
    await pay(toCancel);
    const out = await machine.transition(toCancel.id, 'cancel', manager, 'payment_confirmed', {
      reason: 'out_of_stock',
    });
    expect(out.kind).toBe('done');
    const toReturn = await orderOf(bottle(returned!));
    await pay(toReturn);
    for (const [from, action, payload] of [
      ['payment_confirmed', 'accept', undefined],
      ['accepted', 'start_assembly', undefined],
      ['assembling', 'hand_to_bts', { trackingNumber: 'BTS 4471 0098' }],
      ['handed_to_bts', 'deliver', undefined],
      [
        'delivered',
        'return',
        { reason: 'Не подошёл', lines: [{ position: 0, backToStock: true }] },
      ],
    ] as const) {
      const moved = await machine.transition(toReturn.id, action, manager, from, payload as never);
      expect(moved.kind, action).toBe('done');
    }

    const order = await topSlugs();
    expect(order.slice(0, 2)).toEqual([a, b]);
    expect(new Set(order.slice(2, 7))).toEqual(new Set(picks));
    expect(new Set(order.slice(7, 16))).toEqual(
      new Set([unpaid, cancelled, returned, old, ...discoveryFive]),
    );
  });
});
