import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signContact } from '@lummi/contracts/sign-contact';
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
  regions,
  volumes,
} from '@lummi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { WorkerRuntime } from '../src/worker/runtime';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

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
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const HOUR = 3600_000;
const MIN = 60_000;
/** One worker tick (every sweep, then the outbox) at the fake clock's "now". */
const tick = () => t.app.get(WorkerRuntime).tick();

/** A shopper with a shared phone, signed in. */
async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  return client;
}
type Client = Awaited<ReturnType<typeof shopper>>;

async function firstSlug() {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows.map((r) => r.slug).sort()[0]!;
}

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id, onHand: volumes.onHand })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}

/** What a shopper sees as available for that volume on the fragrance card. */
async function available(client: Client, slug: string, ml: number) {
  const card = await client.catalog.fragrance({ params: { slug } });
  if (card.status !== 200) throw new Error(`card ${card.status}`);
  return card.body.volumes.find((v) => v.ml === ml)!.available;
}

/** Places an order for `qty` of the slug's 10 ml at the quoted total; returns its number. */
async function placeOrder(client: Client, slug: string, qty = 1) {
  const add = await client.cart.addLine({ body: { slug, ml: 10, qty } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
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
      idempotencyKey: randomUUID(),
    },
  });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return res.body.number;
}

async function orderRow(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  return o!;
}
async function eventsOf(number: number) {
  const o = await orderRow(number);
  return t.db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, o.id))
    .orderBy(asc(orderEvents.id));
}
/**
 * Runs `run` while another session holds an EXCLUSIVE lock on `table` (reads pass, writes wait),
 * released after `holdMs`: concurrent requests line up at their first write to it.
 */
async function whileTableLocked<T>(table: string, run: () => Promise<T>, holdMs = 600): Promise<T> {
  const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
  await locker.connect();
  try {
    await locker.query('begin');
    await locker.query(`lock table ${table} in exclusive mode`);
    const pending = run();
    await new Promise((r) => setTimeout(r, holdMs));
    await locker.query('commit');
    return await pending;
  } finally {
    await locker.end();
  }
}

/** Outbox rows other than the "order created" message. */
async function messages() {
  const rows = await t.db.select().from(outbox).orderBy(asc(outbox.id));
  return rows.filter((r) => !/оформлен|rasmiylashtirildi/.test(r.text));
}

describe('the shopper cancels their own order', () => {
  it('while «Ожидает оплаты»: the reserve frees at once, with the event, the audit and the message', async () => {
    const slug = await firstSlug();
    const client = await shopper();
    await t.db
      .update(volumes)
      .set({ onHand: 3 })
      .where(eq(volumes.id, (await volumeOf(slug, 10)).id));
    const number = await placeOrder(client, slug, 2);
    expect(await available(client, slug, 10)).toBe(1);
    t.edges.clock.advance(HOUR / 2);

    const res = await client.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toMatchObject({
      number,
      status: 'cancelled',
      cancellation: { reason: 'customer_cancelled', at: '2026-11-09T10:30:00.000Z' },
    });
    // the reserve is gone at once; on hand never moved (nothing left the warehouse)
    expect(await available(client, slug, 10)).toBe(3);
    expect((await volumeOf(slug, 10)).onHand).toBe(3);

    const [event] = await eventsOf(number);
    expect(event).toMatchObject({
      fromStatus: 'awaiting_payment',
      toStatus: 'cancelled',
      action: 'cancel',
      actorType: 'customer',
      reason: 'customer_cancelled',
      createdAt: new Date('2026-11-09T10:30:00Z'),
    });
    expect(event!.actorId).not.toBeNull();
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'order.cancelled'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'customer',
      actorId: event!.actorId,
      targetType: 'order',
      payload: { number, from: 'awaiting_payment', to: 'cancelled', reason: 'customer_cancelled' },
    });

    const [message] = await messages();
    expect(message).toMatchObject({
      chatId: ali.id,
      text: `Заказ № ${number} отменён.\nВы отменили заказ.`,
      options: {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть заказ',
                web_app: { url: `https://miniapp.test.invalid/orders/${number}` },
              },
            ],
          ],
        },
      },
    });
  });
});

