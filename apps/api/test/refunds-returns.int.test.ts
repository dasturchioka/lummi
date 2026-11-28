import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CreateOrderBody, FulfilBody, OrderStatus, PromoCodeInput } from '@lummi/contracts';
import {
  and,
  asc,
  auditLog,
  birthdayCoupons,
  btsPoints,
  eq,
  fragrances,
  inArray,
  orderEvents,
  orders,
  outbox,
  regions,
  upgradeRights,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BirthdayCouponJob } from '../src/birthday/birthday-job';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { shopper, slugs, whileLockedUntil } from './harness/orders';
import { payWithCredit, recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { giftSampleOff } from './harness/gift-sample';
import { FILL_UL } from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): Refunds and Returns (#40, ADR 0005 0006 0010) over HTTP, as owner and
 * managers record them in the admin panel. A Refund is a money record that never changes the
 * status or a discount; a Return is the status move «Доставлен» → «Возвращён» with per-line
 * back-to-stock flags.
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
  // 15:00 in Tashkent on 9 November
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  // the seed's concentrate would give each first order a 5 ml sample; not what these tests are about
  await giftSampleOff(t);
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 51, first_name: 'Ali', last_name: 'Karimov', language_code: 'ru' };

type Shopper = Awaited<ReturnType<typeof shopper>>;
type StaffClient = StaffSession['client'];

/** The checkout body for the cart as it is now, to a Samarkand point at the quoted total. */
async function checkoutBody(client: Shopper, extra: Partial<CreateOrderBody> = {}) {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await client.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point!.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
    ...extra,
  } satisfies CreateOrderBody;
}

/** Orders what is in the cart at the quoted total; returns the order number. */
async function placeOrder(client: Shopper): Promise<number> {
  const res = await client.orders.create({ body: await checkoutBody(client) });
  if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.number;
}

/** One 10 ml bottle of each slug, ordered. */
async function orderBottles(client: Shopper, picks: string[], ml: 10 | 30 | 50 = 10) {
  for (const slug of picks) {
    const add = await client.cart.addLine({ body: { slug, ml, qty: 1 } });
    if (add.status !== 200) throw new Error(`add ${add.status}`);
  }
  return placeOrder(client);
}

async function orderRow(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  return o!;
}

/**
 * The shopper sends a receipt, the money arrives and the receipt AI confirms it (#32), then a
 * manager walks the order through the admin panel's fulfilment steps (#33) up to `status`.
 */
async function fulfilTo(number: number, status: Exclude<OrderStatus, 'awaiting_payment'>) {
  const order = await orderRow(number);
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, number, await uniqueReceiptImage(), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  if (status === 'receipt_review') return;
  await payWithCredit(t, order, sent.receipt.id);
  if (status === 'payment_confirmed') return;
  const manager = await t.managerSession();
  const steps: [OrderStatus, FulfilBody][] = [
    ['accepted', { action: 'accept', expectedStatus: 'payment_confirmed' }],
    ['assembling', { action: 'start_assembly', expectedStatus: 'accepted' }],
    [
      'handed_to_bts',
      { action: 'hand_to_bts', expectedStatus: 'assembling', trackingNumber: 'BTS 4471 0098' },
    ],
    ['delivered', { action: 'deliver', expectedStatus: 'handed_to_bts' }],
  ];
  for (const [to, body] of steps) {
    const res = await manager.client.admin.orders.fulfil({ params: { number }, body });
    if (res.status !== 200) throw new Error(`${body.action}: ${res.status}`);
    if (to === status) return;
  }
  throw new Error(`no path to ${status}`);
}

/** A 10 % code with no limits, active. */
const promo = (): PromoCodeInput => ({
  code: 'BLOGER10',
  kind: 'percent',
  percent: 10,
  amount: null,
  maxDiscount: null,
  promoGift: null,
  expiresOn: null,
  minOrderTotal: null,
  totalLimit: null,
  perCustomerLimit: null,
  newCustomersOnly: false,
  appliesToMarkedDown: false,
  active: true,
});

