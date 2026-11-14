import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asc,
  credits,
  eq,
  fragrances,
  orderEvents,
  orders,
  outbox,
  paymentPauses,
  settings as settingsTable,
  receipts,
  shopCard,
  type OutboxRow,
} from '@lummi/db';
import { Queue } from 'bullmq';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import type { ReceiptJudgeInput, ReceiptJudgement } from '../src/edges';
import { seedCatalog } from '../src/catalog/seed';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { SettingsService } from '../src/settings/settings.service';
import type { WorkerRuntime } from '../src/worker/runtime';
import { orderBody, samarkandPoint, shopper } from './harness/orders';
import { recordCredit, uniqueReceiptImage, userbotHeartbeat } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028) with the Clock fake: receipts with no money behind them (ADR 0012, #36).
 * Receipts go in over HTTP, credits and heartbeats through the userbot's internal endpoints, and
 * the worker's minute is `worker.tick()` at the fake clock's now.
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const GROUP = -1_001_234_567_890;
const SYSTEM_TOPIC = 7;
const OWNER = 900_001;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let t: TestApp;
let worker: WorkerRuntime;
let checks: Queue;
let settings: SettingsService;
beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
  settings = t.app.get(SettingsService);
  checks = new Queue(t.env.RECEIPT_CHECKS_QUEUE, { connection: { url: t.env.REDIS_URL } });
});
afterAll(async () => {
  await checks.close();
  await t.close();
});
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:30Z'));
  t.edges.receiptJudge.calls.length = 0;
  t.edges.receiptJudge.respond = undefined;
  t.edges.receiptJudge.verdicts = [notConfirmed];
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  await settings.set('bot.groupChatId', GROUP, { type: 'system' });
  await settings.set(
    'bot.topics',
    { orders: null, payments: null, reviews: null, system: SYSTEM_TOPIC },
    { type: 'system' },
  );
  await settings.set('bot.alertRecipients', [OWNER], { type: 'system' });
});
afterEach(() => settled());

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** One bottle (10 ml unless `ml`) ordered by a shopper; the order as stored and who ordered it. */
async function placeOrder(user: TestUser = ali, phone = '998901234567', ml: 10 | 30 = 10) {
  const client = await shopper(t, user, phone);
  const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
  if ((await client.cart.addLine({ body: { slug: f!.slug, ml, qty: 1 } })).status !== 200)
    throw new Error('add');
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  const [order] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  return { order: order!, user, slug: f!.slug };
}
type Placed = Awaited<ReturnType<typeof placeOrder>>;