describe('a cancel the shopper may not make', () => {
  it('a second press finds the order already cancelled: 409 with the order, nothing written twice', async () => {
    const client = await shopper();
    const number = await placeOrder(client, await firstSlug());
    const body = { expectedStatus: 'awaiting_payment' as const };
    expect((await client.orders.cancel({ params: { number }, body })).status).toBe(200);
    const again = await client.orders.cancel({ params: { number }, body });
    expect(again.status).toBe(409);
    expect(again.status === 409 && again.body).toMatchObject({
      code: 'status_changed',
      order: { number, status: 'cancelled', cancellation: { reason: 'customer_cancelled' } },
    });
    expect(await eventsOf(number)).toHaveLength(1);
    expect(await messages()).toHaveLength(1);
  });

  it('not once a receipt is under check, nor from a status the shopper did not see', async () => {
    const client = await shopper();
    const number = await placeOrder(client, await firstSlug());
    await t.db.update(orders).set({ status: 'receipt_review' }).where(eq(orders.number, number));

    // the shopper's screen still said «Ожидает оплаты»: the status moved on
    const stale = await client.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(stale.status === 409 && stale.body).toMatchObject({
      code: 'status_changed',
      order: { status: 'receipt_review', cancellation: null },
    });
    // only staff cancels from «Чек на проверке»; nobody leaves «Отменён»
    const forbidden = await client.orders.cancel({
      params: { number },
      body: { expectedStatus: 'receipt_review' },
    });
    expect([forbidden.status, forbidden.body]).toEqual([403, { code: 'forbidden' }]);
    const ended = await client.orders.cancel({
      params: { number },
      body: { expectedStatus: 'cancelled' },
    });
    expect([ended.status, ended.body]).toEqual([403, { code: 'not_allowed' }]);
    expect((await orderRow(number)).status).toBe('receipt_review');
    expect(await eventsOf(number)).toHaveLength(0);
    expect(await messages()).toHaveLength(0);
  });

  it("another shopper's order is not found", async () => {
    const owner = await shopper();
    const number = await placeOrder(owner, await firstSlug());
    const other = await shopper(vali, '998907654321');
    const res = await other.orders.cancel({
      params: { number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(res.status).toBe(404);
    expect((await orderRow(number)).status).toBe('awaiting_payment');
  });
});

describe('the reserve reminder (setting orders.reserveReminderSeconds, 2 h)', () => {
  // created 10:00 UTC, reserved 12 h: until 22:00 UTC = 03:00 Tashkent; reminded from 20:00 UTC
  it('goes once, 2 h before the reserve ends, in the customer language with «Открыть заказ»', async () => {
    const client = await shopper(vali, '998907654321');
    const number = await placeOrder(client, await firstSlug());

    t.edges.clock.set(new Date('2026-11-09T19:59:00Z'));
    await tick();
    expect(await messages()).toHaveLength(0);

    t.edges.clock.set(new Date('2026-11-09T20:00:00Z'));
    await tick();
    await tick();
    t.edges.clock.advance(30 * MIN);
    await tick();
    const sent = await messages();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      chatId: vali.id,
      text: `№ ${number} buyurtma 10-noyabr, 03:00 gacha band qilingan ⏳\n94\u202f000\u202fsoʻm oʻtkazing va chekni yuklang: shunda toʻlov tekshirilguncha bandlik saqlanadi.`,
      options: {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Buyurtmani ochish',
                web_app: { url: `https://miniapp.test.invalid/orders/${number}` },
              },
            ],
          ],
        },
      },
    });
    expect((await orderRow(number)).reserveReminderSentAt).toEqual(
      new Date('2026-11-09T20:00:00Z'),
    );
  });

  it('follows the setting, and skips an order whose receipt is under check', async () => {
    const owner = await t.ownerSession();
    const set = await owner.client.admin.settings.update({
      params: { key: 'orders.reserveReminderSeconds' },
      body: { value: 4 * 3600 },
    });
    expect(set.status).toBe(200);
    const client = await shopper();
    const waiting = await placeOrder(client, await firstSlug());
    const checked = await placeOrder(client, await firstSlug());
    await t.db.update(orders).set({ status: 'receipt_review' }).where(eq(orders.number, checked));

    t.edges.clock.set(new Date('2026-11-09T18:00:00Z'));
    await tick();
    const sent = await messages();
    expect(sent.map((m) => m.text.split('\n')[0])).toEqual([
      `Заказ № ${waiting} забронирован до 10 ноября, 03:00 ⏳`,
    ]);
  });

  it('is not sent once the reserve has ended (the expiry cancel speaks instead), nor for a cancelled order', async () => {
    const client = await shopper();
    const cancelled = await placeOrder(client, await firstSlug());
    await client.orders.cancel({
      params: { number: cancelled },
      body: { expectedStatus: 'awaiting_payment' },
    });
    const late = await placeOrder(client, await firstSlug());
    t.edges.clock.set(new Date('2026-11-09T22:00:00Z'));
    await tick();
    const texts = (await messages()).map((m) => m.text);
    expect(texts.some((m) => m.includes('забронирован до'))).toBe(false);
    expect((await orderRow(late)).reserveReminderSentAt).toBeNull();
  });
});