/** A raw staff POST, for bodies the typed client would not send; answers the status. */
async function postAs(cookie: string, path: string, body: unknown): Promise<number> {
  const res = await fetch(`${t.baseUrl}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function auditOf(number: number, action: string) {
  const { id } = await orderRow(number);
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, String(id)), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.id));
}

describe('a Refund: money sent back, recorded (ADR 0006)', () => {
  it('records amount, date, reason and the staff member on a paid order; the status stays', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 2));
    await fulfilTo(number, 'delivered');
    const { amountDue } = await orderRow(number);
    const messagesBefore = (await t.db.select().from(outbox)).length;

    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.refund({
      params: { number },
      body: {
        amount: 50_000,
        date: '2026-11-09',
        reason: 'Один флакон протёк',
        expectedRefunded: 0,
      },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.order.status).toBe('delivered');
    expect(res.body.payment).toBe('paid');
    // what was paid is the Credit that paid it: here the amount due, to the so'm
    expect(res.body.money).toEqual({
      paid: amountDue,
      paidOn: '2026-11-09',
      refunded: 50_000,
      refundable: amountDue - 50_000,
      // a delivered order owes nothing back: this refund was the manager's call
      owed: 0,
    });
    expect(res.body.refunds).toEqual([
      {
        id: expect.any(Number),
        amount: 50_000,
        date: '2026-11-09',
        reason: 'Один флакон протёк',
        by: { id: manager.staff.id, name: 'Manager' },
        at: '2026-11-09T10:00:00.000Z',
      },
    ]);
    // the page reads the same afterwards
    const again = await manager.client.admin.orders.get({ params: { number } });
    expect(again.status === 200 && again.body.refunds).toEqual(res.body.refunds);

    // audited with the staff member; nothing else moved: no history row, no shopper message
    expect(await auditOf(number, 'order.refunded')).toMatchObject([
      {
        actorType: 'staff',
        actorId: manager.staff.id,
        targetType: 'order',
        payload: {
          number,
          amount: 50_000,
          date: '2026-11-09',
          reason: 'Один флакон протёк',
          paid: amountDue,
          refundedBefore: 0,
        },
      },
    ]);
    expect((await orderRow(number)).status).toBe('delivered');
    expect(again.status === 200 && again.body.events.map((e) => e.action).at(-1)).toBe('deliver');
    expect((await t.db.select().from(outbox)).length).toBe(messagesBefore);
  });
});

describe('the refund cap: at most what was paid minus earlier refunds', () => {
  it('partial refunds add up to exactly what was paid; past it, 422 with what is left', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 2));
    await fulfilTo(number, 'payment_confirmed');
    const { amountDue } = await orderRow(number);
    const { client: staff } = await t.managerSession();
    const refund = (amount: number, expectedRefunded: number) =>
      staff.admin.orders.refund({
        params: { number },
        body: { amount, date: '2026-11-09', reason: 'Возврат', expectedRefunded },
      });

    expect((await refund(40_000, 0)).status).toBe(200);
    // one so'm more than what is left
    const over = await refund(amountDue - 40_000 + 1, 40_000);
    expect(over).toMatchObject({
      status: 422,
      body: { code: 'refund_too_large', max: amountDue - 40_000 },
    });
    const rest = await refund(amountDue - 40_000, 40_000);
    expect(rest.status === 200 && rest.body.money).toMatchObject({
      refunded: amountDue,
      refundable: 0,
    });
    // all of it went back: even 1 so'm more is refused
    expect(await refund(1, amountDue)).toMatchObject({
      status: 422,
      body: { code: 'refund_too_large', max: 0 },
    });
    const page = await staff.admin.orders.get({ params: { number } });
    expect(page.status === 200 && page.body.refunds.map((r) => r.amount)).toEqual([
      40_000,
      amountDue - 40_000,
    ]);
    // a refund leaves the status as it was
    expect((await orderRow(number)).status).toBe('payment_confirmed');
  });

  it('what was paid is the Credit: one staff linked for more than the amount due may go back whole', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 1));
    const order = await orderRow(number);
    // the shopper sent 20 000 too much (and 50 tiyin): a manager links it with a reason (#32)
    const creditId = await recordCredit(t, { som: order.amountDue + 20_000, tiyin: 50 });
    const { client: staff } = await t.managerSession();
    const confirmed = await staff.admin.orders.confirmPayment({
      params: { number },
      body: { creditId, receiptId: null, reason: 'Перевёл больше, вернём разницу' },
    });
    expect(confirmed.status).toBe(200);

    const refund = (amount: number, expectedRefunded: number) =>
      staff.admin.orders.refund({
        params: { number },
        body: { amount, date: '2026-11-09', reason: 'Переплата', expectedRefunded },
      });
    // whole so'm of what came in: the 50 tiyin never go back as a so'm
    expect((await refund(20_000, 0)).status).toBe(200);
    expect(await refund(order.amountDue + 1, 20_000)).toMatchObject({
      status: 422,
      body: { code: 'refund_too_large', max: order.amountDue },
    });
  });

  it('a refund recorded since the manager looked is a conflict: nothing is written, the page as it is now', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 2));
    await fulfilTo(number, 'delivered');
    const first = await t.managerSession();
    const second = await t.signInStaff('manager', { id: 900003, first_name: 'Dilnoza' });
    const body = {
      amount: 30_000,
      date: '2026-11-09',
      reason: 'Протёк флакон',
      expectedRefunded: 0,
    };
    expect((await first.client.admin.orders.refund({ params: { number }, body })).status).toBe(200);
    // the same transfer, from a screen that still read «0 возвращено»
    const again = await second.client.admin.orders.refund({ params: { number }, body });
    expect(again).toMatchObject({ status: 409, body: { code: 'refunds_changed' } });
    expect(again.status === 409 && 'order' in again.body && again.body.order.refunds).toHaveLength(
      1,
    );
    expect(await auditOf(number, 'order.refunded')).toHaveLength(1);
  });

  it('two managers refunding at the same moment: the order’s lock lets one through, never past the cap', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 2));
    await fulfilTo(number, 'delivered');
    const { amountDue } = await orderRow(number);
    const first = await t.managerSession();
    const second = await t.signInStaff('manager', { id: 900003, first_name: 'Dilnoza' });
    // each alone would fit; both together would pass what was paid
    const amount = Math.ceil(amountDue * 0.6);
    const body = { amount, date: '2026-11-09', reason: 'Возврат', expectedRefunded: 0 };
    const results = await whileLockedUntil(t, 'orders', 2, () =>
      Promise.all([
        first.client.admin.orders.refund({ params: { number }, body }),
        second.client.admin.orders.refund({ params: { number }, body }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const page = await first.client.admin.orders.get({ params: { number } });
    expect(page.status === 200 && page.body.money).toMatchObject({
      refunded: amount,
      refundable: amountDue - amount,
    });
  });
});

describe('which orders take a refund, and what it needs', () => {
  it('any paid order, a cancelled one included; never one that was not paid', async () => {
    const client = await shopper(t, ali, '998901112233');
    const [a, b, c] = await slugs(t, 3);
    const unpaid = await orderBottles(client, [a!]);
    const checking = await orderBottles(client, [b!]);
    await fulfilTo(checking, 'receipt_review');
    const cancelledPaid = await orderBottles(client, [c!]);
    await fulfilTo(cancelledPaid, 'accepted');
    const owner = await t.ownerSession();
    const cancel = await owner.client.admin.orders.cancel({
      params: { number: cancelledPaid },
      body: { expectedStatus: 'accepted', reason: 'out_of_stock' },
    });
    expect(cancel.status).toBe(200);

    const refund = (number: number) =>
      owner.client.admin.orders.refund({
        params: { number },
        body: { amount: 10_000, date: '2026-11-09', reason: 'Возврат', expectedRefunded: 0 },
      });
    for (const number of [unpaid, checking])
      expect(await refund(number), String(number)).toMatchObject({
        status: 422,
        body: { code: 'not_paid' },
      });
    // a paid order cancelled owes its money back until refunds cover it; the status stays
    const { amountDue } = await orderRow(cancelledPaid);
    const owing = await owner.client.admin.orders.get({ params: { number: cancelledPaid } });
    expect(owing.status === 200 && owing.body.money.owed).toBe(amountDue);
    const done = await refund(cancelledPaid);
    expect(
      done.status === 200 && [done.body.order.status, done.body.payment, done.body.money.owed],
    ).toEqual(['cancelled', 'paid', amountDue - 10_000]);
    const unpaidPage = await owner.client.admin.orders.get({ params: { number: unpaid } });
    expect(unpaidPage.status === 200 && unpaidPage.body.money).toEqual({
      paid: null,
      paidOn: null,
      refunded: 0,
      refundable: 0,
      owed: 0,
    });
    expect(await refund(999_999)).toMatchObject({ status: 404 });
  });

  it('the date is a Tashkent day from the day the money arrived to today', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 1));
    // paid on 9 November; it is now 00:30 on 12 November in Tashkent (still the 11th in UTC)
    await fulfilTo(number, 'delivered');
    t.edges.clock.set(new Date('2026-11-11T19:30:00Z'));
    const { client: staff } = await t.managerSession();
    const on = (date: string) =>
      staff.admin.orders.refund({
        params: { number },
        body: { amount: 10_000, date, reason: 'Возврат', expectedRefunded: 0 },
      });
    for (const date of ['2026-11-08', '2026-11-13'])
      expect(await on(date), date).toMatchObject({ status: 422, body: { code: 'invalid_date' } });
    const { cookie } = await t.managerSession();
    expect(
      await postAs(cookie, `/admin/orders/${number}/refund`, {
        amount: 10_000,
        date: '2026-02-30',
        reason: 'Возврат',
        expectedRefunded: 0,
      }),
    ).toBe(400);
    const done = await on('2026-11-12');
    expect(done.status === 200 && done.body.refunds.map((r) => r.date)).toEqual(['2026-11-12']);
  });

  it('needs an amount and a reason; a shopper’s session is refused', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 1));
    await fulfilTo(number, 'delivered');
    const { cookie } = await t.managerSession();
    for (const body of [
      { amount: 10_000, date: '2026-11-09', reason: '   ', expectedRefunded: 0 },
      { amount: 10_000, date: '2026-11-09', expectedRefunded: 0 },
      { amount: 0, date: '2026-11-09', reason: 'Возврат', expectedRefunded: 0 },
      { amount: 99.5, date: '2026-11-09', reason: 'Возврат', expectedRefunded: 0 },
      { amount: 10_000, date: '2026-11-09', reason: 'x'.repeat(501), expectedRefunded: 0 },
      { amount: 10_000, reason: 'Возврат', expectedRefunded: 0 },
      { amount: 10_000, date: '2026-11-09', reason: 'Возврат' },
    ])
      expect(
        await postAs(cookie, `/admin/orders/${number}/refund`, body),
        JSON.stringify(body).slice(0, 60),
      ).toBe(400);
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/orders/${number}/refund`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: 10_000,
        date: '2026-11-09',
        reason: 'Я сам',
        expectedRefunded: 0,
      }),
    });
    expect(res.status).toBe(401);
    expect(await auditOf(number, 'order.refunded')).toEqual([]);
  });
});

