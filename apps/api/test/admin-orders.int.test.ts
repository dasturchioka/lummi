import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  internalContract,
  type AdminCreditsQuery,
  type AdminOrdersQuery,
  type CreateOrderBody,
  type OrderStatus,
} from '@lummi/contracts';
import {
  and,
  asc,
  auditLog,
  btsPoints,
  eq,
  fragrances,
  orderEvents,
  orders,
  outbox,
  receipts,
  regions,
  staff,
} from '@lummi/db';
import { initClient } from '@ts-rest/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { PaymentMatching } from '../src/payment/payment-matching';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { shopper, whileLockedUntil } from './harness/orders';
import { payWithCredit, recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { giftSampleOff } from './harness/gift-sample';
import {
  createTestApp,
  MANAGER_WIDGET_USER,
  TEST_INTERNAL_SECRET,
  type StaffSession,
  type TestApp,
} from './harness/test-app';

/** Seam 1 (ADR 0028): the admin orders panel (#33) over HTTP, as owner and managers use it. */

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.seedCatalog();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  // the seed's concentrate would give each first order a 5 ml sample; not what these tests are about
  await giftSampleOff(t);
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', last_name: 'Karimov', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const HOUR = 3600_000;

/** A second manager, so two people can act on one order. */
const SECOND_MANAGER = { id: 900003, first_name: 'Dilnoza' };

type Shopper = Awaited<ReturnType<typeof shopper>>;

async function firstSlugs(n: number) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

/** The checkout body for the cart as it is now, to a Samarkand point at the quoted total. */
async function orderBody(client: Shopper, extra: Partial<CreateOrderBody> = {}) {
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

/** Places an order for the slugs' 10 ml (one each) at the quoted total; returns its number. */
async function placeOrder(
  client: Shopper,
  slugs: string[],
  extra: Partial<CreateOrderBody> = {},
): Promise<number> {
  for (const slug of slugs) {
    const add = await client.cart.addLine({ body: { slug, ml: 10, qty: 1 } });
    if (add.status !== 200) throw new Error(`add ${add.status}`);
  }
  const res = await client.orders.create({ body: await orderBody(client, extra) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

async function orderRow(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  return o!;
}

const machine = () => t.app.get(OrderStatusService);

/** The shopper sends a receipt through the intake (#28): the order goes «Чек на проверке». */
async function sendReceipt(number: number, image?: Buffer) {
  const { customerId } = await orderRow(number);
  const sent = await t.app
    .get(ReceiptsService)
    .submit(customerId, number, image ?? (await uniqueReceiptImage()), {
      fileName: 'chek.png',
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit_receipt: ${sent.kind}`);
  return sent.receipt.id;
}

/** The AI could not confirm the receipt: it waits for a person (#32 writes this verdict). */
async function holdForManualReview(receiptId: number) {
  await t.db.update(receipts).set({ verdict: 'manual_review' }).where(eq(receipts.id, receiptId));
}

/**
 * The money arrives and the receipt AI confirms the receipt with it through #32's
 * `PaymentConfirmation`, then each fulfilment step a manager makes, up to `status`.
 */
async function walkTo(number: number, status: Exclude<OrderStatus, 'awaiting_payment'>) {
  const receiptId = await sendReceipt(number);
  if (status === 'receipt_review') return;
  const order = await orderRow(number);
  await payWithCredit(t, order, receiptId);
  if (status === 'payment_confirmed') return;
  const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
  const path = [
    ['accepted', 'accept', undefined],
    ['assembling', 'start_assembly', undefined],
    ['handed_to_bts', 'hand_to_bts', { trackingNumber: 'BTS 4471 0098' }],
    ['delivered', 'deliver', undefined],
  ] as const;
  let from: OrderStatus = 'payment_confirmed';
  for (const [to, action, payload] of path) {
    const out = await machine().transition(order.id, action, manager, from, payload as never);
    if (out.kind !== 'done') throw new Error(`${action}: ${out.kind}`);
    if (to === status) return;
    from = to;
  }
  throw new Error(`no path to ${status}`);
}

/** Outbox rows other than the "order created" and "receipt received" messages. */
async function messages() {
  const rows = await t.db.select().from(outbox).orderBy(asc(outbox.id));
  return rows.filter((r) => !/оформлен|rasmiylashtirildi|получен 🧾|qabul qilindi 🧾/.test(r.text));
}

async function eventsOf(number: number) {
  const { id } = await orderRow(number);
  return t.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, id))
    .orderBy(asc(orderEvents.id));
}

async function auditOf(number: number, action: string) {
  const { id } = await orderRow(number);
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, String(id)), eq(auditLog.action, action)));
}

/** The userbot posts a Humo message (#13's intake); a ➕ becomes a credit. */
function postCredit(messageId: number, amount: string, time: string, card = '1234') {
  const feed = initClient(internalContract, {
    baseUrl: t.baseUrl,
    baseHeaders: { 'x-internal-secret': TEST_INTERNAL_SECRET },
    throwOnUnknownStatus: true,
  });
  const text = [
    "💸 To'lov",
    `➕ ${amount} UZS`,
    '📍 CLICK P2P HUMO2UZCAR',
    `💳 HUMOCARD *${card}`,
    `🕓 ${time}`,
    '💰 1.234.567,89 UZS',
  ].join('\n');
  return feed.humoMessage({ body: { messageId, text } });
}

describe('access', () => {
  it('a shopper session is refused everywhere in the panel', async () => {
    const client = await shopper(t, ali, '998901234567');
    const number = await placeOrder(client, await firstSlugs(1));
    const { token } = await t.signIn(ali);
    const headers = { authorization: `Bearer ${token}` };
    const paths: [string, string][] = [
      ['GET', '/admin/orders'],
      ['GET', `/admin/orders/${number}`],
      ['GET', '/admin/credits'],
      ['POST', `/admin/orders/${number}/fulfil`],
      ['POST', `/admin/orders/${number}/cancel`],
      ['POST', `/admin/orders/${number}/reject-receipt`],
    ];
    for (const [method, path] of paths) {
      const res = await fetch(`${t.baseUrl}${path}`, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        body:
          method === 'POST'
            ? JSON.stringify({ expectedStatus: 'awaiting_payment', reason: 'out_of_stock' })
            : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect((await orderRow(number)).status).toBe('awaiting_payment');
  });

  it('the owner and a manager both open the list and the order page', async () => {
    const client = await shopper(t, ali, '998901234567');
    const number = await placeOrder(client, await firstSlugs(1));
    for (const session of [await t.ownerSession(), await t.managerSession()]) {
      const list = await session.client.admin.orders.list({ query: {} });
      expect(list.status).toBe(200);
      const page = await session.client.admin.orders.get({ params: { number } });
      expect(page.status).toBe(200);
      expect((await session.client.admin.credits.list({ query: {} })).status).toBe(200);
    }
  });

  it('a manager switched off is refused', async () => {
    const off = await t.signInStaff('manager', MANAGER_WIDGET_USER);
    await t.db.update(staff).set({ active: false }).where(eq(staff.id, off.staff.id));
    expect((await off.client.admin.orders.list({ query: {} })).status).toBe(401);
  });
});

describe('the orders list', () => {
  /** Four orders by two shoppers over three Tashkent days, each left in another state. */
  async function fourOrders() {
    const [a, b, c, d] = await firstSlugs(4);
    const aliClient = await shopper(t, ali, '998901112233');
    const valiClient = await shopper(t, vali, '998935556677');
    // 2026-11-07 23:30 Tashkent (18:30 UTC): still the 7th there
    t.edges.clock.set(new Date('2026-11-07T18:30:00Z'));
    const unpaid = await placeOrder(aliClient, [a!]);
    t.edges.clock.set(new Date('2026-11-08T09:00:00Z'));
    const checking = await placeOrder(valiClient, [b!], { recipientPhone: '+998 97 444 55 66' });
    await sendReceipt(checking);
    const review = await placeOrder(aliClient, [c!, a!]);
    await holdForManualReview(await sendReceipt(review));
    // 2026-11-08 19:30 UTC is 00:30 on the 9th in Tashkent
    t.edges.clock.set(new Date('2026-11-08T19:30:00Z'));
    const paid = await placeOrder(valiClient, [d!]);
    await walkTo(paid, 'accepted');
    return { unpaid, checking, review, paid };
  }

  const numbers = (res: { status: number; body: unknown }) => {
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    return (res.body as { items: { number: number }[] }).items.map((i) => i.number);
  };

  it('lists every order newest first with its customer, recipient, payment state and total', async () => {
    const { unpaid, checking, review, paid } = await fourOrders();
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.list({ query: {} });
    expect(numbers(res)).toEqual([paid, review, checking, unpaid]);
    if (res.status !== 200) return;
    expect(res.body.total).toBe(4);
    const [p, r, c, u] = res.body.items;
    expect(u).toMatchObject({
      status: 'awaiting_payment',
      payment: 'unpaid',
      customer: { name: 'Ali Karimov', phone: '+998901112233' },
      recipient: { name: 'Ali Valiyev', phone: '+998901234567' },
      itemCount: 1,
      lineCount: 1,
      isGift: false,
    });
    expect(c).toMatchObject({ status: 'receipt_review', payment: 'checking' });
    expect(r).toMatchObject({ status: 'receipt_review', payment: 'manual_review', lineCount: 2 });
    expect(p).toMatchObject({ status: 'accepted', payment: 'paid' });
    expect(r!.region.ru).toMatch(/^Самарк/);
    expect(u!.total).toBe((await orderRow(unpaid)).total);
  });

  it('filters by status, by payment state and by Tashkent days', async () => {
    const { unpaid, checking, review, paid } = await fourOrders();
    const { client } = await t.managerSession();
    const list = (query: AdminOrdersQuery) => client.admin.orders.list({ query }).then(numbers);
    expect(await list({ status: 'receipt_review' })).toEqual([review, checking]);
    expect(await list({ payment: 'unpaid' })).toEqual([unpaid]);
    expect(await list({ payment: 'checking' })).toEqual([checking]);
    expect(await list({ payment: 'manual_review' })).toEqual([review]);
    expect(await list({ payment: 'paid' })).toEqual([paid]);
    expect(await list({ from: '2026-11-08', to: '2026-11-08' })).toEqual([review, checking]);
    expect(await list({ to: '2026-11-07' })).toEqual([unpaid]);
    expect(await list({ from: '2026-11-09' })).toEqual([paid]);
    expect(
      await list({ status: 'receipt_review', payment: 'checking', from: '2026-11-08' }),
    ).toEqual([checking]);
  });

  it('a cancelled order that had been paid stays paid: its money goes back as a Refund', async () => {
    const { paid, unpaid } = await fourOrders();
    const { client } = await t.managerSession();
    for (const [number, expectedStatus] of [
      [paid, 'accepted'],
      [unpaid, 'awaiting_payment'],
    ] as const) {
      const res = await client.admin.orders.cancel({
        params: { number },
        body: { expectedStatus, reason: 'customer_refused' },
      });
      expect(res.status).toBe(200);
    }
    const list = (payment: 'paid' | 'unpaid') =>
      client.admin.orders.list({ query: { status: 'cancelled', payment } }).then(numbers);
    expect(await list('paid')).toEqual([paid]);
    expect(await list('unpaid')).toEqual([unpaid]);
  });

  it('finds an order by its number (first) and by part of a phone, the account’s or the recipient’s', async () => {
    const { unpaid, checking, review, paid } = await fourOrders();
    const { client } = await t.managerSession();
    const search = (q: string) => client.admin.orders.list({ query: { q } }).then(numbers);
    expect(await search(String(review))).toEqual([review]);
    expect(await search(`№ ${checking}`)).toEqual([checking]);
    // Vali's account phone, typed as people do
    expect(await search('93 555 66 77')).toEqual([paid, checking]);
    // the recipient Vali typed for one order
    expect(await search('+998 97 444-55-66')).toEqual([checking]);
    // the default recipient phone is on every other order
    expect(await search('4567')).toEqual([paid, review, unpaid]);
    expect(await search('Ali')).toEqual([]);
    expect(await search('99999')).toEqual([]);
  });

  it('pages through the list', async () => {
    const { unpaid, checking, review, paid } = await fourOrders();
    const { client } = await t.ownerSession();
    const first = await client.admin.orders.list({ query: { pageSize: 3 } });
    const second = await client.admin.orders.list({ query: { pageSize: 3, page: 2 } });
    expect(numbers(first)).toEqual([paid, review, checking]);
    expect(numbers(second)).toEqual([unpaid]);
    expect(first.status === 200 && first.body).toMatchObject({ total: 4, page: 1, pageSize: 3 });
  });
});

describe('the order page', () => {
  it('shows the snapshot, the customer, the receipts with verdicts, the history and the audit', async () => {
    const [a, b] = await firstSlugs(2);
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, [a!, b!], {
      comment: 'Позвоните после 18:00',
      gift: true,
      giftMessage: 'С днём рождения!',
    });
    const first = await sendReceipt(number);
    const manager = await t.managerSession();
    const rejected = await manager.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId: first, reason: 'amount_mismatch', note: 'Перевели 90 000 вместо 188 000' },
    });
    expect(rejected.status).toBe(200);
    t.edges.clock.advance(HOUR);
    const second = await sendReceipt(number);
    await holdForManualReview(second);

    const owner = await t.ownerSession();
    const res = await owner.client.admin.orders.get({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const page = res.body;
    const row = await orderRow(number);
    expect(page.order).toMatchObject({
      number,
      status: 'receipt_review',
      comment: 'Позвоните после 18:00',
      gift: { isGift: true, message: 'С днём рождения!' },
      recipient: { name: 'Ali Valiyev', phone: '+998901234567' },
      total: row.total,
      amountDue: row.amountDue,
      itemsSubtotal: row.itemsSubtotal,
      deliveryFee: row.deliveryFee,
    });
    expect(page.order.lines.map((l) => [l.slug, l.ml, l.qty])).toEqual([
      [a, 10, 1],
      [b, 10, 1],
    ]);
    expect(page.order.delivery.point?.code).toBe(row.pointCode);
    expect(page.payment).toBe('manual_review');
    expect(page.customer).toMatchObject({
      id: row.customerId,
      telegramId: ali.id,
      name: 'Ali Karimov',
      phone: '+998901112233',
      language: 'ru',
    });
    expect(page.receipts.map((r) => [r.id, r.verdict])).toEqual([
      [second, 'manual_review'],
      [first, 'rejected'],
    ]);
    expect(page.receipts[0]).toMatchObject({
      source: 'miniapp',
      fileName: 'chek.png',
      kind: 'png',
      rejection: null,
    });
    expect(page.receipts[1]!.rejection).toEqual({
      reason: 'amount_mismatch',
      note: 'Перевели 90 000 вместо 188 000',
      by: { id: manager.staff.id, name: 'Manager' },
      at: '2026-11-09T10:00:00.000Z',
    });
    expect(page.credit).toBeNull();
    expect(page.events.map((e) => [e.action, e.from, e.to, e.actor.type, e.actor.name])).toEqual([
      ['submit_receipt', 'awaiting_payment', 'receipt_review', 'customer', 'Ali Karimov'],
      ['reject_receipt', 'receipt_review', 'awaiting_payment', 'staff', 'Manager'],
      ['submit_receipt', 'awaiting_payment', 'receipt_review', 'customer', 'Ali Karimov'],
    ]);
    expect(page.events[1]).toMatchObject({
      reason: 'amount_mismatch',
      note: 'Перевели 90 000 вместо 188 000',
      receiptId: first,
    });
    expect(page.audit.map((e) => [e.action, e.actorName])).toEqual([
      ['order.receipt_submitted', 'Ali'],
      ['order.receipt_rejected', 'Manager'],
      ['order.receipt_submitted', 'Ali'],
      ['order.created', 'Ali'],
    ]);
    expect(page.limits).toEqual({ rejectNoteMax: 300, linkReasonMin: 3, linkReasonMax: 500 });
    expect(page.shopCardLast4).toBe('1234');
  });

  it('an unknown number is 404, however long', async () => {
    const { client, cookie } = await t.managerSession();
    expect((await client.admin.orders.get({ params: { number: 999 } })).status).toBe(404);
    for (const [method, path] of [
      ['GET', '/admin/orders/99999999999'],
      ['GET', '/admin/orders/1e30'],
      ['POST', '/admin/orders/99999999999/fulfil'],
      ['POST', '/admin/orders/99999999999/cancel'],
      ['POST', '/admin/orders/99999999999/reject-receipt'],
    ] as const) {
      const res = await fetch(`${t.baseUrl}${path}`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body:
          method === 'POST'
            ? JSON.stringify(
                path.endsWith('fulfil')
                  ? { action: 'accept', expectedStatus: 'payment_confirmed' }
                  : path.endsWith('cancel')
                    ? { expectedStatus: 'awaiting_payment', reason: 'unreachable' }
                    : { receiptId: 1, reason: 'wrong_card' },
              )
            : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('each receipt image opens only through the private staff endpoint', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const id = await sendReceipt(number);
    const manager = await t.managerSession();
    const page = await manager.client.admin.orders.get({ params: { number } });
    expect(page.status === 200 && page.body.receipts[0]!.id).toBe(id);
    for (const variant of ['original', 'normalized']) {
      const path = `/admin/receipts/${id}/file?variant=${variant}`;
      const staffRes = await fetch(`${t.baseUrl}${path}`, { headers: { cookie: manager.cookie } });
      expect(staffRes.status).toBe(200);
      expect(staffRes.headers.get('cache-control')).toBe('private, no-store');
      const { token } = await t.signIn(ali);
      const shopperRes = await fetch(`${t.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(shopperRes.status).toBe(401);
    }
  });
});

describe('reject a receipt', () => {
  it('needs a reason; «Другая причина» needs the manager’s words', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const { cookie } = await t.managerSession();
    for (const body of [
      { receiptId },
      { receiptId, reason: 'other' },
      { receiptId, reason: 'other', note: '   ' },
      { receiptId, reason: 'because' },
    ]) {
      const res = await fetch(`${t.baseUrl}/admin/orders/${number}/reject-receipt`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await orderRow(number)).status).toBe('receipt_review');
    expect(await messages()).toEqual([]);
  });

  it('sends the order back to «Ожидает оплаты», with the history, the audit naming the manager and the shopper’s message', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId, reason: 'wrong_card' },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.order.status).toBe('awaiting_payment');
    expect(res.status === 200 && res.body.receipts[0]).toMatchObject({
      id: receiptId,
      verdict: 'rejected',
      rejection: { reason: 'wrong_card', note: null, by: { name: 'Manager' } },
    });
    expect(res.status === 200 && res.body.payment).toBe('unpaid');
    const [, rejected] = await eventsOf(number);
    expect(rejected).toMatchObject({
      action: 'reject_receipt',
      actorType: 'staff',
      actorId: manager.staff.id,
      reason: 'wrong_card',
      payload: { receiptId },
    });
    const [audit] = await auditOf(number, 'order.receipt_rejected');
    expect(audit).toMatchObject({
      actorType: 'staff',
      actorId: manager.staff.id,
      payload: { from: 'receipt_review', to: 'awaiting_payment', reason: 'wrong_card', receiptId },
    });
    const [message] = await messages();
    expect(message!.chatId).toBe(ali.id);
    expect(message!.text).toBe(
      `Чек к заказу № ${number} не принят.\nПричина: Перевод отправлен не на карту магазина\nПроверьте сумму и карту и загрузите чек ещё раз.`,
    );
    expect(message!.options).toMatchObject({
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть заказ' }],
          [{ text: 'Написать менеджеру', url: 'https://t.me/lummi_manager' }],
        ],
      },
    });
    // the shopper may send another receipt now
    t.edges.clock.advance(HOUR);
    await sendReceipt(number);
    expect((await orderRow(number)).status).toBe('receipt_review');
  });

  it('the shopper reads the reason in their language, with the manager’s note under it', async () => {
    const client = await shopper(t, vali, '998935556677');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const { client: staffClient } = await t.ownerSession();
    const res = await staffClient.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId, reason: 'amount_mismatch', note: '  50 000 soʻm kam oʻtkazilgan  ' },
    });
    expect(res.status).toBe(200);
    const [message] = await messages();
    expect(message!.text).toBe(
      `№ ${number} buyurtma cheki qabul qilinmadi.\nSabab: Chekdagi summa buyurtma summasiga mos kelmaydi\nMenejer izohi: 50 000 soʻm kam oʻtkazilgan\nSumma va kartani tekshirib, chekni qayta yuklang.`,
    );
    expect((await eventsOf(number))[1]!.payload).toMatchObject({
      note: '50 000 soʻm kam oʻtkazilgan',
    });
  });

  it('«Другая причина» sends the manager’s words as the reason', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const { client: staffClient } = await t.managerSession();
    await staffClient.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId, reason: 'other', note: 'На чеке дата прошлого месяца' },
    });
    const [message] = await messages();
    expect(message!.text).toContain('Причина: На чеке дата прошлого месяца\nПроверьте');
  });

  it('a receipt held for manual review is rejected the same way', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    await holdForManualReview(receiptId);
    const { client: staffClient } = await t.managerSession();
    const res = await staffClient.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId, reason: 'unreadable' },
    });
    expect(res.status === 200 && res.body.receipts[0]!.verdict).toBe('rejected');
  });

  it('a note over the setting is refused with the limit, and nothing changes', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'receipts.rejectNoteMaxLength' },
      body: { value: 20 },
    });
    const reject = (note: string) =>
      owner.client.admin.orders.rejectReceipt({
        params: { number },
        body: { receiptId, reason: 'other', note },
      });
    const long = await reject('ё'.repeat(21));
    expect(long.status).toBe(422);
    expect(long.body).toEqual({ code: 'note_too_long', max: 20 });
    expect((await orderRow(number)).status).toBe('receipt_review');
    expect((await reject('ё'.repeat(20))).status).toBe(200);
  });

  it('a stale screen gets 409 with the order as it is now: the order moved on, or a newer receipt waits', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const first = await sendReceipt(number);
    const manager = await t.managerSession();
    const other = await t.signInStaff('manager', SECOND_MANAGER);
    expect(
      (
        await manager.client.admin.orders.rejectReceipt({
          params: { number },
          body: { receiptId: first, reason: 'wrong_card' },
        })
      ).status,
    ).toBe(200);

    // the second manager still looks at the first receipt, now rejected
    const again = await other.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId: first, reason: 'unreadable' },
    });
    expect(again.status).toBe(409);
    expect(again.status === 409 && 'order' in again.body && again.body).toMatchObject({
      code: 'status_changed',
      order: { order: { status: 'awaiting_payment' } },
    });

    // the shopper sent a new receipt: the order is under check again, but not with that one
    t.edges.clock.advance(HOUR);
    const second = await sendReceipt(number);
    const stale = await other.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId: first, reason: 'unreadable' },
    });
    expect(stale.status).toBe(409);
    expect(stale.status === 409 && 'order' in stale.body && stale.body.code).toBe(
      'receipt_changed',
    );
    expect((await orderRow(number)).status).toBe('receipt_review');
    const page = await other.client.admin.orders.get({ params: { number } });
    expect(page.status === 200 && page.body.receipts.map((r) => [r.id, r.verdict])).toEqual([
      [second, 'pending'],
      [first, 'rejected'],
    ]);
    expect((await messages()).filter((m) => /не принят/.test(m.text))).toHaveLength(1);
  });

  it('a receipt of another order is 404', async () => {
    const client = await shopper(t, ali, '998901112233');
    const [a, b] = await firstSlugs(2);
    const one = await placeOrder(client, [a!]);
    const two = await placeOrder(client, [b!]);
    const receiptOfTwo = await sendReceipt(two);
    await sendReceipt(one);
    const { client: staffClient } = await t.managerSession();
    const res = await staffClient.admin.orders.rejectReceipt({
      params: { number: one },
      body: { receiptId: receiptOfTwo, reason: 'wrong_card' },
    });
    expect(res.status).toBe(404);
    expect((await orderRow(one)).status).toBe('receipt_review');
  });

  it('has one door: transition() refuses reject_receipt from anyone but ReceiptRejection', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const { id } = await orderRow(number);
    const manager = { type: 'staff' as const, id: (await t.managerSession()).staff.id };
    const out = await machine().transition(id, 'reject_receipt', manager, 'receipt_review', {
      receiptId,
      reason: 'wrong_card',
      pausedSeconds: 0,
    });
    expect(out).toEqual({ kind: 'refused', code: 'forbidden' });
    expect((await orderRow(number)).status).toBe('receipt_review');
    expect(await messages()).toEqual([]);
  });

  it('an older receipt is never rejected while a newer one is under check, whatever its verdict', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const older = await sendReceipt(number);
    const manager = await t.managerSession();
    await manager.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId: older, reason: 'unreadable' },
    });
    t.edges.clock.advance(HOUR);
    const newer = await sendReceipt(number);
    // a verdict left open by mistake must not let a stale screen reject the wrong receipt
    await t.db.update(receipts).set({ verdict: 'pending' }).where(eq(receipts.id, older));
    const res = await manager.client.admin.orders.rejectReceipt({
      params: { number },
      body: { receiptId: older, reason: 'wrong_card' },
    });
    expect(res.status).toBe(409);
    expect(res.status === 409 && 'order' in res.body && res.body.code).toBe('receipt_changed');
    const [latest] = await t.db.select().from(receipts).where(eq(receipts.id, newer));
    expect(latest!.verdict).toBe('pending');
    expect((await orderRow(number)).status).toBe('receipt_review');
  });

  it('two managers pressing at once: one rejects, the other gets 409', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const receiptId = await sendReceipt(number);
    const a = await t.managerSession();
    const b = await t.signInStaff('manager', SECOND_MANAGER);
    const results = await whileLockedUntil(t, 'order_events', 2, () =>
      Promise.all(
        [a, b].map((m) =>
          m.client.admin.orders.rejectReceipt({
            params: { number },
            body: { receiptId, reason: 'wrong_card' },
          }),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.status === 409 && 'order' in loser.body && loser.body.code).toBe('status_changed');
    expect((await eventsOf(number)).filter((e) => e.action === 'reject_receipt')).toHaveLength(1);
    expect((await messages()).filter((m) => /не принят/.test(m.text))).toHaveLength(1);
  });
});