describe('the reserve expiry (ADR 0012)', () => {
  it('the system cancels an unpaid order when its reserve ends, frees the stock and says why, once', async () => {
    const slug = await firstSlug();
    const client = await shopper();
    const number = await placeOrder(client, slug, 2);
    const before = await available(client, slug, 10);

    t.edges.clock.set(new Date('2026-11-09T21:59:00Z'));
    await tick();
    expect((await orderRow(number)).status).toBe('awaiting_payment');

    t.edges.clock.set(new Date('2026-11-09T22:00:00Z'));
    await tick();
    await tick();
    t.edges.clock.advance(5 * MIN);
    await tick();
    expect((await orderRow(number)).status).toBe('cancelled');
    const events = await eventsOf(number);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromStatus: 'awaiting_payment',
      toStatus: 'cancelled',
      actorType: 'system',
      actorId: null,
      reason: 'reserve_expired',
      createdAt: new Date('2026-11-09T22:00:00Z'),
    });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'order.cancelled'));
    expect(audit.map((a) => [a.actorType, a.actorId])).toEqual([['system', null]]);

    const cancels = (await messages()).filter((m) => m.text.includes('отменён'));
    expect(cancels.map((m) => m.text)).toEqual([
      `Заказ № ${number} отменён.\nВремя брони истекло, а чек не поступил.`,
    ]);
    expect(cancels[0]!.options).toMatchObject({
      reply_markup: { inline_keyboard: [[{ text: 'Открыть заказ' }]] },
    });

    const again = (await t.signIn(ali)).client;
    expect(await available(again, slug, 10)).toBe(before + 2);
    const order = await again.orders.get({ params: { number } });
    expect(order.status === 200 && order.body.cancellation).toEqual({
      reason: 'reserve_expired',
      at: '2026-11-09T22:00:00.000Z',
    });
  });

  it('never cancels an order whose receipt is under check', async () => {
    const client = await shopper();
    const number = await placeOrder(client, await firstSlug());
    await t.db.update(orders).set({ status: 'receipt_review' }).where(eq(orders.number, number));
    t.edges.clock.set(new Date('2026-11-10T09:00:00Z'));
    await tick();
    expect((await orderRow(number)).status).toBe('receipt_review');
    expect(await eventsOf(number)).toHaveLength(0);
    expect(await messages()).toHaveLength(0);
  });

  it('a shopper cancelling as the sweep runs: the order is cancelled once, with one message', async () => {
    const client = await shopper();
    const number = await placeOrder(client, await firstSlug());
    t.edges.clock.set(new Date('2026-11-09T22:00:00Z'));
    const again = (await t.signIn(ali)).client;

    // both reach the order before either writes its history: the row lock decides
    const [cancel] = await whileTableLocked('order_events', () =>
      Promise.all([
        again.orders.cancel({ params: { number }, body: { expectedStatus: 'awaiting_payment' } }),
        tick(),
      ]),
    );
    expect([200, 409]).toContain(cancel.status);
    expect(cancel.status === 409 && cancel.body.code).not.toBe('try_again');
    const events = await eventsOf(number);
    expect(events).toHaveLength(1);
    expect((await orderRow(number)).status).toBe('cancelled');
    expect((await messages()).filter((m) => m.text.includes('отменён'))).toHaveLength(1);
  });
});