describe('a refund changes no discount and shows on the orders list', () => {
  it('the promo use still counts, the snapshot keeps its discount; the list reads «Возврат N сум»', async () => {
    const owner = await t.ownerSession();
    const created = await owner.client.admin.promoCodes.create({ body: promo() });
    expect(created.status).toBe(201);
    const client = await shopper(t, ali, '998901112233');
    const [a, b] = await slugs(t, 2);
    await client.cart.addLine({ body: { slug: a!, ml: 30, qty: 1 } });
    expect((await client.cart.applyPromoCode({ body: { code: 'BLOGER10' } })).status).toBe(200);
    const discounted = await placeOrder(client);
    const plain = await orderBottles(client, [b!]);
    await fulfilTo(discounted, 'delivered');
    await fulfilTo(plain, 'delivered');
    const before = (await orderRow(discounted)).discount;
    expect(before).toMatchObject({ type: 'promo_code', code: 'BLOGER10' });

    const res = await owner.client.admin.orders.refund({
      params: { number: discounted },
      body: { amount: 25_000, date: '2026-11-09', reason: 'Не тот аромат', expectedRefunded: 0 },
    });
    expect(res.status).toBe(200);
    expect((await orderRow(discounted)).discount).toEqual(before);
    const codes = await owner.client.admin.promoCodes.list();
    expect(codes.status === 200 && codes.body.find((c) => c.code === 'BLOGER10')).toMatchObject({
      uses: 1,
    });

    const list = await owner.client.admin.orders.list({ query: {} });
    expect(
      list.status === 200 &&
        list.body.items.map((i) => [i.number, i.status, i.payment, i.refunded]),
    ).toEqual([
      [plain, 'delivered', 'paid', 0],
      [discounted, 'delivered', 'paid', 25_000],
    ]);
  });
});