describe('fulfilment, one step at a time', () => {
  it('«Принят» → «Собирается» → «Передан в BTS» with the tracking number → «Доставлен», each audited with the manager', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'payment_confirmed');
    const manager = await t.managerSession();
    const steps = [
      [{ action: 'accept', expectedStatus: 'payment_confirmed' }, 'accepted', 'order.accepted'],
      [{ action: 'start_assembly', expectedStatus: 'accepted' }, 'assembling', 'order.assembling'],
      [
        { action: 'hand_to_bts', expectedStatus: 'assembling', trackingNumber: '  UZ 0042 7781  ' },
        'handed_to_bts',
        'order.handed_to_bts',
      ],
      [{ action: 'deliver', expectedStatus: 'handed_to_bts' }, 'delivered', 'order.delivered'],
    ] as const;
    for (const [body, status, auditAction] of steps) {
      const res = await manager.client.admin.orders.fulfil({ params: { number }, body });
      expect(res.status, body.action).toBe(200);
      expect(res.status === 200 && res.body.order.status).toBe(status);
      const [audit] = await auditOf(number, auditAction);
      expect(audit, auditAction).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
    }
    const page = await manager.client.admin.orders.get({ params: { number } });
    expect(page.status === 200 && page.body.trackingNumber).toBe('UZ 0042 7781');
    expect(
      page.status === 200 &&
        page.body.events.filter((e) => e.actor.type === 'staff').map((e) => e.actor.name),
    ).toEqual(['Manager', 'Manager', 'Manager', 'Manager']);
    expect(
      page.status === 200 && page.body.events.find((e) => e.action === 'hand_to_bts'),
    ).toMatchObject({ trackingNumber: 'UZ 0042 7781' });
    // the shopper hears of every step but «Принят»
    expect((await messages()).map((m) => m.text.split('\n')[0])).toEqual([
      `Оплата заказа № ${number} подтверждена ✅`,
      `Собираем заказ № ${number} 📦`,
      `Заказ № ${number} передан в BTS 🚚`,
      `Заказ № ${number} доставлен ✨`,
    ]);
    expect((await messages())[2]!.text).toContain('Трек-номер: UZ 0042 7781');
  });

  it('«Передан в BTS» needs a tracking number of six characters or more', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'assembling');
    const { cookie } = await t.managerSession();
    for (const trackingNumber of [undefined, '', '      ', ' 12345 ']) {
      const res = await fetch(`${t.baseUrl}/admin/orders/${number}/fulfil`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'hand_to_bts',
          expectedStatus: 'assembling',
          trackingNumber,
        }),
      });
      expect(res.status, String(trackingNumber)).toBe(400);
    }
    expect((await orderRow(number)).status).toBe('assembling');
  });

  it('a step that skips one is refused (422) and changes nothing', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'payment_confirmed');
    const { client: staffClient } = await t.managerSession();
    const res = await staffClient.admin.orders.fulfil({
      params: { number },
      body: { action: 'deliver', expectedStatus: 'payment_confirmed' },
    });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: 'not_allowed' });
    // unpaid orders are not fulfilled
    const unpaid = await placeOrder(client, (await firstSlugs(2)).slice(1));
    const early = await staffClient.admin.orders.fulfil({
      params: { number: unpaid },
      body: { action: 'accept', expectedStatus: 'awaiting_payment' },
    });
    expect(early.status).toBe(422);
    expect((await orderRow(number)).status).toBe('payment_confirmed');
    expect((await orderRow(unpaid)).status).toBe('awaiting_payment');
  });

  it('a stale status is 409 with the order as it is now', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'accepted');
    const { client: staffClient } = await t.managerSession();
    const res = await staffClient.admin.orders.fulfil({
      params: { number },
      body: { action: 'accept', expectedStatus: 'payment_confirmed' },
    });
    expect(res.status).toBe(409);
    expect(res.status === 409 && 'order' in res.body && res.body).toMatchObject({
      code: 'status_changed',
      order: { order: { status: 'accepted', number } },
    });
    expect((await auditOf(number, 'order.accepted')).length).toBe(1);
  });

  it('a second manager acting on the status both saw: one moves the order, the other gets 409', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'assembling');
    const a = await t.managerSession();
    const b = await t.signInStaff('manager', SECOND_MANAGER);
    const results = await whileLockedUntil(t, 'order_events', 2, () =>
      Promise.all(
        [
          ['UZ 0042 7781', a],
          ['UZ 0042 9999', b],
        ].map(([trackingNumber, m]) =>
          (m as StaffSession).client.admin.orders.fulfil({
            params: { number },
            body: {
              action: 'hand_to_bts',
              expectedStatus: 'assembling',
              trackingNumber: trackingNumber as string,
            },
          }),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.status === 409 && 'order' in loser.body && loser.body.order.order.status).toBe(
      'handed_to_bts',
    );
    expect((await eventsOf(number)).filter((e) => e.action === 'hand_to_bts')).toHaveLength(1);
    expect((await messages()).filter((m) => /передан в BTS/.test(m.text))).toHaveLength(1);
  });
});

