import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { credits, eq, fragrances, isNull, orders, outbox, receipts, sql, staff } from '@lummi/db';
import { Queue } from 'bullmq';
import { formatMoney, formatPhone } from '@lummi/i18n';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import type { ReceiptJudgeInput, ReceiptJudgement } from '../src/edges';
import { SettingsService } from '../src/settings/settings.service';
import type { SentMessage } from './fakes';
import { orderBody, samarkandPoint, shopper, whileLockedUntil } from './harness/orders';
import { recordCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): a receipt held for a person reaches the orders group (#51, TZ §4 «При ручной
 * проверке в группу заказов приходят чек, найденные поступления и причина», TZ §6 «Оплата
 * подтверждена» / «Чек не принят»). Receipts go in over HTTP, credits through the userbot's
 * endpoint, the judge is the fake, and the worker posts to the fake Telegram.
 */

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const GROUP = -1001234567890;
const ORDERS_TOPIC = 7;
const SYSTEM_TOPIC = 10;

let t: TestApp;
let checks: Queue;
beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
  checks = new Queue(t.env.RECEIPT_CHECKS_QUEUE, { connection: { url: t.env.REDIS_URL } });
});
afterAll(async () => {
  await checks.close();
  await t.close();
});
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-09T10:00:30Z'));
  t.edges.receiptJudge.calls.length = 0;
  t.edges.receiptJudge.respond = () => unsure;
  t.edges.telegram.releaseHeld();
  await t.reset();
  t.edges.telegram.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  const config = t.app.get(SettingsService);
  await config.set('bot.groupChatId', GROUP, { type: 'system' });
  await config.set(
    'bot.topics',
    { orders: ORDERS_TOPIC, payments: 8, reviews: 9, system: SYSTEM_TOPIC },
    { type: 'system' },
  );
});
afterEach(() => settled());

const ali: TestUser = {
  id: 41,
  first_name: 'Ali',
  last_name: 'Valiyev',
  username: 'ali_v',
  language_code: 'ru',
};
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** The judge's answer when a predicate falls short: not confirmed, so a person decides. */
const unsure: ReceiptJudgement = {
  isReceipt: 0.97,
  amountMatches: 0.95,
  recipientMatches: 0.42,
  chosenCreditId: null,
  choiceConfidence: 0.5,
  confirmed: false,
  provider: 'typesafe',
  reason: 'typesafe: below threshold',
};

/** One 10 ml bottle ordered by a shopper; the order as stored and the shopper's session token. */
async function placeOrder(user: TestUser = ali, phone = '998901234567') {
  const { token } = await t.signIn(user);
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
  return { order: order!, token };
}
type Placed = Awaited<ReturnType<typeof placeOrder>>;

/** `POST /orders/:number/receipts` as the Mini App sends it; the new receipt's id. */
async function upload(p: Placed, file?: Buffer): Promise<number> {
  const res = await fetch(`${t.baseUrl}/orders/${p.order.number}/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${p.token}` },
    body: file ?? (await uniqueReceiptImage()),
  });
  if (res.status !== 201) throw new Error(`upload ${res.status}`);
  return ((await res.json()) as { receipt: { id: number } }).receipt.id;
}

const receiptNow = async (id: number) =>
  (await t.db.select().from(receipts).where(eq(receipts.id, id)))[0]!;