/**
 * Each fragrance's ready concentrate in µl (ADR 0043) and the 5 × 10 ml Discovery set's boxes, as
 * the stock page (#27) shows them to staff.
 */
async function onHand(client: StaffClient) {
  const concentrate = new Map<number, number>();
  let discovery = -1;
  for (let page = 1; ; page++) {
    const res = await client.admin.stock.list({ query: { page, pageSize: 50 } });
    if (res.status !== 200) throw new Error(`stock ${res.status}`);
    for (const row of res.body.fragrances)
      concentrate.set(row.fragranceId, Math.round(row.concentrateMl * 1000));
    // the 5 × 10 ml set's row (the 5 × 5 ml set has its own, `discovery-5`, ADR 0042)
    for (const row of res.body.sets) if (row.key === 'discovery') discovery = row.onHand;
    if (page * res.body.pageSize >= res.body.total) break;
  }
  return { concentrate, discovery };
}

/** The fragrance ids, by slug. */
async function fragranceIds(picks: string[]) {
  const rows = await t.db
    .select({ id: fragrances.id, slug: fragrances.slug })
    .from(fragrances)
    .where(inArray(fragrances.slug, picks));
  return picks.map((s) => rows.find((r) => r.slug === s)!.id);
}

describe('a Return: «Доставлен» → «Возвращён» in the admin panel (ADR 0006, 0010)', () => {
  /**
   * An order of every line kind: two 30 ml bottles, a Discovery set and a builder set of five,
   * delivered. Answers its number and the fragrances each line's bottles were filled from.
   */
  async function deliveredMix() {
    const client = await shopper(t, ali, '998901112233');
    const all = await slugs(t, 8);
    const bottle = all[0]!;
    const picked = all.slice(1, 6);
    await client.cart.addLine({ body: { slug: bottle, ml: 30, qty: 2 } });
    await client.cart.addDiscovery({ body: { qty: 1 } });
    expect((await client.cart.addBuilder({ body: { slugs: picked, qty: 1 } })).status).toBe(200);
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');
    return {
      number,
      bottleFragrance: (await fragranceIds([bottle]))[0]!,
      builderFragrances: await fragranceIds(picked),
    };
  }

  /** The order page's lines as the return dialog flags them: position and kind. */
  async function linesOfPage(client: StaffClient, number: number) {
    const page = await client.admin.orders.get({ params: { number } });
    if (page.status !== 200) throw new Error(`page ${page.status}`);
    if (!page.body.returnPreview) throw new Error('no return preview');
    return page.body.returnPreview.lines.map((l, i) => ({
      position: l.position,
      kind: page.body.order.lines[i]!.kind,
    }));
  }

  it('the flagged lines go back on hand, per line kind; the unflagged stay off the shelf', async () => {
    const { number, bottleFragrance, builderFragrances } = await deliveredMix();
    const manager = await t.managerSession();
    const before = await onHand(manager.client);
    const lines = await linesOfPage(manager.client, number);
    expect(lines.map((l) => l.kind).sort()).toEqual(['builder_set', 'discovery_set', 'volume']);

    // the bottles and the Discovery box come back whole; the builder set leaked
    const res = await manager.client.admin.orders.return({
      params: { number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Покупатель вернул посылку: набор протёк',
        lines: lines.map((l) => ({ position: l.position, backToStock: l.kind !== 'builder_set' })),
      },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.order.status).toBe('returned');
    expect(res.body.returned).toEqual({
      reason: 'Покупатель вернул посылку: набор протёк',
      at: '2026-11-09T10:00:00.000Z',
      by: { id: manager.staff.id, name: 'Manager' },
      lines: lines.map((l) => ({ position: l.position, backToStock: l.kind !== 'builder_set' })),
    });
    // a returned order is no longer something to return, and its money is owed back
    expect(res.body.returnPreview).toBeNull();
    expect(res.body.money.owed).toBe((await orderRow(number)).amountDue);

    const after = await onHand(manager.client);
    // two 30 ml fills back into the bottle's concentrate (ADR 0043)
    expect(after.concentrate.get(bottleFragrance)).toBe(
      before.concentrate.get(bottleFragrance)! + 2 * FILL_UL[30],
    );
    expect(after.discovery).toBe(before.discovery + 1);
    for (const id of builderFragrances)
      expect(after.concentrate.get(id)).toBe(before.concentrate.get(id));
    // audited with the manager, with the on-hand changes
    expect(await auditOf(number, 'order.returned')).toMatchObject([
      { actorType: 'staff', actorId: manager.staff.id },
    ]);
  });

  it('the page lists the flags in the order of the lines, whatever order they were sent in', async () => {
    const { number } = await deliveredMix();
    const { client } = await t.managerSession();
    const lines = await linesOfPage(client, number);
    const flags = lines.map((l) => ({ position: l.position, backToStock: l.kind === 'volume' }));
    const res = await client.admin.orders.return({
      params: { number },
      body: { expectedStatus: 'delivered', reason: 'Вернули', lines: [...flags].reverse() },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.returned?.lines).toEqual(flags);
  });

  it('a builder set flagged back puts one 10 ml of each of its five back; the rest stays', async () => {
    const { number, bottleFragrance, builderFragrances } = await deliveredMix();
    const { client } = await t.managerSession();
    const before = await onHand(client);
    const lines = await linesOfPage(client, number);
    const res = await client.admin.orders.return({
      params: { number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Вернули только набор целым',
        lines: lines.map((l) => ({ position: l.position, backToStock: l.kind === 'builder_set' })),
      },
    });
    expect(res.status).toBe(200);
    const after = await onHand(client);
    for (const id of builderFragrances)
      expect(after.concentrate.get(id)).toBe(before.concentrate.get(id)! + FILL_UL[10]);
    expect(after.concentrate.get(bottleFragrance)).toBe(before.concentrate.get(bottleFragrance));
    expect(after.discovery).toBe(before.discovery);
  });
});

describe('a Return is only from «Доставлен», in the admin panel, with a reason', () => {
  it('a returned order whose history row lost its flags still opens, without the Return block', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 1));
    await fulfilTo(number, 'delivered');
    const { client: staff } = await t.managerSession();
    const lines = [{ position: 0, backToStock: true }];
    expect(
      (
        await staff.admin.orders.return({
          params: { number },
          body: { expectedStatus: 'delivered', reason: 'Вернули', lines },
        })
      ).status,
    ).toBe(200);
    // a row written by hand, or in an older shape
    await t.db
      .update(orderEvents)
      .set({ payload: { lines: [{ position: '0' }] } })
      .where(
        and(eq(orderEvents.orderId, (await orderRow(number)).id), eq(orderEvents.action, 'return')),
      );
    const page = await staff.admin.orders.get({ params: { number } });
    expect(page.status === 200 && [page.body.order.status, page.body.returned]).toEqual([
      'returned',
      null,
    ]);
  });

  it('refused from any other status, and from a stale screen as a conflict; it happens once', async () => {
    const client = await shopper(t, ali, '998901112233');
    const [a, b] = await slugs(t, 2);
    const shipped = await orderBottles(client, [a!]);
    await fulfilTo(shipped, 'handed_to_bts');
    const delivered = await orderBottles(client, [b!]);
    await fulfilTo(delivered, 'delivered');
    const { client: staff } = await t.managerSession();
    const lines = [{ position: 0, backToStock: true }];

    // «Передан в BTS» has no return: a parcel not collected is a cancel (ADR 0006)
    expect(
      await staff.admin.orders.return({
        params: { number: shipped },
        body: { expectedStatus: 'handed_to_bts', reason: 'Не забрал', lines },
      }),
    ).toMatchObject({ status: 422, body: { code: 'not_allowed' } });
    // flags that do not name every line exactly once
    for (const flags of [
      [{ position: 1, backToStock: true }],
      [
        { position: 0, backToStock: true },
        { position: 0, backToStock: false },
      ],
    ])
      expect(
        await staff.admin.orders.return({
          params: { number: delivered },
          body: { expectedStatus: 'delivered', reason: 'Вернули', lines: flags },
        }),
      ).toMatchObject({ status: 422, body: { code: 'invalid_payload' } });
    // a colleague returns it first; the second screen still read «Доставлен»: nothing moves twice
    const first = await t.signInStaff('manager', { id: 900003, first_name: 'Dilnoza' });
    expect(
      (
        await first.client.admin.orders.return({
          params: { number: delivered },
          body: { expectedStatus: 'delivered', reason: 'Вернули', lines },
        })
      ).status,
    ).toBe(200);
    const stale = await staff.admin.orders.return({
      params: { number: delivered },
      body: { expectedStatus: 'delivered', reason: 'Вернули', lines },
    });
    expect(stale).toMatchObject({ status: 409, body: { code: 'status_changed' } });
    expect(stale.status === 409 && 'order' in stale.body && stale.body.order.order.status).toBe(
      'returned',
    );
    // «Возвращён» is final
    expect(
      await staff.admin.orders.return({
        params: { number: delivered },
        body: { expectedStatus: 'returned', reason: 'Ещё раз', lines },
      }),
    ).toMatchObject({ status: 422, body: { code: 'not_allowed' } });
    expect([(await orderRow(shipped)).status, (await orderRow(delivered)).status]).toEqual([
      'handed_to_bts',
      'returned',
    ]);
    expect(await auditOf(delivered, 'order.returned')).toHaveLength(1);
  });

  it('needs a reason and a flag for each line; a shopper’s session is refused', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await orderBottles(client, await slugs(t, 1));
    await fulfilTo(number, 'delivered');
    const { cookie } = await t.managerSession();
    const lines = [{ position: 0, backToStock: true }];
    for (const body of [
      { expectedStatus: 'delivered', lines },
      { expectedStatus: 'delivered', reason: '  ', lines },
      { expectedStatus: 'delivered', reason: 'x'.repeat(501), lines },
      { expectedStatus: 'delivered', reason: 'Вернули' },
      { expectedStatus: 'delivered', reason: 'Вернули', lines: [] },
      { expectedStatus: 'delivered', reason: 'Вернули', lines: [{ position: 0 }] },
      { reason: 'Вернули', lines },
    ])
      expect(
        await postAs(cookie, `/admin/orders/${number}/return`, body),
        JSON.stringify(body).slice(0, 80),
      ).toBe(400);
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/orders/${number}/return`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedStatus: 'delivered', reason: 'Сам вернул', lines }),
    });
    expect(res.status).toBe(401);
    expect((await orderRow(number)).status).toBe('delivered');
  });
});

describe('a Return releases the order’s discount source and closes the rights it opened (ADR 0005)', () => {
  /** The Discovery set's five fragrances, as its page names them. */
  async function discoverySlugs(client: Shopper) {
    const box = await client.sets.discovery();
    if (box.status !== 200) throw new Error(`discovery ${box.status}`);
    return box.body.fragrances.map((f) => f.slug!);
  }

  /**
   * A delivered Discovery set (9 November: its rights run through 9 December) and an order that
   * spent one of its rights on a 50 ml bottle, taken to `status`.
   */
  async function rightSpentOn(status: Exclude<OrderStatus, 'awaiting_payment'>, sets = 1) {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: sets } });
    const source = await placeOrder(client);
    await fulfilTo(source, 'delivered');
    await client.cart.addLine({ body: { slug: inBox[0]!, ml: 50, qty: 1 } });
    const used = await placeOrder(client);
    expect((await orderRow(used)).discount).toMatchObject({ type: 'upgrade_right' });
    await fulfilTo(used, status);
    return { client, source, used };
  }

  const returnWhole = (client: StaffClient, number: number) =>
    client.admin.orders.return({
      params: { number },
      body: {
        expectedStatus: 'delivered',
        reason: 'Не подошёл аромат',
        lines: [{ position: 0, backToStock: true }],
      },
    });

  async function preview(client: StaffClient, number: number) {
    const page = await client.admin.orders.get({ params: { number } });
    if (page.status !== 200) throw new Error(`page ${page.status}`);
    return page.body.returnPreview;
  }

  it('within its term the right comes back to the customer, and the dialog says so first', async () => {
    const { client, used } = await rightSpentOn('delivered');
    const { client: staff } = await t.managerSession();
    expect((await preview(staff, used))?.discount).toEqual({
      type: 'upgrade_right',
      lost: null,
      lastDay: '2026-12-09',
    });
    const listed = async () => {
      const res = await client.me.discounts();
      if (res.status !== 200) throw new Error(`discounts ${res.status}`);
      return res.body.upgradeRights.length;
    };
    expect(await listed()).toBe(0);
    expect((await returnWhole(staff, used)).status).toBe(200);
    expect(await listed()).toBe(1);
  });

  it('past its term the right is lost: it stays with the returned order', async () => {
    const { used } = await rightSpentOn('delivered');
    // 00:00 on 10 December in Tashkent: the right's last day is over
    t.edges.clock.set(new Date('2026-12-09T19:00:00Z'));
    const { client: staff } = await t.managerSession();
    expect((await preview(staff, used))?.discount).toEqual({
      type: 'upgrade_right',
      lost: 'expired',
      lastDay: '2026-12-09',
    });
    expect((await returnWhole(staff, used)).status).toBe(200);
    const [right] = await t.db
      .select()
      .from(upgradeRights)
      .where(eq(upgradeRights.usedByOrderId, (await orderRow(used)).id));
    expect(right).toBeDefined();
  });

  it('a right its set order’s return closed is lost too: the dialog says closed, not ended', async () => {
    const { client, source, used } = await rightSpentOn('delivered');
    const { client: staff } = await t.managerSession();
    expect((await returnWhole(staff, source)).status).toBe(200);
    // well within its term, but closed: the order that spent it gets nothing back
    expect((await preview(staff, used))?.discount).toEqual({
      type: 'upgrade_right',
      lost: 'closed',
      lastDay: '2026-12-09',
    });
    expect((await returnWhole(staff, used)).status).toBe(200);
    const [right] = await t.db
      .select()
      .from(upgradeRights)
      .where(eq(upgradeRights.usedByOrderId, (await orderRow(used)).id));
    expect(right?.closedAt).not.toBeNull();
    const mine = await client.me.discounts();
    expect(mine.status === 200 && mine.body.upgradeRights).toEqual([]);
  });

  it('a promo-code use is voided: the code counts it no more', async () => {
    const owner = await t.ownerSession();
    expect(
      (await owner.client.admin.promoCodes.create({ body: { ...promo(), totalLimit: 1 } })).status,
    ).toBe(201);
    const client = await shopper(t, ali, '998901112233');
    const [a] = await slugs(t, 1);
    await client.cart.addLine({ body: { slug: a!, ml: 30, qty: 1 } });
    await client.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');
    const code = async () => {
      const res = await owner.client.admin.promoCodes.list();
      if (res.status !== 200) throw new Error(`promo ${res.status}`);
      return res.body.find((c) => c.code === 'BLOGER10');
    };
    expect(await code()).toMatchObject({ uses: 1, state: 'exhausted' });
    expect((await preview(owner.client, number))?.discount).toEqual({
      type: 'promo_code',
      code: 'BLOGER10',
    });
    expect((await returnWhole(owner.client, number)).status).toBe(200);
    expect(await code()).toMatchObject({ uses: 0, state: 'active' });
  });

  /**
   * Ali, born 1 December, entered on 9 November: his coupon comes at 10:00 on 28 November and runs
   * through 8 December (the settings' 3 days before, 7 after). He orders a 50 ml bottle with it
   * that day, and it is delivered.
   */
  async function couponOrder() {
    const client = await shopper(t, ali, '998901112233');
    expect(
      (await client.me.setBirthDate({ body: { birthDate: '1990-12-01', consent: true } })).status,
    ).toBe(200);
    t.edges.clock.set(new Date('2026-11-28T05:00:00Z'));
    await t.app.get(BirthdayCouponJob).run();
    t.edges.clock.set(new Date('2026-11-28T06:00:00Z'));
    const { client: later } = await t.signIn(ali);
    const [a] = await slugs(t, 1);
    await later.cart.addLine({ body: { slug: a!, ml: 50, qty: 1 } });
    const number = await placeOrder(later);
    expect((await orderRow(number)).discount).toMatchObject({ type: 'birthday_coupon' });
    await fulfilTo(number, 'delivered');
    const coupons = async () => {
      const res = await (await t.signIn(ali)).client.me.discounts();
      if (res.status !== 200) throw new Error(`discounts ${res.status}`);
      return res.body.birthdayCoupons.length;
    };
    return { number, coupons };
  }

  it('a birthday coupon comes back within its term', async () => {
    const { number, coupons } = await couponOrder();
    const { client: staff } = await t.managerSession();
    expect((await preview(staff, number))?.discount).toEqual({
      type: 'birthday_coupon',
      lost: null,
      lastDay: '2026-12-08',
    });
    expect(await coupons()).toBe(0);
    expect((await returnWhole(staff, number)).status).toBe(200);
    expect(await coupons()).toBe(1);
  });

  it('a birthday coupon past its term is lost: it stays with the returned order', async () => {
    const { number, coupons } = await couponOrder();
    // 00:00 on 9 December in Tashkent: the coupon's last day is over
    t.edges.clock.set(new Date('2026-12-08T19:00:00Z'));
    const { client: staff } = await t.managerSession();
    expect((await preview(staff, number))?.discount).toEqual({
      type: 'birthday_coupon',
      lost: 'expired',
      lastDay: '2026-12-08',
    });
    expect((await returnWhole(staff, number)).status).toBe(200);
    const [coupon] = await t.db.select().from(birthdayCoupons);
    expect(coupon?.usedByOrderId).toBe((await orderRow(number)).id);
    expect(await coupons()).toBe(0);
  });

  it('a returned set order closes its rights; the order that spent one keeps its discount', async () => {
    const { client, source, used } = await rightSpentOn('payment_confirmed', 2);
    const { client: staff } = await t.managerSession();
    const usedBefore = await orderRow(used);
    // the dialog names both rights first: one spent on the other order, one still open
    expect((await preview(staff, source))?.rights).toEqual([
      { percent: 20, lastDay: '2026-12-09', usedBy: { number: used }, ended: false },
      { percent: 20, lastDay: '2026-12-09', usedBy: null, ended: false },
    ]);
    expect((await preview(staff, source))?.discount).toBeNull();

    const res = await staff.admin.orders.return({
      params: { number: source },
      body: {
        expectedStatus: 'delivered',
        reason: 'Вернули оба набора',
        lines: [{ position: 0, backToStock: true }],
      },
    });
    expect(res.status).toBe(200);
    // no open right is left to the customer
    const mine = await client.me.discounts();
    expect(mine.status === 200 && mine.body.upgradeRights).toEqual([]);
    // the paid order that used one is untouched: its discount, total and status (no clawback)
    const usedAfter = await orderRow(used);
    expect([usedAfter.discount, usedAfter.total, usedAfter.status]).toEqual([
      usedBefore.discount,
      usedBefore.total,
      'payment_confirmed',
    ]);
    const page = await staff.admin.orders.get({ params: { number: used } });
    expect(page.status === 200 && page.body.order.discount).toEqual(usedBefore.discount);
  });

  it('a returned 10 ml order (switched on) closes the rights it opened; the order that spent one keeps its discount', async () => {
    const owner = await t.ownerSession();
    for (const [key, value] of [
      ['upgradeRights.single10ml.enabled', true],
      ['upgradeRights.single10ml.percent', 10],
    ] as const)
      expect(
        (await owner.client.admin.settings.update({ params: { key }, body: { value } })).status,
      ).toBe(200);
    const client = await shopper(t, ali, '998901112233');
    const [a, b] = await slugs(t, 2);
    // delivered 9 November: a right on each fragrance, through 9 December (30 days, the default)
    const source = await orderBottles(client, [a!, b!]);
    await fulfilTo(source, 'delivered');
    await client.cart.addLine({ body: { slug: a!, ml: 30, qty: 1 } });
    const used = await placeOrder(client);
    expect((await orderRow(used)).discount).toMatchObject({ type: 'upgrade_right' });
    await fulfilTo(used, 'payment_confirmed');
    const usedBefore = await orderRow(used);
    const { client: staff } = await t.managerSession();
    expect((await preview(staff, source))?.rights).toEqual([
      { percent: 10, lastDay: '2026-12-09', usedBy: { number: used }, ended: false },
      { percent: 10, lastDay: '2026-12-09', usedBy: null, ended: false },
    ]);

    const res = await staff.admin.orders.return({
      params: { number: source },
      body: {
        expectedStatus: 'delivered',
        reason: 'Вернули оба флакона',
        lines: [
          { position: 0, backToStock: false },
          { position: 1, backToStock: false },
        ],
      },
    });
    expect(res.status).toBe(200);
    // both closed: the open one is gone from the customer, the spent one stays with its order
    const opened = await t.db
      .select()
      .from(upgradeRights)
      .where(eq(upgradeRights.sourceOrderId, (await orderRow(source)).id));
    expect(opened.map((r) => r.closedAt !== null)).toEqual([true, true]);
    const mine = await client.me.discounts();
    expect(mine.status === 200 && mine.body.upgradeRights).toEqual([]);
    const usedAfter = await orderRow(used);
    expect([usedAfter.discount, usedAfter.total, usedAfter.status]).toEqual([
      usedBefore.discount,
      usedBefore.total,
      'payment_confirmed',
    ]);
  });

  it('a returned order no longer counts in the customer’s total spent (Fulfilled orders only)', async () => {
    const client = await shopper(t, ali, '998901112233');
    const [a, b] = await slugs(t, 2);
    const kept = await orderBottles(client, [a!]);
    const back = await orderBottles(client, [b!]);
    await fulfilTo(kept, 'delivered');
    await fulfilTo(back, 'delivered');
    const { customerId } = await orderRow(kept);
    const { client: staff } = await t.managerSession();
    const spent = async () => {
      const res = await staff.admin.customers.get({ params: { id: customerId } });
      if (res.status !== 200) throw new Error(`customer ${res.status}`);
      return res.body.totalSpent;
    };
    const [keptTotal, backTotal] = [(await orderRow(kept)).total, (await orderRow(back)).total];
    expect(await spent()).toBe(keptTotal + backTotal);
    // a refund changes no status: still fulfilled, still counted (reports subtract refunds, #42)
    await staff.admin.orders.refund({
      params: { number: kept },
      body: {
        amount: 10_000,
        date: '2026-11-09',
        reason: 'Скидка за ожидание',
        expectedRefunded: 0,
      },
    });
    expect(await spent()).toBe(keptTotal + backTotal);
    expect((await returnWhole(staff, back)).status).toBe(200);
    expect(await spent()).toBe(keptTotal);
  });
});