describe('cancel with a reason', () => {
  it('needs a staff reason', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    const { cookie, client: staffClient } = await t.managerSession();
    const res = await fetch(`${t.baseUrl}/admin/orders/${number}/cancel`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedStatus: 'awaiting_payment' }),
    });
    expect(res.status).toBe(400);
    // the shopper's own reason and the sweep's are not staff reasons
    for (const reason of ['customer_cancelled', 'reserve_expired'] as const) {
      const refused = await staffClient.admin.orders.cancel({
        params: { number },
        body: { expectedStatus: 'awaiting_payment', reason },
      });
      expect(refused.status).toBe(422);
      expect(refused.body).toEqual({ code: 'invalid_payload' });
    }
    expect((await orderRow(number)).status).toBe('awaiting_payment');
  });

  it('cancels with the reason and a note in the history, the audit naming the manager and the shopper’s message', async () => {
    const client = await shopper(t, vali, '998935556677');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'assembling');
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.cancel({
      params: { number },
      body: {
        expectedStatus: 'assembling',
        reason: 'out_of_stock',
        note: 'Флакон разбит при сборке',
      },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.order).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'out_of_stock', afterPayment: true },
    });
    expect(res.status === 200 && res.body.events.at(-1)).toMatchObject({
      action: 'cancel',
      reason: 'out_of_stock',
      note: 'Флакон разбит при сборке',
      actor: { type: 'staff', name: 'Manager' },
    });
    const [audit] = await auditOf(number, 'order.cancelled');
    expect(audit).toMatchObject({
      actorType: 'staff',
      actorId: manager.staff.id,
      payload: { reason: 'out_of_stock', note: 'Флакон разбит при сборке' },
    });
    const message = (await messages()).at(-1)!;
    expect(message.chatId).toBe(vali.id);
    expect(message.text).toBe(
      `№ ${number} buyurtma bekor qilindi.\nMahsulot mavjud boʻlmay qoldi.\nPulni qaytarish uchun menejer siz bilan bogʻlanadi.`,
    );
  });

  it('«Не забрал в BTS» only after the parcel was handed over', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'assembling');
    const { client: staffClient } = await t.managerSession();
    const early = await staffClient.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'assembling', reason: 'not_collected_at_bts' },
    });
    expect(early.status).toBe(422);
    await staffClient.admin.orders.fulfil({
      params: { number },
      body: { action: 'hand_to_bts', expectedStatus: 'assembling', trackingNumber: 'UZ 0042 7781' },
    });
    const late = await staffClient.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'handed_to_bts', reason: 'not_collected_at_bts' },
    });
    expect(late.status).toBe(200);
  });

  it('a delivered order is not cancelled (422), and a stale status is 409', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    await walkTo(number, 'delivered');
    const { client: staffClient } = await t.managerSession();
    const done = await staffClient.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'delivered', reason: 'customer_refused' },
    });
    expect(done.status).toBe(422);
    const stale = await staffClient.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'handed_to_bts', reason: 'customer_refused' },
    });
    expect(stale.status).toBe(409);
    expect(stale.status === 409 && 'order' in stale.body && stale.body.order.order.status).toBe(
      'delivered',
    );
  });

  it('the shopper cancelled meanwhile: the manager gets 409 with the cancelled order', async () => {
    const client = await shopper(t, ali, '998901112233');
    const number = await placeOrder(client, await firstSlugs(1));
    expect(
      (
        await client.orders.cancel({
          params: { number },
          body: { expectedStatus: 'awaiting_payment' },
        })
      ).status,
    ).toBe(200);
    const { client: staffClient } = await t.managerSession();
    const res = await staffClient.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment', reason: 'unreachable' },
    });
    expect(res.status).toBe(409);
    expect(
      res.status === 409 && 'order' in res.body && res.body.order.order.cancellation,
    ).toMatchObject({
      reason: 'customer_cancelled',
    });
  });
});