/** Nothing of the matching or the outbox still to run. */
async function settled() {
  await vi.waitFor(
    async () => {
      expect(await t.db.select().from(credits).where(isNull(credits.eventHandledAt))).toEqual([]);
      const counts = await checks.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
      const { rows } = await t.db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${outbox} where sent_at is null and failed_at is null`,
      );
      expect(rows[0]!.n).toBe(0);
    },
    { timeout: 15_000, interval: 50 },
  );
}

/** What the orders group shows: every message the bot sent there, as Telegram holds it now. */
const groupMessages = () =>
  [...t.edges.telegram.messages.values()].filter((m) => m.chatId === GROUP);
const postsOf = (number: number) =>
  groupMessages().filter(
    (m) => !m.photo && m.plain.startsWith(`Ручная проверка: заказ № ${number}`),
  );

/** Waits until the order's manual-review post shows `expected`; there is only ever one. */
async function post(number: number, expected?: (m: SentMessage) => boolean): Promise<SentMessage> {
  let found: SentMessage | undefined;
  await vi.waitFor(
    () => {
      const posts = postsOf(number);
      expect(posts).toHaveLength(1);
      found = posts[0];
      if (expected) expect(expected(found!)).toBe(true);
    },
    { timeout: 15_000 },
  );
  return found!;
}

function buttons(m: SentMessage) {
  const markup = (m.options?.reply_markup ?? {}) as {
    inline_keyboard?: { text: string; callback_data: string }[][];
  };
  return (markup.inline_keyboard ?? []).flat();
}

const money = (n: number) => formatMoney(n, 'ru');
const MIN = 60_000;

describe('a receipt held for a person is posted to «Заказы»', () => {
  it('the receipt, the order, its Candidate credits and the reason, with the two buttons; once per hold', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.clock.advance(MIN);
    await recordCredit(t, { som: placed.order.amountDue });

    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    const p = await post(placed.order.number);
    expect(p.threadId).toBe(ORDERS_TOPIC);
    expect(p.options?.parse_mode).toBe('HTML');
    const phone = formatPhone('+998901234567');
    expect(p.plain.split('\n')).toEqual([
      `Ручная проверка: заказ № ${placed.order.number}`,
      'Причина: ИИ не уверен',
      `К оплате: ${money(placed.order.amountDue)}`,
      `Покупатель: Ali Valiyev · @ali_v · ${phone}`,
      'Чек от 9 ноября, 15:00: ответом на это сообщение',
      '',
      'Найденные поступления:',
      `• ${money(placed.order.amountDue)} · 9 ноября, 15:01 · HUMOCARD *1234 · CLICK P2P HUMO2UZCAR`,
      '',
      'Сверьте чек с поступлением и нажмите «Оплата подтверждена» или «Чек не принят».',
    ]);
    expect(p.text).toContain(`<a href="tg://user?id=${ali.id}">Ali Valiyev</a>`);
    expect(buttons(p).map((b) => b.text)).toEqual(['✅ Оплата подтверждена', '⛔ Чек не принят']);
    for (const b of buttons(p)) {
      expect(b.callback_data).toMatch(/^mr:/);
      expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }

    // the receipt: the normalised image, as a reply to the post
    await vi.waitFor(() => expect(groupMessages().filter((m) => m.photo)).toHaveLength(1), {
      timeout: 15_000,
    });
    const photo = groupMessages().find((m) => m.photo)!;
    expect(photo.threadId).toBe(ORDERS_TOPIC);
    expect(photo.options?.reply_parameters).toMatchObject({ message_id: p.messageId });
    const receipt = await receiptNow(receiptId);
    expect(photo.photo).toEqual({ bytes: await t.edges.files.get(receipt.normalizedKey) });

    // a second candidate: the AI is asked again and stays unsure; the same post shows both, each
    // button with what tells them apart: the amount, the time and who sent it
    t.edges.clock.advance(MIN);
    await recordCredit(t, { som: placed.order.amountDue, source: 'PAYME P2P UZCARD NA' });
    // the post is edited twice: with the new credit, then with the AI's new answer; wait for both
    const both = await post(
      placed.order.number,
      (m) => m.plain.includes('15:02') && m.plain.includes('несколько поступлений'),
    );
    expect(t.edges.receiptJudge.calls).toHaveLength(2);
    expect(both.plain).toContain('Причина: несколько поступлений, ИИ не уверен');
    const due = money(placed.order.amountDue);
    expect(buttons(both).map((b) => b.text)).toEqual([
      `✅ ${due} · 15:01 · CLICK P2P`,
      `✅ ${due} · 15:02 · PAYME P2P`,
      '⛔ Чек не принят',
    ]);
    await settled();
    expect(postsOf(placed.order.number)).toHaveLength(1);
    expect(groupMessages().filter((m) => m.photo)).toHaveLength(1);
  });
});

const dilnoza = { id: 900011, first_name: 'Dilnoza' };
const outsider = { id: 555, first_name: 'Stranger' };

async function addStaff(user: { id: number; first_name: string }, active = true) {
  const [row] = await t.db
    .insert(staff)
    .values({ telegramId: user.id, name: user.first_name, role: 'manager', active })
    .returning();
  return row!;
}

let updateId = 9000;
const botUser = { id: 123456, is_bot: true, first_name: 'Test', username: 'lummi_test_bot' };

/** A tap on one of the post's buttons, as Telegram delivers it to the webhook; its toast. */
async function press(user: { id: number; first_name: string }, text: string, on: SentMessage) {
  const button = buttons(on).find((b) => b.text === text);
  if (!button)
    throw new Error(
      `no «${text}» under the post: ${buttons(on)
        .map((b) => b.text)
        .join(', ')}`,
    );
  return tap(user, button.callback_data, on);
}

async function tap(user: { id: number; first_name: string }, data: string, on: SentMessage) {
  const id = ++updateId;
  const res = await t.postUpdate({
    update_id: id,
    callback_query: {
      id: `cb-${id}`,
      from: { id: user.id, is_bot: false, first_name: user.first_name, language_code: 'ru' },
      chat_instance: 'group',
      data,
      message: {
        message_id: on.messageId,
        message_thread_id: ORDERS_TOPIC,
        date: 1_700_000_000,
        chat: { id: GROUP, type: 'supergroup', title: 'Lummi', is_forum: true },
        from: botUser,
        text: on.plain,
      },
    },
  });
  expect(res.status).toBe(200);
  return t.edges.telegram.answers.find((a) => a.id === `cb-${id}`)?.text;
}

/** An order whose receipt the AI was unsure about, with one Candidate credit: its post. */
async function heldOrder(user: TestUser = ali, phone = '998901234567') {
  const placed = await placeOrder(user, phone);
  const receiptId = await upload(placed);
  t.edges.clock.advance(MIN);
  const creditId = await recordCredit(t, { som: placed.order.amountDue });
  const p = await post(placed.order.number, (m) => buttons(m).length > 0);
  await settled();
  return { ...placed, receiptId, creditId, post: p };
}

const hasButtons =
  (...texts: string[]) =>
  (m: SentMessage) =>
    JSON.stringify(buttons(m).map((b) => b.text)) === JSON.stringify(texts);

const orderNow = async (id: number) =>
  (await t.db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe('the buttons on the post', () => {
  it('«Оплата подтверждена» asks once more, then links the Candidate credit through the door as the staff member', async () => {
    await addStaff(dilnoza);
    const held = await heldOrder();
    const number = held.order.number;

    expect(await press(dilnoza, '✅ Оплата подтверждена', held.post)).toBeUndefined();
    const asking = await post(number, hasButtons('Да, оплата подтверждена', '‹ Назад'));
    // the whole credit: amount, time, who sent it, card
    expect(asking.plain.split('\n').slice(-2)).toEqual([
      'Подтвердить оплату этим поступлением?',
      `${money(held.order.amountDue)} · 9 ноября, 15:01 · 📍 CLICK P2P HUMO2UZCAR · HUMOCARD *1234`,
    ]);
    // «Назад» brings the choices back; nothing was decided
    await press(dilnoza, '‹ Назад', asking);
    const again = await post(number, hasButtons('✅ Оплата подтверждена', '⛔ Чек не принят'));
    expect((await orderNow(held.order.id)).status).toBe('receipt_review');

    await press(dilnoza, '✅ Оплата подтверждена', again);
    const sure = await post(number, hasButtons('Да, оплата подтверждена', '‹ Назад'));
    t.edges.clock.advance(MIN);
    expect(await press(dilnoza, 'Да, оплата подтверждена', sure)).toBeUndefined();

    const order = await orderNow(held.order.id);
    expect(order.status).toBe('payment_confirmed');
    expect(order.creditId).toBe(held.creditId);
    expect((await receiptNow(held.receiptId)).verdict).toBe('manager_confirmed');
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items).toMatchObject([
      {
        actorType: 'staff',
        actorName: 'Dilnoza',
        targetId: String(held.order.id),
        payload: { creditId: held.creditId, receiptId: held.receiptId },
      },
    ]);

    // the post says who decided and with what money, and has no buttons left
    const decided = await post(number, (m) => buttons(m).length === 0);
    expect(decided.plain.split('\n').slice(-3)).toEqual([
      '',
      '💳 Оплата подтверждена — Dilnoza, 9 ноября, 15:02',
      `Поступление: ${money(held.order.amountDue)} · 9 ноября, 15:01 · HUMOCARD *1234`,
    ]);
    // and the order's card opens in «Заказы», as for any confirmed payment
    await vi.waitFor(
      () =>
        expect(
          groupMessages().some((m) =>
            m.plain.startsWith(`Заказ № ${number} · Оплата подтверждена`),
          ),
        ).toBe(true),
      { timeout: 15_000 },
    );
  });

  it('of several candidates, the one pressed is the one linked', async () => {
    await addStaff(dilnoza);
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    t.edges.clock.advance(MIN);
    const first = await recordCredit(t, { som: placed.order.amountDue });
    t.edges.clock.advance(MIN);
    const second = await recordCredit(t, {
      som: placed.order.amountDue,
      source: 'PAYME P2P UZCARD NA',
    });
    const due = money(placed.order.amountDue);
    const p = await post(placed.order.number, (m) => buttons(m).length === 3);
    await settled();

    await press(dilnoza, `✅ ${due} · 15:02 · PAYME P2P`, p);
    const sure = await post(placed.order.number, hasButtons('Да, оплата подтверждена', '‹ Назад'));
    expect(sure.plain.split('\n').at(-1)).toBe(
      `${due} · 9 ноября, 15:02 · 📍 PAYME P2P UZCARD NA · HUMOCARD *1234`,
    );
    await press(dilnoza, 'Да, оплата подтверждена', sure);

    expect((await orderNow(placed.order.id)).creditId).toBe(second);
    expect((await receiptNow(receiptId)).verdict).toBe('manager_confirmed');
    const stillFree = await t.db.select().from(orders).where(eq(orders.creditId, first));
    expect(stillFree).toEqual([]);
  });

  it('a forged «Да» from staff with a credit that is taken or does not fit changes nothing', async () => {
    await addStaff(dilnoza);
    const held = await heldOrder();
    const other = await heldOrder(vali, '998907654321');
    expect(other.order.amountDue).toBe(held.order.amountDue);
    // another amount: never a candidate; the door wants a reason, which only the admin takes
    const misfit = await recordCredit(t, { som: held.order.amountDue + 1000 });
    expect(await tap(dilnoza, `mr:y:${held.receiptId}:${misfit}`, held.post)).toBe(
      'Это поступление не подходит заказу: привяжите его в админке, с причиной',
    );
    // the other order took this one's candidate (the admin linked it there)
    const manager = await t.managerSession();
    const taken = await manager.client.admin.orders.confirmPayment({
      params: { number: other.order.number },
      body: { creditId: held.creditId, receiptId: other.receiptId },
    });
    expect(taken.status).toBe(200);
    expect(await tap(dilnoza, `mr:y:${held.receiptId}:${held.creditId}`, held.post)).toBe(
      'Это поступление уже не свободно: оно оплатило другой заказ или его отметили «Не для заказа»',
    );
    expect(await orderNow(held.order.id)).toMatchObject({
      status: 'receipt_review',
      creditId: null,
    });
    expect((await receiptNow(held.receiptId)).verdict).toBe('manual_review');
  });

  it("«Чек не принят» needs a reason: the admin dialog's presets, then a confirmation; the shopper reads why", async () => {
    await addStaff(dilnoza);
    const held = await heldOrder();
    const number = held.order.number;

    await press(dilnoza, '⛔ Чек не принят', held.post);
    const reasons = await post(number, (m) => buttons(m).length > 2);
    expect(buttons(reasons).map((b) => b.text)).toEqual([
      'Сумма не совпадает',
      'Не на карту магазина',
      'Перевод не поступил',
      'Чек не читается',
      'Это не чек',
      '‹ Назад',
    ]);
    expect(reasons.plain).toContain('Чек не принят: выберите причину.');
    // «Другая причина» needs the manager's own words: the admin only; a forged one is refused
    const forged = buttons(reasons)[0]!.callback_data.replace('amount_mismatch', 'other');
    expect(await tap(dilnoza, forged, reasons)).toBe('Нельзя');

    await press(dilnoza, 'Сумма не совпадает', reasons);
    const sure = await post(number, hasButtons('Да, чек не принят: Сумма не совпадает', '‹ Назад'));
    expect(sure.plain).toContain('Чек не принят? Причина: Сумма не совпадает.');
    expect((await orderNow(held.order.id)).status).toBe('receipt_review');
    t.edges.clock.advance(MIN);
    expect(await press(dilnoza, 'Да, чек не принят: Сумма не совпадает', sure)).toBeUndefined();

    expect((await orderNow(held.order.id)).status).toBe('awaiting_payment');
    expect((await orderNow(held.order.id)).creditId).toBeNull();
    expect((await receiptNow(held.receiptId)).verdict).toBe('rejected');
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.receipt_rejected' },
    });
    expect(audit.status === 200 && audit.body.items).toMatchObject([
      { actorType: 'staff', actorName: 'Dilnoza', targetId: String(held.order.id) },
    ]);
    const decided = await post(number, (m) => buttons(m).length === 0);
    expect(decided.plain.split('\n').at(-1)).toBe(
      '⛔ Чек не принят — Dilnoza, 9 ноября, 15:02: Сумма не совпадает',
    );
    // the shopper reads the reason in their language and may upload again
    await vi.waitFor(
      () =>
        expect(
          [...t.edges.telegram.messages.values()].some(
            (m) =>
              m.chatId === ali.id &&
              m.plain.includes(`№ ${number}`) &&
              m.plain.includes('не принят'),
          ),
        ).toBe(true),
      { timeout: 15_000 },
    );
  });

  it('only active staff may press: anyone else is refused and nothing changes', async () => {
    await addStaff({ id: 900012, first_name: 'Former' }, false);
    const held = await heldOrder();

    expect(await press(outsider, '✅ Оплата подтверждена', held.post)).toBe(
      'Нет доступа. Если вы сотрудник, привяжите Telegram в админке: Профиль → «Привязать Telegram».',
    );
    expect(await press({ id: 900012, first_name: 'Former' }, '⛔ Чек не принят', held.post)).toBe(
      'Нет доступа',
    );
    // a forged «yes» straight away is refused just the same
    const yes = `mr:y:${held.receiptId}:${held.creditId}`;
    expect(await tap(outsider, yes, held.post)).toMatch(/^Нет доступа/);
    await settled();
    expect((await orderNow(held.order.id)).status).toBe('receipt_review');
    expect((await receiptNow(held.receiptId)).verdict).toBe('manual_review');
    expect(postsOf(held.order.number)[0]!.edits).toBe(0);
  });

  it('a decision made in the admin updates the post and takes its buttons; an old button is «Уже изменено»', async () => {
    await addStaff(dilnoza);
    const held = await heldOrder();
    const manager = await t.managerSession();
    t.edges.clock.advance(MIN);
    const res = await manager.client.admin.orders.confirmPayment({
      params: { number: held.order.number },
      body: { creditId: held.creditId, receiptId: held.receiptId },
    });
    expect(res.status).toBe(200);

    const decided = await post(held.order.number, (m) => buttons(m).length === 0);
    expect(decided.plain).toContain('💳 Оплата подтверждена — Manager, 9 ноября, 15:02');
    expect(await press(dilnoza, '✅ Оплата подтверждена', held.post)).toBe('Уже изменено');
    expect(await tap(dilnoza, `mr:y:${held.receiptId}:${held.creditId}`, held.post)).toBe(
      'Уже изменено',
    );
    await settled();
    expect(buttons(postsOf(held.order.number)[0]!)).toEqual([]);
  });

  it('the AI confirming later (a new candidate arrived) updates the post too', async () => {
    const held = await heldOrder();
    t.edges.receiptJudge.respond = (input: ReceiptJudgeInput) => ({
      ...unsure,
      recipientMatches: 0.93,
      chosenCreditId: input.candidates.at(-1)!.creditId,
      choiceConfidence: 0.8,
      confirmed: true,
      reason: undefined,
    });
    t.edges.clock.advance(MIN);
    const own = await recordCredit(t, { som: held.order.amountDue });

    const decided = await post(held.order.number, (m) => buttons(m).length === 0);
    expect(decided.plain.split('\n').slice(-2)).toEqual([
      '💳 Оплата подтверждена — ИИ, 9 ноября, 15:02',
      `Поступление: ${money(held.order.amountDue)} · 9 ноября, 15:02 · HUMOCARD *1234`,
    ]);
    expect((await orderNow(held.order.id)).creditId).toBe(own);
  });

  it("the group and the admin confirming at once: the door's lock order lets one through, the other hears it changed", async () => {
    await addStaff(dilnoza);
    const held = await heldOrder();
    const manager = await t.managerSession();
    await press(dilnoza, '✅ Оплата подтверждена', held.post);
    const sure = await post(held.order.number, hasButtons('Да, оплата подтверждена', '‹ Назад'));

    const [toast, admin] = await whileLockedUntil(t, 'orders', 2, () =>
      Promise.all([
        press(dilnoza, 'Да, оплата подтверждена', sure),
        manager.client.admin.orders.confirmPayment({
          params: { number: held.order.number },
          body: { creditId: held.creditId, receiptId: held.receiptId },
        }),
      ]),
    );
    // exactly one confirmation: either the group's (no toast, the admin 409) or the admin's
    expect([toast === undefined, admin.status === 200].filter(Boolean)).toHaveLength(1);
    if (toast === undefined)
      expect(admin).toMatchObject({ status: 409, body: { code: 'status_changed' } });
    else expect(toast).toBe('Уже изменено');
    expect((await orderNow(held.order.id)).creditId).toBe(held.creditId);
    const owner = await t.ownerSession();
    const audit = await owner.client.admin.audit.list({
      query: { action: 'order.payment_confirmed' },
    });
    expect(audit.status === 200 && audit.body.items).toHaveLength(1);
    await post(held.order.number, (m) => buttons(m).length === 0);
  });
});

describe('a duplicate receipt held for a person', () => {
  it('reads «повторный чек»; with no credit, only «Чек не принят» and a pointer to the admin', async () => {
    const first = await placeOrder();
    const second = await placeOrder(vali, '998907654321');
    const file = await uniqueReceiptImage();
    const firstReceipt = await upload(first, file);
    await upload(second, file);

    await vi.waitFor(
      async () => expect((await receiptNow(firstReceipt)).verdict).toBe('manual_review'),
      { timeout: 15_000 },
    );
    const p = await post(first.order.number);
    expect(p.plain.split('\n').slice(1, 2)).toEqual([
      'Причина: повторный чек (такой же чек уже был у другого заказа)',
    ]);
    expect(p.plain).toContain(
      `Нет поступления: ${money(first.order.amountDue)} на карту магазина после оформления заказа не приходило.`,
    );
    expect(p.plain.split('\n').at(-1)).toBe(
      'Подтвердить оплату другим поступлением можно в админке, с причиной. Или нажмите «Чек не принят».',
    );
    expect(buttons(p).map((b) => b.text)).toEqual(['⛔ Чек не принят']);
    // the repeat itself is «оплата не найдена» at once (#36): never a manual-review post
    await settled();
    expect(postsOf(second.order.number)).toEqual([]);

    // the money arrives later: the AI is never asked about a duplicate, but the post shows the
    // credit, and staff may confirm with it
    await addStaff(dilnoza);
    t.edges.clock.advance(MIN);
    const creditId = await recordCredit(t, { som: first.order.amountDue });
    const withCredit = await post(
      first.order.number,
      hasButtons('✅ Оплата подтверждена', '⛔ Чек не принят'),
    );
    expect(withCredit.plain).toContain(
      `• ${money(first.order.amountDue)} · 9 ноября, 15:01 · HUMOCARD *1234 · CLICK P2P HUMO2UZCAR`,
    );
    expect(t.edges.receiptJudge.calls).toHaveLength(0);
    await press(dilnoza, '✅ Оплата подтверждена', withCredit);
    await press(
      dilnoza,
      'Да, оплата подтверждена',
      await post(first.order.number, hasButtons('Да, оплата подтверждена', '‹ Назад')),
    );
    expect((await orderNow(first.order.id)).creditId).toBe(creditId);
  });
});

describe('the reason and the credit the AI chose', () => {
  it('«сумма не совпала» when the AI said the amount is not the one due; its choice is named', async () => {
    t.edges.receiptJudge.respond = (input: ReceiptJudgeInput) => ({
      ...unsure,
      amountMatches: 0.31,
      recipientMatches: 0.93,
      chosenCreditId: input.candidates[0]!.creditId,
    });
    const held = await heldOrder();
    expect(held.post.plain.split('\n')[1]).toBe('Причина: сумма не совпала');
    expect(held.post.plain).toContain(
      `• ${money(held.order.amountDue)} · 9 ноября, 15:01 · HUMOCARD *1234 · CLICK P2P HUMO2UZCAR (выбор ИИ)`,
    );
  });

  it('a credit marked «Не для заказа» while the AI answered: the post names it and who marked it', async () => {
    const placed = await placeOrder();
    const receiptId = await upload(placed);
    let release!: () => void;
    const answering = new Promise<void>((r) => (release = r));
    t.edges.receiptJudge.respond = async (input: ReceiptJudgeInput) => {
      await answering;
      return {
        ...unsure,
        recipientMatches: 0.93,
        chosenCreditId: input.candidates.at(-1)!.creditId,
        choiceConfidence: 0.8,
        confirmed: true,
        reason: undefined,
      };
    };
    t.edges.clock.advance(MIN);
    const creditId = await recordCredit(t, { som: placed.order.amountDue });
    await vi.waitFor(() => expect(t.edges.receiptJudge.calls).toHaveLength(1), {
      timeout: 15_000,
    });
    const manager = await t.managerSession();
    t.edges.clock.advance(MIN);
    const marked = await manager.client.admin.credits.markNotForOrder({
      params: { id: creditId },
      body: {},
    });
    expect(marked.status).toBe(200);
    release();

    await vi.waitFor(
      async () => expect((await receiptNow(receiptId)).reviewReason).toBe('credit_marked'),
      { timeout: 15_000 },
    );
    const p = await post(placed.order.number);
    const lines = p.plain.split('\n');
    expect(lines[1]).toBe(
      'Причина: ИИ подтвердил чек поступлением, которое отметили «Не для заказа»',
    );
    expect(lines.slice(6, 8)).toEqual([
      `ИИ выбрал поступление ${money(placed.order.amountDue)} · 9 ноября, 15:01 · HUMOCARD *1234 · CLICK P2P HUMO2UZCAR, но его отметили «Не для заказа»: Manager, 9 ноября, 15:02.`,
      'Других подходящих поступлений нет.',
    ]);
    expect(p.plain).not.toContain('Нет поступления');
  });
});