/** `POST /orders/:number/receipts` as the Mini App sends it (a fresh screenshot unless `file`). */
async function upload(p: Placed, file?: Buffer): Promise<number> {
  // signed in afresh: the fake clock outruns the session
  const { token } = await t.signIn(p.user);
  const res = await fetch(`${t.baseUrl}/orders/${p.order.number}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: file ?? (await uniqueReceiptImage()),
  });
  if (res.status !== 201) throw new Error(`upload ${res.status}`);
  return ((await res.json()) as { receipt: { id: number } }).receipt.id;
}

const statusOf = async (p: Placed) => (await orderNow(p.order.id)).status;
const receiptNow = async (id: number) =>
  (await t.db.select().from(receipts).where(eq(receipts.id, id)))[0]!;
const orderNow = async (id: number) =>
  (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;
const sent = async (): Promise<OutboxRow[]> => t.db.select().from(outbox).orderBy(asc(outbox.id));
/** Posts in the «Системные» topic. */
const systemPosts = async () =>
  (await sent())
    .filter((m) => m.chatId === GROUP && m.threadId === SYSTEM_TOPIC)
    .map((m) => m.text);
/** What the shopper was told. */
const toShopper = async (p: Placed) => (await sent()).filter((m) => m.chatId === p.user.id);
const buttonsOf = (m: OutboxRow) =>
  (
    (m.options as { reply_markup?: { inline_keyboard: { text: string; url?: string }[][] } })
      .reply_markup?.inline_keyboard ?? []
  ).flat();

/** `GET /orders/:number/payment` as the shopper reads it. */
async function paymentScreen(p: Placed) {
  const { client } = await t.signIn(p.user);
  const res = await client.orders.payment({ params: { number: p.order.number } });
  if (res.status !== 200) throw new Error(`payment ${res.status}`);
  return res.body;
}

/** What a shopper sees as available for the ordered volume on the fragrance card. */
async function available(p: Placed) {
  // signed in afresh: the fake clock outruns the session
  const { client } = await t.signIn(p.user);
  const card = await client.catalog.fragrance({ params: { slug: p.slug } });
  if (card.status !== 200) throw new Error(`card ${card.status}`);
  return card.body.volumes.find((v) => v.ml === 10)!.available;
}

/** The judge's answer when the receipt shows none of the candidates' times. */
const notConfirmed: ReceiptJudgement = {
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.93,
  chosenCreditId: null,
  choiceConfidence: 0.9,
  confirmed: false,
  provider: 'typesafe',
  reason: 'typesafe: below threshold',
};

/** The judge's answer when every question clears the thresholds and it picks `creditId`. */
const confirmedChoosing = (creditId: number): ReceiptJudgement => ({
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.93,
  chosenCreditId: creditId,
  choiceConfidence: 0.81,
  confirmed: true,
  provider: 'typesafe',
});
/** A judge that confirms the latest candidate it is shown (the shopper's own transfer). */
const pickLatest = (input: ReceiptJudgeInput) =>
  confirmedChoosing(input.candidates.at(-1)!.creditId);

/** The owner's DMs about the payment feed. */
const pauseAlerts = async () =>
  (await sent())
    .filter((m) => m.chatId === OWNER && m.text.includes('Таймеры чеков'))
    .map((m) => m.text);

/** Humo is alive: the userbot beats and some credit (not this shop's order amount) comes in. */
async function feedAlive() {
  await userbotHeartbeat(t);
  await recordCredit(t, { som: 1_000 });
}

/** Every credit event handled and no receipt check queued or running. */
async function settled() {
  await vi.waitFor(
    async () => {
      const rows = await t.db.select({ at: credits.eventHandledAt }).from(credits);
      expect(rows.filter((r) => r.at === null)).toHaveLength(0);
      const counts = await checks.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    },
    { timeout: 15_000, interval: 50 },
  );
}

/**
 * The worker's minute at `ms` from now, with the feed alive (a heartbeat and a credit) unless told
 * otherwise; `beat` keeps the heartbeat without a credit (the userbot up, Humo silent).
 */
async function minuteLater(ms: number, opts: { feed?: boolean; beat?: boolean } = {}) {
  t.edges.clock.advance(ms);
  if (opts.feed ?? true) await feedAlive();
  else if (opts.beat) await userbotHeartbeat(t);
  await settled();
  await worker.tick();
}

describe('payment not found (the wait window, ADR 0012)', () => {
  it('before the reserve ends: back to «Ожидает оплаты», the shopper is asked to re-upload, the group is told', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const receiptId = await upload(placed);
    await settled();

    await minuteLater(2 * HOUR - MINUTE);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('pending');

    await minuteLater(2 * MINUTE);
    expect(await statusOf(placed)).toBe('awaiting_payment');
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'payment_not_found'));
    expect(event).toMatchObject({
      fromStatus: 'receipt_review',
      toStatus: 'awaiting_payment',
      actorType: 'system',
      payload: { receiptId, duplicateOf: null },
    });
    // the reserve is as it was: nothing paused it
    expect((await orderNow(placed.order.id)).reserveUntil).toEqual(placed.order.reserveUntil);

    const told = (await toShopper(placed)).at(-1)!;
    expect(told.text).toContain(`Мы не нашли перевод по заказу № ${placed.order.number}`);
    // the payment screen says so too, for a shopper who does not read the bot
    expect((await paymentScreen(placed)).receipts).toMatchObject([
      { id: receiptId, state: 'not_found' },
    ]);
    expect(buttonsOf(told).map((b) => b.text)).toEqual(['Открыть заказ', 'Написать менеджеру']);
    expect((await systemPosts()).filter((p) => p.includes('Оплата не найдена'))).toEqual([
      expect.stringContaining(`заказ № ${placed.order.number}`),
    ]);

    // the sweep again changes nothing and says nothing
    const before = (await sent()).length;
    await minuteLater(MINUTE);
    await minuteLater(MINUTE);
    expect((await sent()).length).toBe(before);
    expect(
      await t.db.select().from(orderEvents).where(eq(orderEvents.action, 'payment_not_found')),
    ).toHaveLength(1);
  });

  it('after the reserve ended: back to «Ожидает оплаты», then cancelled by the system; the stock returns', async () => {
    await settings.set('orders.reserveTtlSeconds', HOUR / 1000, { type: 'system' });
    const placed = await placeOrder();
    const free = await available(placed);
    await minuteLater(10 * MINUTE);
    const receiptId = await upload(placed);
    await settled();

    // the reserve ends at +1 h, but «Чек на проверке» holds it
    await minuteLater(HOUR);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect(await available(placed)).toBe(free);

    await minuteLater(HOUR + MINUTE);
    expect(await statusOf(placed)).toBe('cancelled');
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
    expect(await available(placed)).toBe(free + 1);
    const moves = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, placed.order.id))
      .orderBy(asc(orderEvents.id));
    expect(moves.slice(-2)).toMatchObject([
      {
        action: 'payment_not_found',
        toStatus: 'awaiting_payment',
        payload: { receiptId, reserveEnded: true },
      },
      { action: 'cancel', toStatus: 'cancelled', actorType: 'system', reason: 'reserve_expired' },
    ]);

    // the shopper hears why first (with «Написать менеджеру»: they may have paid), then the cancel
    const [notFound, cancelled] = (await toShopper(placed)).slice(-2);
    expect(notFound!.text).toContain('а время брони истекло');
    expect(notFound!.text).not.toContain('загрузите чек');
    expect(buttonsOf(notFound!).map((b) => b.text)).toContain('Написать менеджеру');
    expect(cancelled!.text).toContain(`Заказ № ${placed.order.number} отменён`);
    // the group reads what the shopper was really told
    const [post] = (await systemPosts()).filter((p) => p.includes('Оплата не найдена'));
    expect(post).toContain('заказ отменён');
    expect(post).toContain('Покупателю предложили написать менеджеру');
    expect(post).not.toContain('загрузить чек заново');
  });

  it('no shop card set: nothing to match against, so nothing is «not found»', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const receiptId = await upload(placed);
    await settled();
    await t.db.delete(shopCard);

    await minuteLater(3 * HOUR);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
  });

  it('a fitting credit the AI could not confirm: the receipt waits for a person, never «not found»', async () => {
    const placed = await placeOrder();
    await feedAlive();
    t.edges.receiptJudge.verdicts = [notConfirmed];
    const receiptId = await upload(placed);
    t.edges.clock.advance(5 * MINUTE);
    await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect((await receiptNow(receiptId)).verdict).toBe('manual_review');

    for (let i = 0; i < 3; i++) await minuteLater(HOUR);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('manual_review');
    expect(await systemPosts()).not.toContainEqual(expect.stringContaining('Оплата не найдена'));
  });

  it('a fitting credit marked «Не для заказа» (#49) is no candidate: the receipt ends «not found» with the window', async () => {
    const placed = await placeOrder();
    await feedAlive();
    t.edges.clock.advance(MINUTE);
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    const { client } = await t.managerSession();
    const marked = await client.admin.credits.markNotForOrder({
      params: { id: creditId },
      body: { note: 'Личный перевод' },
    });
    expect(marked.status).toBe(200);
    const receiptId = await upload(placed);
    await settled();
    expect(t.edges.receiptJudge.calls).toEqual([]);

    await minuteLater(2 * HOUR - MINUTE);
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    await minuteLater(2 * MINUTE);
    expect(await statusOf(placed)).toBe('awaiting_payment');
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
    expect((await orderNow(placed.order.id)).creditId).toBeNull();
    expect(t.edges.receiptJudge.calls).toEqual([]);
  });
});

describe('after payment not found, the newest receipt is the only waiting one (#33 carry-over)', () => {
  it('a late credit pays the order through the receipt sent again, never the decided one', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const paidAt = t.edges.clock.now();
    const first = await upload(placed);
    await settled();
    await minuteLater(2 * HOUR + MINUTE);
    expect((await receiptNow(first)).verdict).toBe('payment_not_found');

    const second = await upload(placed);
    t.edges.receiptJudge.respond = pickLatest;
    // Humo was late with this one, but it is the shopper's money
    const creditId = await recordCredit(t, { som: placed.order.amountDue, at: paidAt });
    await settled();

    expect(await statusOf(placed)).toBe('payment_confirmed');
    expect(t.edges.receiptJudge.calls).toHaveLength(1);
    expect((await receiptNow(second)).verdict).toBe('ai_confirmed');
    expect((await receiptNow(first)).verdict).toBe('payment_not_found');
    expect((await orderNow(placed.order.id)).creditId).toBe(creditId);
  });

  it('has one door: transition() refuses payment_not_found from anyone but PaymentNotFound', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    await settled();
    const out = await t.app
      .get(OrderStatusService)
      .transition(placed.order.id, 'payment_not_found', { type: 'system' }, 'receipt_review', {
        receiptId,
        duplicateOf: null,
        pausedSeconds: 0,
        reserveEnded: false,
      });
    expect(out).toEqual({ kind: 'refused', code: 'forbidden' });
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
  });

  it('the payment door refuses the decided receipt', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const first = await upload(placed);
    await settled();
    await minuteLater(2 * HOUR + MINUTE);
    await upload(placed);
    await settled();
    const creditId = await recordCredit(t, { som: 5_000 });
    await settled();

    const out = await t.app.get(PaymentConfirmation).confirmPayment({
      orderId: placed.order.id,
      creditId,
      receiptId: first,
      actor: { type: 'staff', id: 1 },
      reason: 'test',
    });
    expect(out).toEqual({ kind: 'receipt_not_waiting', verdict: 'payment_not_found' });
    expect(await statusOf(placed)).toBe('receipt_review');
  });
});

describe('the payment feed pauses every receipt timer (ADR 0012)', () => {
  it('an outage that would have cancelled a paid order does not: the credit comes after it and pays the order', async () => {
    await settings.set('orders.reserveTtlSeconds', HOUR / 1000, { type: 'system' });
    const placed = await placeOrder();
    await minuteLater(10 * MINUTE);
    // the shopper pays and uploads; the userbot falls silent before Humo's message reaches us
    const paidAt = t.edges.clock.now();
    const receiptId = await upload(placed);
    await settled();

    await minuteLater(4 * MINUTE, { feed: false });
    expect(await pauseAlerts()).toEqual([]);
    await minuteLater(2 * MINUTE, { feed: false });
    expect(await pauseAlerts()).toEqual([expect.stringContaining('Таймеры чеков на паузе')]);
    expect((await pauseAlerts())[0]).toContain('Юзербот не выходит на связь');

    // without the pause, the wait window (2 h) would end after the reserve (1 h): a cancel
    for (let i = 0; i < 6; i++) await minuteLater(30 * MINUTE, { feed: false });
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    expect(await pauseAlerts()).toHaveLength(1);

    // the userbot is back and catches up: the shopper's credit arrives, the AI confirms it
    t.edges.receiptJudge.respond = pickLatest;
    await userbotHeartbeat(t);
    const creditId = await recordCredit(t, { som: placed.order.amountDue, at: paidAt });
    await settled();
    expect(await statusOf(placed)).toBe('payment_confirmed');
    expect((await orderNow(placed.order.id)).creditId).toBe(creditId);

    await minuteLater(MINUTE);
    expect(await pauseAlerts()).toEqual([
      expect.stringContaining('Таймеры чеков на паузе'),
      expect.stringContaining('Таймеры чеков снова идут'),
    ]);
    expect(await t.db.select().from(orderEvents).where(eq(orderEvents.action, 'cancel'))).toEqual(
      [],
    );
  });

  it('pause by silence: no credit for 30 min while a receipt waits; the timers resume extended by the pause', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const receiptId = await upload(placed);
    await settled();
    /** The userbot is up, but Humo sends nothing. */
    const quietMinute = async (ms: number) => {
      t.edges.clock.advance(ms);
      await userbotHeartbeat(t);
      await worker.tick();
    };

    await quietMinute(29 * MINUTE);
    expect(await pauseAlerts()).toEqual([]);
    await quietMinute(2 * MINUTE);
    // paused from here on, announced once it has lasted a few minutes
    expect(await t.db.select().from(paymentPauses)).toHaveLength(1);
    expect(await pauseAlerts()).toEqual([]);
    await quietMinute(5 * MINUTE);
    expect(await pauseAlerts()).toEqual([
      expect.stringContaining('от Humo не пришло ни одного поступления'),
    ]);

    // three hours of silence: the 2 h wait window does not run out
    await quietMinute(25 * MINUTE);
    for (let i = 0; i < 5; i++) await quietMinute(30 * MINUTE);
    expect(await statusOf(placed)).toBe('receipt_review');
    expect(await pauseAlerts()).toHaveLength(1);

    // Humo speaks again: the pause (3 h) ends, the window goes on from where it stopped
    await minuteLater(0);
    expect((await pauseAlerts()).at(-1)).toContain('Пауза длилась 3 часа');
    await minuteLater(HOUR + 28 * MINUTE);
    expect(await statusOf(placed)).toBe('receipt_review');
    await minuteLater(2 * MINUTE);
    expect(await statusOf(placed)).toBe('awaiting_payment');
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
    // the reserve did not run while the feed was paused
    const reserveUntil = new Date(placed.order.reserveUntil.getTime() + 3 * HOUR);
    expect((await orderNow(placed.order.id)).reserveUntil).toEqual(reserveUntil);
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'payment_not_found'));
    expect(event!.payload).toMatchObject({ pausedSeconds: 3 * 3600, reserveEnded: false });
    // ordered 10:00:30 UTC with a 12 h reserve: 03:00 in Tashkent the next day, plus 3 h
    expect((await toShopper(placed)).at(-1)!.text).toContain('до 10 ноября, 06:00');
  });

  it('a window ending while the userbot has just fallen silent is not decided; the pause counts from its last heartbeat', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const receiptId = await upload(placed);
    await settled();
    // the userbot beats until 1 h 58 min, then stops; the window ends at 2 h
    await minuteLater(HOUR + 58 * MINUTE);
    for (let i = 0; i < 5; i++) await minuteLater(MINUTE, { feed: false });
    // 2 h 03 min: no heartbeat since the window ended, so nothing is decided before the
    // 5 min stale threshold even notices
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    await minuteLater(MINUTE, { feed: false });
    const [pause] = await t.db.select().from(paymentPauses);
    expect(pause!.startedAt).toEqual(
      new Date(placed.order.createdAt.getTime() + HOUR + 58 * MINUTE),
    );

    // back at 3 h: the receipt keeps the 2 minutes it had left when the userbot fell silent
    await minuteLater(56 * MINUTE);
    await minuteLater(MINUTE);
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    await minuteLater(2 * MINUTE);
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
  });

  it('a manager rejecting after a pause gives the reserve back the paused time', async () => {
    await settings.set('orders.reserveTtlSeconds', HOUR / 1000, { type: 'system' });
    const placed = await placeOrder();
    await minuteLater(10 * MINUTE);
    const receiptId = await upload(placed);
    await settled();
    // the userbot is down from 0:15 to 2:15
    await minuteLater(5 * MINUTE);
    for (let i = 0; i < 4; i++) await minuteLater(30 * MINUTE, { feed: false });
    await minuteLater(0);
    expect(await statusOf(placed)).toBe('receipt_review');

    const { client } = await t.managerSession();
    const res = await client.admin.orders.rejectReceipt({
      params: { number: placed.order.number },
      body: { receiptId, reason: 'not_received' },
    });
    expect(res.status).toBe(200);
    // reserved until 1:00, plus the 2 h pause: the shopper still has time to send another receipt
    expect((await orderNow(placed.order.id)).reserveUntil).toEqual(
      new Date(placed.order.reserveUntil.getTime() + 2 * HOUR),
    );
    await minuteLater(MINUTE);
    expect(await statusOf(placed)).toBe('awaiting_payment');
  });

  it('a quiet shop with no credits at all: the moneyless receipt waits, the owner is told once', async () => {
    const placed = await placeOrder();
    await userbotHeartbeat(t);
    const receiptId = await upload(placed);
    await settled();
    for (let i = 0; i < 12; i++) await minuteLater(30 * MINUTE, { feed: false, beat: true });
    expect(await statusOf(placed)).toBe('receipt_review');
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    expect(await pauseAlerts()).toEqual([
      expect.stringContaining('От Humo ещё не пришло ни одного поступления'),
    ]);
  });

  it('credits now and then, each within a few minutes of the silence threshold: the window goes on, no alerts', async () => {
    const placed = await placeOrder();
    await feedAlive();
    const receiptId = await upload(placed);
    await settled();
    // a credit every 33 min: the silence threshold (30 min) passes for 3 min each time
    for (let minute = 1; minute <= 3 * 60; minute++) {
      t.edges.clock.advance(MINUTE);
      await userbotHeartbeat(t);
      if (minute % 33 === 0) await recordCredit(t, { som: 1_000 });
      await worker.tick();
      if ((await receiptNow(receiptId)).verdict !== 'pending') break;
    }
    expect((await receiptNow(receiptId)).verdict).toBe('payment_not_found');
    expect(await pauseAlerts()).toEqual([]);
  });

  it('a receipt held for a person does not keep the silence pause armed', async () => {
    const placed = await placeOrder();
    await feedAlive();
    t.edges.receiptJudge.verdicts = [notConfirmed];
    const receiptId = await upload(placed);
    await recordCredit(t, { som: placed.order.amountDue });
    await settled();
    expect((await receiptNow(receiptId)).verdict).toBe('manual_review');

    for (let i = 0; i < 6; i++) await minuteLater(30 * MINUTE, { feed: false, beat: true });
    expect(await pauseAlerts()).toEqual([]);
    expect(await t.db.select().from(paymentPauses)).toEqual([]);
  });

  it('the userbot down while no receipt waits pauses nothing and alerts nobody', async () => {
    await placeOrder();
    await minuteLater(HOUR, { feed: false });
    await minuteLater(HOUR, { feed: false });
    expect(await pauseAlerts()).toEqual([]);
    expect(await t.db.select().from(paymentPauses)).toEqual([]);
  });

  it('one alert per outage, and one when it is over', async () => {
    const placed = await placeOrder();
    await feedAlive();
    await upload(placed);
    await settled();
    for (let outage = 0; outage < 2; outage++) {
      await minuteLater(6 * MINUTE, { feed: false });
      await minuteLater(30 * MINUTE, { feed: false });
      await minuteLater(30 * MINUTE, { feed: false });
      await minuteLater(MINUTE);
      await minuteLater(MINUTE);
    }
    const alerts = await pauseAlerts();
    expect(alerts.map((a) => a.split('\n')[1])).toEqual([
      'Таймеры чеков на паузе.',
      'Таймеры чеков снова идут: лента Humo работает.',
      'Таймеры чеков на паузе.',
      'Таймеры чеков снова идут: лента Humo работает.',
    ]);
    // each one also went to the «Системные» topic
    expect((await systemPosts()).filter((p) => p.includes('Таймеры чеков'))).toHaveLength(4);
  });
});

describe('the feed guards stay below the wait window and the reserve', () => {
  it('the owner cannot save a combination where an outage could outlast them', async () => {
    const { client } = await t.ownerSession();
    const save = (key: string, value: number) =>
      client.admin.settings.update({ params: { key }, body: { value } });

    expect(await save('payments.humoSilenceSeconds', 7200)).toMatchObject({
      status: 400,
      body: { code: 'invalid_value', issues: [{ code: 'feed_guard_too_long', max: 7140 }] },
    });
    expect(await save('payments.notFoundAfterSeconds', 1800)).toMatchObject({
      status: 400,
      body: { code: 'invalid_value', issues: [{ code: 'wait_too_short', min: 1860 }] },
    });
    expect(await save('orders.reserveTtlSeconds', 1800)).toMatchObject({
      status: 400,
      body: { issues: [{ code: 'wait_too_short', min: 1860 }] },
    });
    // in the right order it saves
    expect((await save('payments.humoSilenceSeconds', 1200)).status).toBe(200);
    expect((await save('payments.notFoundAfterSeconds', 1800)).status).toBe(200);
    expect((await save('orders.reserveTtlSeconds', 1800)).status).toBe(200);
  });

  it('a stored combination that breaks the rule is clamped when read', async () => {
    // as if saved before the rule: a 10 min window and a 1 h silence threshold
    await t.db.insert(settingsTable).values([
      { key: 'payments.notFoundAfterSeconds', value: 600 },
      { key: 'payments.humoSilenceSeconds', value: 3600 },
    ]);
    const placed = await placeOrder();
    await userbotHeartbeat(t);
    const receiptId = await upload(placed);
    await settled();
    // the threshold reads as 9 min: paused before the 10 min window can end
    for (let i = 0; i < 12; i++) await minuteLater(MINUTE, { feed: false, beat: true });
    expect((await receiptNow(receiptId)).verdict).toBe('pending');
    expect(await t.db.select().from(paymentPauses)).toHaveLength(1);
  });
});

describe('a repeated receipt skips the AI and takes the payment-not-found path (spec 2026-11-07)', () => {
  it('the same file as a receipt that paid another order: no AI, «Повторный чек» in the group, the shopper asked for this transfer', async () => {
    const first = await placeOrder();
    const file = await uniqueReceiptImage();
    t.edges.receiptJudge.respond = pickLatest;
    const original = await upload(first, file);
    await recordCredit(t, { som: first.order.amountDue });
    await settled();
    expect(await statusOf(first)).toBe('payment_confirmed');
    t.edges.receiptJudge.calls.length = 0;

    const second = await placeOrder(vali, '998907654321');
    // a fitting credit is already there: had the duplicate rule failed, the AI would be asked
    t.edges.clock.advance(MINUTE);
    const own = await recordCredit(t, { som: second.order.amountDue });
    await settled();
    const receiptId = await upload(second, file);
    await settled();

    expect(t.edges.receiptJudge.calls).toEqual([]);
    expect(await receiptNow(receiptId)).toMatchObject({
      verdict: 'payment_not_found',
      duplicateOf: original,
      reviewReason: null,
    });
    expect(await statusOf(second)).toBe('awaiting_payment');
    const [event] = await t.db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.action, 'payment_not_found'));
    expect(event!.payload).toMatchObject({ receiptId, duplicateOf: original });
    expect((await systemPosts()).filter((p) => p.includes('Повторный чек'))).toEqual([
      expect.stringContaining(
        `Этот чек уже был у заказа № ${first.order.number} (тот же файл). ИИ его не проверял.`,
      ),
    ]);
    expect((await paymentScreen(second)).receipts).toMatchObject([
      { id: receiptId, state: 'repeat' },
    ]);
    // Vali reads Uzbek
    const told = (await toShopper(second)).at(-1)!;
    expect(told.text).toContain('Bu chek boshqa buyurtmaga yuborilgan');
    expect(buttonsOf(told).map((b) => b.text)).toContain('Menejerga yozish');

    // its own money can still pay the order: a new receipt for it is checked as usual
    await upload(second);
    await settled();
    expect(await statusOf(second)).toBe('payment_confirmed');
    expect((await orderNow(second.order.id)).creditId).toBe(own);
  });

  it('the same file on two waiting orders: the later one takes the path, the first is held for a person', async () => {
    t.edges.receiptJudge.respond = pickLatest;
    const first = await placeOrder();
    // another volume, another amount: the second order's credit is never a candidate of the first
    const second = await placeOrder(vali, '998907654321', 30);
    expect(second.order.amountDue).not.toBe(first.order.amountDue);
    const file = await uniqueReceiptImage();
    const r1 = await upload(first, file);
    await settled();
    // the second order's money is there before its receipt: the AI would be asked if it were
    // not a repeat
    await recordCredit(t, { som: second.order.amountDue });
    await settled();
    const r2 = await upload(second, file);
    await settled();

    expect(await receiptNow(r2)).toMatchObject({
      verdict: 'payment_not_found',
      duplicateOf: r1,
      reviewReason: null,
    });
    expect(await statusOf(second)).toBe('awaiting_payment');
    // the first may be the honest one: no AI either, but its own timers and a person
    expect(await receiptNow(r1)).toMatchObject({
      verdict: 'manual_review',
      reviewReason: 'duplicate',
    });
    expect(await statusOf(first)).toBe('receipt_review');
    await recordCredit(t, { som: first.order.amountDue });
    await minuteLater(3 * HOUR);
    expect(t.edges.receiptJudge.calls).toEqual([]);
    expect(await statusOf(first)).toBe('receipt_review');
    expect((await systemPosts()).filter((p) => p.includes('Повторный чек'))).toHaveLength(1);
  });

  it('by the perceptual hash, once the owner sets a distance: a look-alike image of another order’s receipt', async () => {
    const image = await uniqueReceiptImage();
    // the same pixels saved again: another file (SHA-256), the same picture (perceptual hash)
    const resaved = await sharp(image).png({ compressionLevel: 1 }).toBuffer();
    expect(resaved.equals(image)).toBe(false);

    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    await upload(first, image);
    // off by default: two receipts of one bank app look alike (spec Changes, #36)
    const lookAlike = await upload(second, resaved);
    await settled();
    expect((await receiptNow(lookAlike)).verdict).toBe('pending');

    await settings.set('receipts.duplicateImageDistance', 0, { type: 'system' });
    t.edges.receiptJudge.respond = pickLatest;
    const third = await placeOrder(
      { id: 43, first_name: 'Sardor', language_code: 'ru' },
      '998901112233',
      30,
    );
    // its money is there: the AI would be asked if the look-alike were not caught
    await recordCredit(t, { som: third.order.amountDue });
    await settled();
    const again = await upload(third, await sharp(image).png({ compressionLevel: 9 }).toBuffer());
    await settled();
    expect(t.edges.receiptJudge.calls).toEqual([]);
    expect(await receiptNow(again)).toMatchObject({
      verdict: 'payment_not_found',
      reviewReason: null,
    });
    expect((await receiptNow(again)).duplicateOf).not.toBeNull();
    expect((await systemPosts()).filter((p) => p.includes('Повторный чек'))).toContainEqual(
      expect.stringContaining(`заказ № ${third.order.number}`),
    );
    expect((await systemPosts()).join('\n')).toContain('(похожее изображение)');
  });
});

describe('a receipt nobody decided', () => {
  /** The owner's DMs about receipts waiting too long. */
  const uncheckedAlerts = async () =>
    (await sent())
      .filter((m) => m.chatId === OWNER && m.text.includes('не проверен'))
      .map((m) => m.text);

  it('waiting longer than the setting alerts the owner once per receipt', async () => {
    const placed = await placeOrder();
    await feedAlive();
    await upload(placed);
    await settled();

    await minuteLater(14 * MINUTE);
    expect(await uncheckedAlerts()).toEqual([]);
    await minuteLater(2 * MINUTE);
    expect(await uncheckedAlerts()).toEqual([
      expect.stringContaining(`Чек к заказу № ${placed.order.number} не проверен 16 минут`),
    ]);
    expect((await uncheckedAlerts())[0]).toContain('ждёт поступления 94\u202f000\u202fсум');
    await minuteLater(MINUTE);
    await minuteLater(HOUR);
    expect(await uncheckedAlerts()).toHaveLength(1);
    expect((await systemPosts()).filter((p) => p.includes('не проверен'))).toHaveLength(1);
  });
});