describe('the credits list', () => {
  it('lists Humo credits newest first, «Не привязано» among them, with the card and the amount to the tiyin', async () => {
    expect((await postCredit(101, '149.000,00', '14:05 08.11.2026')).status).toBe(200);
    expect((await postCredit(102, '75.750,50', '09:12 09.11.2026')).status).toBe(200);
    expect((await postCredit(103, '1.250.000,00', '10:40 09.11.2026', '9876')).status).toBe(200);
    const { client } = await t.managerSession();
    const res = await client.admin.credits.list({ query: {} });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.total).toBe(3);
    expect(
      res.body.items.map((c) => [c.amountTiyin, c.amountSom, c.cardLast4, c.onShopCard, c.order]),
    ).toEqual([
      [125_000_000, 1_250_000, '9876', false, null],
      [7_575_050, null, '1234', true, null],
      [14_900_000, 149_000, '1234', true, null],
    ]);
    // 10:40 Tashkent is 05:40 UTC
    expect(res.body.items[0]).toMatchObject({
      occurredAt: '2026-11-09T05:40:00.000Z',
      counterparty: 'CLICK P2P HUMO2UZCAR',
    });
    const unlinked = await client.admin.credits.list({ query: { linked: 'unlinked' } });
    expect(unlinked.status === 200 && unlinked.body.total).toBe(3);
    const linked = await client.admin.credits.list({ query: { linked: 'linked' } });
    expect(linked.status === 200 && linked.body.items).toEqual([]);
  });

  it('filters by the whole-so’m amount and by Tashkent days, and pages', async () => {
    await postCredit(101, '149.000,00', '23:30 07.11.2026');
    await postCredit(102, '149.000,00', '00:10 08.11.2026');
    await postCredit(103, '99.000,00', '12:00 08.11.2026');
    const { client } = await t.ownerSession();
    const amounts = async (query: AdminCreditsQuery) => {
      const res = await client.admin.credits.list({ query });
      if (res.status !== 200) throw new Error(`credits ${res.status}`);
      return res.body.items.map((c) => [c.amountSom, c.occurredAt]);
    };
    expect(await amounts({ amount: 149_000 })).toEqual([
      [149_000, '2026-11-07T19:10:00.000Z'],
      [149_000, '2026-11-07T18:30:00.000Z'],
    ]);
    expect(await amounts({ from: '2026-11-08', to: '2026-11-08' })).toEqual([
      [99_000, '2026-11-08T07:00:00.000Z'],
      [149_000, '2026-11-07T19:10:00.000Z'],
    ]);
    expect(await amounts({ pageSize: 1, page: 3 })).toEqual([
      [149_000, '2026-11-07T18:30:00.000Z'],
    ]);
  });
});

describe('link a credit and confirm the payment (#32 PaymentConfirmation, actor: the manager)', () => {
  /** A placed order of Ali's; its id and amount due. */
  async function unpaidOrder(slugIndex = 0) {
    const client = await shopper(t, ali, '998901112233');
    const slug = (await firstSlugs(slugIndex + 1))[slugIndex]!;
    return orderRow(await placeOrder(client, [slug]));
  }
  const MIN = 60_000;

  it('offers the Candidate credits first, then other unlinked credits after the order, never one from before it or one taken', async () => {
    t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
    const before = await recordCredit(t, { som: 94_000, at: new Date('2026-11-09T09:58:00Z') });
    const o = await unpaidOrder();
    t.edges.clock.advance(5 * MIN);
    const exact = await recordCredit(t, { som: o.amountDue });
    const otherCard = await recordCredit(t, { som: o.amountDue, last4: '9876' });
    const more = await recordCredit(t, { som: o.amountDue + 5_000 });
    const tiyin = await recordCredit(t, { som: o.amountDue, tiyin: 50 });
    // a credit that already paid another order
    const other = await unpaidOrder(1);
    const otherReceipt = await sendReceipt(other.number);
    await payWithCredit(t, other, otherReceipt);
    const { client } = await t.managerSession();
    const res = await client.admin.orders.creditOptions({ params: { number: o.number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.amountDue).toBe(o.amountDue);
    expect(res.body.candidates.map((c) => [c.id, c.differenceTiyin, c.onShopCard])).toEqual([
      [exact, 0, true],
    ]);
    expect(res.body.others.map((c) => [c.id, c.differenceTiyin, c.onShopCard])).toEqual([
      [tiyin, 50, true],
      [more, 500_000, true],
      [otherCard, 0, false],
    ]);
    expect(res.body.othersTotal).toBe(3);
    expect([...res.body.candidates, ...res.body.others].map((c) => c.id)).not.toContain(before);
  });

  it('confirms an unpaid order with a credit that came with no receipt, audited with the manager', async () => {
    const o = await unpaidOrder();
    t.edges.clock.advance(3 * MIN);
    const creditId = await recordCredit(t, { som: o.amountDue });
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.confirmPayment({
      params: { number: o.number },
      body: { creditId, receiptId: null },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.order.status).toBe('payment_confirmed');
    expect(res.body.payment).toBe('paid');
    expect(res.body.credit).toMatchObject({
      id: creditId,
      amountTiyin: o.amountDue * 100,
      onShopCard: true,
      order: { number: o.number },
      link: {
        differenceTiyin: 0,
        offShopCard: false,
        reason: null,
        by: { type: 'staff', id: manager.staff.id, name: 'Manager' },
      },
    });
    const [audit] = await auditOf(o.number, 'order.payment_confirmed');
    expect(audit).toMatchObject({
      actorType: 'staff',
      actorId: manager.staff.id,
      payload: { creditId, receiptId: null },
    });
    expect((await messages()).map((m) => m.text.split('\n')[0])).toEqual([
      `Оплата заказа № ${o.number} подтверждена ✅`,
    ]);
    // the credits list shows the link
    const linked = await manager.client.admin.credits.list({ query: { linked: 'linked' } });
    expect(linked.status === 200 && linked.body.items.map((c) => [c.id, c.order])).toEqual([
      [creditId, { number: o.number }],
    ]);
    const unlinked = await manager.client.admin.credits.list({ query: { linked: 'unlinked' } });
    expect(unlinked.status === 200 && unlinked.body.total).toBe(0);
  });

  it('confirms a receipt held for manual review with the credit the manager picks; the page shows the AI answer', async () => {
    const o = await unpaidOrder();
    const receiptId = await sendReceipt(o.number);
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: o.amountDue });
    // the AI looks and is not sure: the receipt waits for a person (#32)
    t.edges.receiptJudge.verdicts = [
      {
        isReceipt: 0.97,
        amountMatches: 0.55,
        recipientMatches: 0.91,
        chosenCreditId: creditId,
        choiceConfidence: 0.42,
        confirmed: false,
        provider: 'typesafe',
        reason: 'below threshold',
      },
    ];
    await t.app.get(PaymentMatching).check(receiptId);
    const manager = await t.managerSession();
    const held = await manager.client.admin.orders.get({ params: { number: o.number } });
    expect(held.status === 200 && held.body.payment).toBe('manual_review');
    expect(held.status === 200 && held.body.receipts[0]).toMatchObject({
      id: receiptId,
      verdict: 'manual_review',
      reviewReason: 'not_confirmed',
      confirmation: null,
      checks: [
        {
          candidates: 1,
          provider: 'typesafe',
          isReceipt: 0.97,
          amountMatches: 0.55,
          recipientMatches: 0.91,
          choiceConfidence: 0.42,
          chosenCreditId: creditId,
          confirmed: false,
          reason: 'below threshold',
          outcome: 'manual_review',
        },
      ],
    });
    expect(held.status === 200 && held.body.credit).toBeNull();

    const res = await manager.client.admin.orders.confirmPayment({
      params: { number: o.number },
      body: { creditId, receiptId },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.order.status).toBe('payment_confirmed');
    expect(res.status === 200 && res.body.receipts[0]).toMatchObject({
      verdict: 'manager_confirmed',
      confirmation: { by: { type: 'staff', id: manager.staff.id, name: 'Manager' } },
    });
    const [audit] = await auditOf(o.number, 'order.payment_confirmed');
    expect(audit).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
  });

  it('a credit of another amount or card needs the manager’s reason; then it links, the difference kept', async () => {
    const o = await unpaidOrder();
    const receiptId = await sendReceipt(o.number);
    t.edges.clock.advance(2 * MIN);
    const more = await recordCredit(t, { som: o.amountDue + 5_000, last4: '9876' });
    const { client, staff: manager } = await t.managerSession();
    const confirm = (reason?: string) =>
      client.admin.orders.confirmPayment({
        params: { number: o.number },
        body: { creditId: more, receiptId, ...(reason === undefined ? {} : { reason }) },
      });
    const first = await confirm();
    expect(first.status).toBe(422);
    expect(first.body).toEqual({ code: 'reason_required', mismatch: ['amount', 'card'] });
    // the body's own bound (3 characters) refuses a slip; the setting caps the length (500)
    const { cookie } = await t.managerSession();
    const short = await fetch(`${t.baseUrl}/admin/orders/${o.number}/confirm-payment`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ creditId: more, receiptId, reason: 'ok' }),
    });
    expect(short.status).toBe(400);
    const long = await confirm('я'.repeat(501));
    expect(long.status).toBe(422);
    expect(long.body).toEqual({ code: 'reason_invalid', min: 3, max: 500 });
    expect((await orderRow(o.number)).status).toBe('receipt_review');

    const res = await confirm('Перевели с запасом на старую карту, разницу вернём');
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.credit?.link).toMatchObject({
      differenceTiyin: 500_000,
      offShopCard: true,
      reason: 'Перевели с запасом на старую карту, разницу вернём',
      by: { type: 'staff', id: manager.id },
    });
  });

  it('counts a reason in characters as a person does: an emoji is one, on both sides', async () => {
    const o = await unpaidOrder();
    t.edges.clock.advance(2 * MIN);
    const more = await recordCredit(t, { som: o.amountDue + 5_000 });
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'payments.linkReasonMaxLength' },
      body: { value: 20 },
    });
    const confirm = (reason: string) =>
      fetch(`${t.baseUrl}/admin/orders/${o.number}/confirm-payment`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ creditId: more, receiptId: null, reason }),
      });
    // two characters (four UTF-16 units) are under the 3-character minimum
    expect((await confirm('🙂🙂')).status).toBe(400);
    expect((await orderRow(o.number)).status).toBe('awaiting_payment');
    // twenty characters (forty units) are within the 20-character setting
    expect((await confirm('🙂'.repeat(20))).status).toBe(200);
  });

  it('a reject note is counted the same way', async () => {
    const o = await unpaidOrder();
    const receiptId = await sendReceipt(o.number);
    const owner = await t.ownerSession();
    await owner.client.admin.settings.update({
      params: { key: 'receipts.rejectNoteMaxLength' },
      body: { value: 20 },
    });
    const res = await owner.client.admin.orders.rejectReceipt({
      params: { number: o.number },
      body: { receiptId, reason: 'other', note: '🙂'.repeat(20) },
    });
    expect(res.status).toBe(200);
  });

  it('an id past the safe integers is 400, never a database error', async () => {
    const o = await unpaidOrder();
    const { cookie } = await t.managerSession();
    for (const [path, body] of [
      ['confirm-payment', { creditId: 1e20, receiptId: null }],
      ['confirm-payment', { creditId: 1, receiptId: 1e20 }],
      ['reject-receipt', { receiptId: 1e20, reason: 'wrong_card' }],
    ] as const) {
      const res = await fetch(`${t.baseUrl}/admin/orders/${o.number}/${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('a credit from before the order never pays it', async () => {
    t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
    const early = await recordCredit(t, { som: 94_000, at: new Date('2026-11-09T09:30:00Z') });
    const o = await unpaidOrder();
    const { client } = await t.managerSession();
    const res = await client.admin.orders.confirmPayment({
      params: { number: o.number },
      body: { creditId: early, receiptId: null, reason: 'Покупатель перевёл заранее' },
    });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: 'credit_mismatch', what: 'before_order' });
  });

  it('a stale screen gets 409 with the order as it is now', async () => {
    const o = await unpaidOrder();
    const receiptId = await sendReceipt(o.number);
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: o.amountDue });
    const { client } = await t.managerSession();
    // the screen still showed «Ожидает оплаты», but a receipt came in
    const noReceipt = await client.admin.orders.confirmPayment({
      params: { number: o.number },
      body: { creditId, receiptId: null },
    });
    expect(noReceipt.status).toBe(409);
    expect(noReceipt.status === 409 && 'order' in noReceipt.body && noReceipt.body).toMatchObject({
      code: 'status_changed',
      order: { order: { status: 'receipt_review' } },
    });
    expect(
      (
        await client.admin.orders.confirmPayment({
          params: { number: o.number },
          body: { creditId, receiptId },
        })
      ).status,
    ).toBe(200);
    // and a second press
    const again = await client.admin.orders.confirmPayment({
      params: { number: o.number },
      body: { creditId, receiptId },
    });
    expect(again.status).toBe(409);
    expect(again.status === 409 && 'order' in again.body && again.body.order.order.status).toBe(
      'payment_confirmed',
    );
  });

  it('two managers link one credit to two orders at once: one pays, the other hears credit_taken', async () => {
    const a = await unpaidOrder(0);
    const client = await shopper(t, vali, '998935556677');
    const bNumber = await placeOrder(client, [(await firstSlugs(1))[0]!]);
    const b = await orderRow(bNumber);
    expect(b.amountDue).toBe(a.amountDue);
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: a.amountDue });
    const one = await t.managerSession();
    const two = await t.signInStaff('manager', SECOND_MANAGER);
    const results = await whileLockedUntil(t, 'order_events', 2, () =>
      Promise.all([
        one.client.admin.orders.confirmPayment({
          params: { number: a.number },
          body: { creditId, receiptId: null },
        }),
        two.client.admin.orders.confirmPayment({
          params: { number: b.number },
          body: { creditId, receiptId: null },
        }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.status === 409 && 'order' in loser.body && loser.body).toMatchObject({
      code: 'credit_taken',
      order: { order: { status: 'awaiting_payment' } },
    });
    const paid = await t.db.select().from(orders).where(eq(orders.creditId, creditId));
    expect(paid).toHaveLength(1);
  });

  it('a duplicate receipt, which the AI never confirms, is confirmed by a manager', async () => {
    const image = await uniqueReceiptImage();
    const a = await unpaidOrder(0);
    const b = await unpaidOrder(1);
    const duplicate = await sendReceipt(a.number, image);
    // the later copy takes the payment-not-found path at once (#36); the first waits for a person
    const repeat = await sendReceipt(b.number, image);
    const [held] = await t.db.select().from(receipts).where(eq(receipts.id, duplicate));
    expect([held!.verdict, held!.reviewReason]).toEqual(['manual_review', 'duplicate']);
    const [decided] = await t.db.select().from(receipts).where(eq(receipts.id, repeat));
    expect([decided!.verdict, decided!.duplicateOf]).toEqual(['payment_not_found', duplicate]);
    t.edges.clock.advance(2 * MIN);
    const creditId = await recordCredit(t, { som: a.amountDue });
    const { client } = await t.managerSession();
    const page = await client.admin.orders.get({ params: { number: a.number } });
    expect(page.status === 200 && page.body.receipts[0]!.reviewReason).toBe('duplicate');
    const res = await client.admin.orders.confirmPayment({
      params: { number: a.number },
      body: { creditId, receiptId: duplicate },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body.receipts[0]!.verdict).toBe('manager_confirmed');
  });

  it('an unpaid order has no credit; the limits come with the page', async () => {
    const o = await unpaidOrder();
    const { client } = await t.managerSession();
    const page = await client.admin.orders.get({ params: { number: o.number } });
    expect(page.status === 200 && page.body.credit).toBeNull();
    expect(page.status === 200 && page.body.limits).toEqual({
      rejectNoteMax: 300,
      linkReasonMin: 3,
      linkReasonMax: 500,
    });
  });

  it('a shopper session is refused', async () => {
    const o = await unpaidOrder();
    const { token } = await t.signIn(ali);
    for (const [method, path] of [
      ['GET', `/admin/orders/${o.number}/credit-options`],
      ['POST', `/admin/orders/${o.number}/confirm-payment`],
    ]) {
      const res = await fetch(`${t.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ creditId: 1, receiptId: null }) : undefined,
      });
      expect(res.status, path).toBe(401);
    }
  });
});
