import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  asc,
  btsPoints,
  eq,
  orderCards,
  fragrances,
  orderLines,
  orders,
  outbox,
  receipts,
  regions,
  settings,
  staff,
  volumes,
} from '@lummi/db';
import { fill, formatMoney, formatPhone } from '@lummi/i18n';
import { botMessages, orderCancelledText } from '@lummi/i18n/bot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { OrderCards } from '../src/orders-group/order-cards';
import { PaymentConfirmation } from '../src/payment/payment-confirmation';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { SettingsService } from '../src/settings/settings.service';
import { WorkerRuntime } from '../src/worker/runtime';
import { plainText, type SentMessage } from './fakes';
import { payWithCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, TEST_MINIAPP_URL, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

/** The orders group (a supergroup with topics) and its «Заказы» topic, as the owner sets them. */
const GROUP = -1001234567890;
const ORDERS_TOPIC = 7;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  t.edges.telegram.reset();
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  const config = t.app.get(SettingsService);
  await config.set('bot.groupChatId', GROUP, { type: 'system' });
  await config.set(
    'bot.topics',
    { orders: ORDERS_TOPIC, payments: 8, reviews: 9, system: 10 },
    { type: 'system' },
  );
});

const ali: TestUser = {
  id: 41,
  first_name: 'Ali',
  last_name: 'Valiyev',
  username: 'ali_v',
  language_code: 'ru',
};
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const dilnoza = { id: 900002, first_name: 'Dilnoza' };
const bekzod = { id: 900003, first_name: 'Bekzod' };
const outsider = { id: 555, first_name: 'Stranger' };

async function addStaff(user: { id: number; first_name: string }, active = true) {
  const [row] = await t.db
    .insert(staff)
    .values({ telegramId: user.id, name: user.first_name, role: 'manager', active })
    .returning();
  return row!;
}

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

async function samarkand() {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  return { region: region!, point: point! };
}

interface OrderOptions {
  qty?: number;
  comment?: string;
  giftMessage?: string;
}

/** One fragrance's 10 ml in the cart, ordered to a Samarkand point; returns the order row. */
async function placeOrder(client: Client, opts: OrderOptions = {}) {
  const [f] = await t.db
    .select({ slug: fragrances.slug })
    .from(fragrances)
    .orderBy(asc(fragrances.slug))
    .limit(1);
  const add = await client.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: opts.qty ?? 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  const { region, point } = await samarkand();
  const checkout = await client.checkout.get({ query: { regionId: region.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const body: CreateOrderBody = {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
    ...(opts.comment ? { comment: opts.comment } : {}),
    ...(opts.giftMessage !== undefined ? { gift: true, giftMessage: opts.giftMessage } : {}),
  };
  const res = await client.orders.create({ body });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return orderRow(res.body.number);
}

async function orderRow(number: number) {
  const [o] = await t.db.select().from(orders).where(eq(orders.number, number));
  return o!;
}

/** The shopper sends a receipt and the receipt AI confirms it with the credit (#28, #32). */
async function pay(order: { id: number; number: number; customerId: number; amountDue: number }) {
  const sent = await t.app
    .get(ReceiptsService)
    .submit(order.customerId, order.number, await uniqueReceiptImage(), {
      fileName: null,
      source: 'miniapp',
    });
  if (sent.kind !== 'submitted') throw new Error(`submit: ${sent.kind}`);
  await payWithCredit(t, order, sent.receipt.id);
  const [row] = await t.db.select().from(receipts).where(eq(receipts.id, sent.receipt.id));
  return row!;
}

/** What the orders group shows: every message the bot sent there, as Telegram holds it now. */
const groupMessages = () =>
  [...t.edges.telegram.messages.values()].filter((m) => m.chatId === GROUP);
/** The order's card, once posted: the group message whose first line names the order. */
const cardOf = (number: number) =>
  groupMessages().find((m) => !m.photo && m.plain.startsWith(`Заказ № ${number} `));

/** Waits until the card shows `expected` (the worker posts and edits it). */
async function card(number: number, expected?: (text: string) => boolean): Promise<SentMessage> {
  let found: SentMessage | undefined;
  await vi.waitFor(
    () => {
      found = cardOf(number);
      expect(found).toBeDefined();
      if (expected) expect(expected(found!.plain)).toBe(true);
    },
    { timeout: 10_000 },
  );
  return found!;
}

/** The buttons under a message, as Telegram would echo their callback data. */
function buttons(m: SentMessage) {
  const markup = (m.options?.reply_markup ?? {}) as {
    inline_keyboard?: { text: string; callback_data: string }[][];
  };
  return (markup.inline_keyboard ?? []).flat();
}

const MIN = 60_000;
const statusOf = async (number: number) => (await orderRow(number)).status;

/** A paid order with its card posted, ready for the group's buttons. */
async function paidOrder(user: TestUser = ali, opts: OrderOptions = {}, phone = '998901234567') {
  const client = await shopper(user, phone);
  const order = await placeOrder(client, opts);
  await pay(order);
  await card(order.number);
  return order;
}

let updateId = 7000;
const botUser = { id: 123456, is_bot: true, first_name: 'Test', username: 'lummi_test_bot' };
const groupChat = { id: GROUP, type: 'supergroup', title: 'Lummi', is_forum: true };
const from = (u: { id: number; first_name: string }) => ({
  id: u.id,
  is_bot: false,
  first_name: u.first_name,
  language_code: 'ru',
});

/** A tap on one of the card's buttons, as Telegram delivers it to the webhook. */
async function press(user: { id: number; first_name: string }, text: string, on: SentMessage) {
  const button = buttons(on).find((b) => b.text === text);
  if (!button)
    throw new Error(
      `no «${text}» under the card: ${buttons(on)
        .map((b) => b.text)
        .join(', ')}`,
    );
  const id = ++updateId;
  const res = await t.postUpdate({
    update_id: id,
    callback_query: {
      id: `cb-${id}`,
      from: from(user),
      chat_instance: 'group',
      data: button.callback_data,
      message: {
        message_id: on.messageId,
        message_thread_id: ORDERS_TOPIC,
        date: 1_700_000_000,
        chat: groupChat,
        from: botUser,
        text: on.plain,
      },
    },
  });
  expect(res.status).toBe(200);
  return {
    callbackId: `cb-${id}`,
    toast: () => t.edges.telegram.answers.find((a) => a.id === `cb-${id}`),
  };
}

/** A message in the group replying to `to` (a ForceReply question), as the webhook gets it. */
async function reply(
  user: { id: number; first_name: string },
  text: string,
  to: SentMessage,
  chatId = GROUP,
) {
  const chat = { ...groupChat, id: chatId };
  // a person answers once the question is in the chat, by which time the bot has recorded its
  // message id (the fake shows the message a moment before the outbox stamps it)
  await vi.waitFor(
    async () => {
      const [asked] = await t.db
        .select({ id: outbox.id })
        .from(outbox)
        .where(and(eq(outbox.chatId, chatId), eq(outbox.telegramMessageId, to.messageId)));
      expect(asked).toBeDefined();
    },
    { timeout: 10_000 },
  );
  const id = ++updateId;
  const res = await t.postUpdate({
    update_id: id,
    message: {
      message_id: 50_000 + id,
      message_thread_id: ORDERS_TOPIC,
      is_topic_message: true,
      date: 1_700_000_000,
      chat,
      from: from(user),
      text,
      reply_to_message: {
        message_id: to.messageId,
        message_thread_id: ORDERS_TOPIC,
        date: 1_700_000_000,
        chat,
        from: botUser,
        text: to.plain,
      },
    },
  });
  expect(res.status).toBe(200);
  return 50_000 + id;
}

/** What the shopper got from the bot, in order. */
const toShopper = (user: TestUser) =>
  [...t.edges.telegram.messages.values()].filter((m) => m.chatId === user.id);

/** Waits for a group message that `match` picks (a question, a reply), and returns it. */
async function groupMessage(match: (m: SentMessage) => boolean): Promise<SentMessage> {
  let found: SentMessage | undefined;
  await vi.waitFor(
    () => {
      found = groupMessages().find(match);
      expect(found).toBeDefined();
    },
    { timeout: 10_000 },
  );
  return found!;
}
const repliesTo = (messageId: number) => (m: SentMessage) =>
  (m.options?.reply_parameters as { message_id?: number } | undefined)?.message_id === messageId;

/** Waits until the card offers `button`. */
const cardWith = (number: number, button: string) =>
  card(number, () => buttons(cardOf(number)!).some((b) => b.text === button));

/** What a shopper sees as available for the order's first line's volume. */
async function availableOf(orderId: number) {
  const [line] = await t.db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const { client } = await t.signIn(ali);
  const res = await client.catalog.fragrance({ params: { slug: line!.slug! } });
  if (res.status !== 200) throw new Error(`fragrance ${res.status}`);
  return res.body.volumes.find((v) => v.ml === line!.ml)!.available;
}

/** On hand of the order's first line's volume. */
async function onHandOf(orderId: number) {
  const [line] = await t.db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const [v] = await t.db.select().from(volumes).where(eq(volumes.id, line!.volumeId!));
  return v!.onHand;
}

describe('the card in «Заказы» (spec Changes 2026-11-07)', () => {
  it('appears once the payment is confirmed: the order, where it goes, who it is for, its history, and the receipt as a reply', async () => {
    const client = await shopper();
    const order = await placeOrder(client, {
      comment: 'Позвоните <до> обеда & спасибо',
      giftMessage: 'С днём рождения, мама!',
    });
    // nothing in the group while the order waits for its money
    await t.app.get(WorkerRuntime).tick();
    expect(groupMessages()).toHaveLength(0);

    const receipt = await pay(order);
    const c = await card(order.number);

    expect(c.chatId).toBe(GROUP);
    expect(c.threadId).toBe(ORDERS_TOPIC);
    expect(c.options?.parse_mode).toBe('HTML');
    const { point } = await samarkand();
    const lines = c.plain.split('\n');
    expect(lines[0]).toBe(`Заказ № ${order.number} · Оплата подтверждена`);
    expect(c.plain).toContain(`× 1 — ${formatMoney(order.itemsSubtotal, 'ru')}`);
    expect(c.plain).toContain(`Доставка: ${formatMoney(order.deliveryFee, 'ru')}`);
    expect(c.plain).toContain(`Итого: ${formatMoney(order.total, 'ru')}`);
    expect(c.plain).toContain(point.code);
    expect(c.plain).toContain(point.address);
    const phone = formatPhone('+998901234567');
    expect(c.plain).toContain(`Получатель: Ali Valiyev, ${phone}`);
    expect(c.plain).toContain(`Покупатель: Ali Valiyev · @ali_v · ${phone}`);
    // the customer's name links to their Telegram account
    expect(c.text).toContain(`<a href="tg://user?id=${ali.id}">Ali Valiyev</a>`);
    // what the shopper typed is escaped, never markup
    expect(c.text).toContain('Позвоните &lt;до&gt; обеда &amp; спасибо');
    expect(c.plain).toContain('Комментарий: Позвоните <до> обеда & спасибо');
    expect(c.plain).toContain('🎁 Это подарок');
    expect(c.plain).toContain('Открытка: «С днём рождения, мама!»');
    expect(c.plain).toContain('История');
    expect(c.plain).toContain('💳 Оплата подтверждена — ИИ, 15:00');

    // only the next step and «Отменить»; the callback data carries the status the card showed
    expect(buttons(c).map((b) => b.text)).toEqual(['✅ Принят', 'Отменить']);
    for (const b of buttons(c)) {
      expect(b.callback_data).toMatch(/^ord:/);
      expect(b.callback_data).toContain('payment_confirmed');
      expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }

    // the receipt: the normalised image from private storage, as a reply to the card
    await vi.waitFor(() => expect(groupMessages().filter((m) => m.photo)).toHaveLength(1));
    const photo = groupMessages().find((m) => m.photo)!;
    expect(photo.threadId).toBe(ORDERS_TOPIC);
    expect(photo.options?.reply_parameters).toMatchObject({ message_id: c.messageId });
    expect(photo.photo).toEqual({ bytes: await t.edges.files.get(receipt.normalizedKey) });
    expect(photo.text).toBe(`Чек к заказу № ${order.number}`);
  });

  it('a staff member moves the order one step: the card is edited in place with who and when, and the shopper hears nothing for «Принят»', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const posted = await card(order.number);
    const heard = toShopper(ali).length;
    t.edges.clock.advance(5 * MIN);

    const p = await press(dilnoza, '✅ Принят', posted);
    expect(await statusOf(order.number)).toBe('accepted');
    // answered at once (the spinner stops), with no toast: the card says it
    expect(p.toast()).toEqual({ id: p.callbackId });

    const c = await card(order.number, (text) => text.includes('✅ Принят — Dilnoza, 15:05'));
    expect(c.messageId).toBe(posted.messageId);
    expect(c.edits).toBe(1);
    expect(c.plain.split('\n')[0]).toBe(`Заказ № ${order.number} · Принят`);
    expect(buttons(c).map((b) => b.text)).toEqual(['📦 Собирается', 'Отменить']);
    expect(buttons(c)[0]!.callback_data).toContain(':accepted');
    // one card, edited; nothing new in the group, nothing to the shopper
    expect(groupMessages().filter((m) => !m.photo)).toHaveLength(1);
    expect(toShopper(ali)).toHaveLength(heard);
  });

  it('a second press on a card that moved on answers «Уже изменено» and changes nothing', async () => {
    await addStaff(dilnoza);
    await addStaff(bekzod);
    const order = await paidOrder();
    const stale = await card(order.number);

    await press(dilnoza, '✅ Принят', stale);
    // Bekzod's screen still shows the card as it was: same button, same expected status
    const second = await press(bekzod, '✅ Принят', stale);
    expect(second.toast()?.text).toBe('Уже изменено');
    expect(await statusOf(order.number)).toBe('accepted');

    const c = await card(order.number, (text) => text.includes('Принят — Dilnoza'));
    expect(c.plain.match(/✅ Принят —/g)).toHaveLength(1);
    expect(c.plain).not.toContain('Bekzod');
    expect(buttons(c).map((b) => b.text)).toEqual(['📦 Собирается', 'Отменить']);
  });

  it('anyone not on staff, or no longer active, gets «Нет доступа»', async () => {
    await addStaff(bekzod, false);
    const order = await paidOrder();
    const c = await card(order.number);

    for (const user of [outsider, bekzod]) {
      expect((await press(user, '✅ Принят', c)).toast()?.text).toBe('Нет доступа');
      expect((await press(user, 'Отменить', c)).toast()?.text).toBe('Нет доступа');
    }
    expect(await statusOf(order.number)).toBe('payment_confirmed');
    await t.app.get(WorkerRuntime).tick();
    expect(cardOf(order.number)!.edits).toBe(0);
  });

  it('«Передан в BTS» asks the presser for the tracking number; only their valid answer hands the order over', async () => {
    await addStaff(dilnoza);
    await addStaff(bekzod);
    const order = await paidOrder();
    await press(dilnoza, '✅ Принят', await card(order.number));
    await press(dilnoza, '📦 Собирается', await cardWith(order.number, '📦 Собирается'));
    const c = await cardWith(order.number, '🚚 Передан в BTS');
    const onHand = await onHandOf(order.id);

    const p = await press(dilnoza, '🚚 Передан в BTS', c);
    expect(p.toast()?.text).toBe('Ответьте трек-номером на сообщение бота');
    expect(await statusOf(order.number)).toBe('assembling');
    const question = await groupMessage((m) => m.plain.includes('введите трек-номер BTS'));
    expect(question.plain).toBe(
      `Dilnoza, введите трек-номер BTS для заказа № ${order.number} ответом на это сообщение.`,
    );
    // ForceReply aimed at Dilnoza (mentioned), under the card, in the «Заказы» topic
    expect(question.text).toContain(`<a href="tg://user?id=${dilnoza.id}">Dilnoza</a>`);
    expect(question.options?.reply_markup).toMatchObject({ force_reply: true, selective: true });
    expect(question.options?.reply_parameters).toMatchObject({ message_id: c.messageId });
    expect(question.threadId).toBe(ORDERS_TOPIC);

    // Bekzod answers Dilnoza's question: it is not his to answer
    const fromBekzod = await reply(bekzod, 'BTS123456', question);
    const notYours = await groupMessage(repliesTo(fromBekzod));
    expect(notYours.plain).toBe(
      `Трек-номер для заказа № ${order.number} ждём от Dilnoza. Чтобы ввести его самим, нажмите «Передан в BTS» на карточке.`,
    );
    expect(await statusOf(order.number)).toBe('assembling');

    // Dilnoza slips: too short for the shared rule (6–64), so the bot asks again
    const tooShort = await reply(dilnoza, '  12  ', question);
    const again = await groupMessage(repliesTo(tooShort));
    expect(again.plain).toBe(
      'Трек-номер — от 6 до 64 символов. Ответьте на это сообщение ещё раз.',
    );
    expect(again.options?.reply_markup).toMatchObject({ force_reply: true, selective: true });
    expect(await statusOf(order.number)).toBe('assembling');
    expect(await onHandOf(order.id)).toBe(onHand);

    // the first question stopped counting when the bot asked again
    const toFirst = await reply(dilnoza, 'BTS 1111 2222', question);
    expect((await groupMessage(repliesTo(toFirst))).plain).toBe(
      `Этот вопрос по заказу № ${order.number} уже не действует: ответьте на последний вопрос бота.`,
    );
    expect(await statusOf(order.number)).toBe('assembling');

    // the good number, to the new question: trimmed, saved, and the bottle leaves the shelf
    t.edges.clock.advance(30 * MIN);
    await reply(dilnoza, '  BTS 4471 0098  ', again);
    expect(await statusOf(order.number)).toBe('handed_to_bts');
    expect((await orderRow(order.number)).trackingNumber).toBe('BTS 4471 0098');
    expect(await onHandOf(order.id)).toBe(onHand - 1);

    const shown = await cardWith(order.number, '🏁 Доставлен');
    expect(shown.plain).toContain('Трек-номер: BTS 4471 0098');
    expect(shown.plain).toContain('🚚 Передан в BTS — Dilnoza, 15:30: BTS 4471 0098');
    expect(buttons(shown).map((b) => b.text)).toEqual(['🏁 Доставлен', 'Отменить']);

    // the shopper gets the tracking number, with «Открыть заказ»
    await vi.waitFor(() =>
      expect(toShopper(ali).at(-1)?.text).toBe(
        fill(botMessages.ru.bot.handedToBts, {
          number: String(order.number),
          tracking: 'BTS 4471 0098',
        }),
      ),
    );
    expect(toShopper(ali).at(-1)?.options?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Открыть заказ', web_app: { url: `${TEST_MINIAPP_URL}orders/${order.number}` } }],
      ],
    });
    // and sees it on the order in the Mini App
    const { client } = await t.signIn(ali);
    const res = await client.orders.get({ params: { number: order.number } });
    expect(res.status === 200 && res.body.trackingNumber).toBe('BTS 4471 0098');

    // a late answer to the old question changes nothing
    const late = await reply(dilnoza, 'BTS 9999 0000', question);
    expect((await groupMessage(repliesTo(late))).plain).toBe(
      `Заказ № ${order.number} уже изменён, трек-номер не сохранён.`,
    );
    expect((await orderRow(order.number)).trackingNumber).toBe('BTS 4471 0098');
  });

  it('walks Принят → Собирается → Передан в BTS → Доставлен: the card edited each time, history added, the shopper told in their language', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder(vali, { giftMessage: '' }, '998907654321');
    const posted = await card(order.number);
    // a gift with no greeting says so: the parcel still goes without a receipt inside
    expect(posted.plain).toContain('🎁 Это подарок\nБез открытки');
    const heard = toShopper(vali).length;

    await press(dilnoza, '✅ Принят', await card(order.number));
    t.edges.clock.advance(10 * MIN);
    await press(dilnoza, '📦 Собирается', await cardWith(order.number, '📦 Собирается'));
    t.edges.clock.advance(10 * MIN);
    await press(dilnoza, '🚚 Передан в BTS', await cardWith(order.number, '🚚 Передан в BTS'));
    const question = await groupMessage((m) => m.plain.includes('введите трек-номер BTS'));
    await reply(dilnoza, 'UZ-BTS-000123', question);
    // the next day
    t.edges.clock.advance(24 * 60 * MIN);
    await press(dilnoza, '🏁 Доставлен', await cardWith(order.number, '🏁 Доставлен'));

    expect(await statusOf(order.number)).toBe('delivered');
    const c = await card(order.number, (text) => text.includes('Доставлен — Dilnoza'));
    expect(c.plain.split('\n')[0]).toBe(`Заказ № ${order.number} · Доставлен`);
    // no buttons once delivered (a return is the admin's, ADR 0006)
    expect(buttons(c)).toEqual([]);
    const history = c.plain.slice(c.plain.indexOf('История'));
    expect(history.split('\n').slice(1)).toEqual([
      '🛒 Заказ оформлен, 9 ноября, 15:00',
      '🧾 Чек отправлен — Покупатель, 15:00',
      '💳 Оплата подтверждена — ИИ, 15:00',
      '✅ Принят — Dilnoza, 15:00',
      '📦 Собирается — Dilnoza, 15:10',
      '🚚 Передан в BTS — Dilnoza, 15:20: UZ-BTS-000123',
      '🏁 Доставлен — Dilnoza, 10 ноября, 15:20',
    ]);
    // the same message all along
    expect(groupMessages().filter((m) => !m.photo && m.plain.startsWith('Заказ'))).toHaveLength(1);
    expect(c.edits).toBe(4);

    // Собирается, Передан в BTS (with the number) and Доставлен, in Uzbek; nothing for Принят
    const uz = botMessages.uz.bot;
    const n = String(order.number);
    await vi.waitFor(() => expect(toShopper(vali).length).toBe(heard + 3));
    const said = toShopper(vali).slice(heard);
    expect(said.map((m) => m.text)).toEqual([
      fill(uz.assembling, { number: n }),
      fill(uz.handedToBts, { number: n, tracking: 'UZ-BTS-000123' }),
      fill(uz.delivered, { number: n }),
    ]);
    for (const m of said)
      expect(m.options?.reply_markup).toEqual({
        inline_keyboard: [
          [{ text: uz.openOrder, web_app: { url: `${TEST_MINIAPP_URL}orders/${order.number}` } }],
        ],
      });
  });

  it('«Отменить» offers the TZ reasons, then a confirmation; the cancel carries the reason to the shopper', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();

    await press(dilnoza, 'Отменить', await card(order.number));
    let c = await cardWith(order.number, '‹ Назад');
    // «Не забрал в BTS» only once the parcel was handed over
    expect(buttons(c).map((b) => b.text)).toEqual([
      'Нет в наличии',
      'Покупатель отказался',
      'Не дозвонились',
      'Оплата не поступила',
      '‹ Назад',
    ]);
    expect(c.plain).toContain('Отмена заказа: выберите причину.');

    // back to the steps, and in again
    await press(dilnoza, '‹ Назад', c);
    c = await cardWith(order.number, '✅ Принят');
    expect(buttons(c).map((b) => b.text)).toEqual(['✅ Принят', 'Отменить']);
    await press(dilnoza, 'Отменить', c);

    await press(dilnoza, 'Нет в наличии', await cardWith(order.number, 'Нет в наличии'));
    c = await cardWith(order.number, 'Да, отменить: Нет в наличии');
    expect(buttons(c).map((b) => b.text)).toEqual(['Да, отменить: Нет в наличии', '‹ Назад']);
    expect(c.plain).toContain('Отменить заказ? Причина: Нет в наличии.');
    expect(await statusOf(order.number)).toBe('payment_confirmed');

    // before handover the bottle is still on the shelf, held by the order's reserve
    const onHand = await onHandOf(order.id);
    expect(await availableOf(order.id)).toBe(onHand - 1);

    t.edges.clock.advance(3 * MIN);
    await press(dilnoza, 'Да, отменить: Нет в наличии', c);
    expect(await statusOf(order.number)).toBe('cancelled');
    // the cancel ends the reserve and leaves on hand alone (ADR 0010)
    expect(await onHandOf(order.id)).toBe(onHand);
    expect(await availableOf(order.id)).toBe(onHand);
    c = await card(order.number, (text) => text.startsWith(`Заказ № ${order.number} · Отменён`));
    expect(buttons(c)).toEqual([]);
    expect(c.plain).toContain('❌ Отменён — Dilnoza, 15:03: Нет в наличии');
    expect(c.plain).toContain('💸 Заказ был оплачен: верните деньги покупателю.');

    // the shopper reads the reason, that the money comes back, and can write to the manager
    await vi.waitFor(() =>
      expect(toShopper(ali).at(-1)?.text).toBe(
        orderCancelledText('ru', order.number, 'out_of_stock', true),
      ),
    );
    expect(toShopper(ali).at(-1)?.options?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Открыть заказ', web_app: { url: `${TEST_MINIAPP_URL}orders/${order.number}` } }],
        [{ text: 'Написать менеджеру', url: 'https://t.me/lummi_manager' }],
      ],
    });
  });

  it('a parcel not collected at BTS: cancelled after handover, its bottles go back on hand', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const onHand = await onHandOf(order.id);
    await press(dilnoza, '✅ Принят', await card(order.number));
    await press(dilnoza, '📦 Собирается', await cardWith(order.number, '📦 Собирается'));
    await press(dilnoza, '🚚 Передан в BTS', await cardWith(order.number, '🚚 Передан в BTS'));
    await reply(
      dilnoza,
      'BTS-777777',
      await groupMessage((m) => m.plain.includes('трек-номер BTS')),
    );
    expect(await onHandOf(order.id)).toBe(onHand - 1);

    await press(dilnoza, 'Отменить', await cardWith(order.number, '🏁 Доставлен'));
    const reasons = await cardWith(order.number, 'Не забрал в BTS');
    expect(buttons(reasons).map((b) => b.text)).toContain('Не забрал в BTS');
    await press(dilnoza, 'Не забрал в BTS', reasons);
    await press(
      dilnoza,
      'Да, отменить: Не забрал в BTS',
      await cardWith(order.number, 'Да, отменить: Не забрал в BTS'),
    );

    expect(await statusOf(order.number)).toBe('cancelled');
    expect(await onHandOf(order.id)).toBe(onHand);
    const c = await card(order.number, (text) => text.includes('Отменён — Dilnoza'));
    expect(c.plain).toContain('Отменён — Dilnoza, 15:00: Не забрал в BTS');
  });

  it('a stale reason or confirmation is «Уже изменено»: the order moved on meanwhile', async () => {
    await addStaff(dilnoza);
    await addStaff(bekzod);
    const order = await paidOrder();
    await press(dilnoza, 'Отменить', await card(order.number));
    await press(
      dilnoza,
      'Оплата не поступила',
      await cardWith(order.number, 'Оплата не поступила'),
    );
    const confirm = await cardWith(order.number, 'Да, отменить: Оплата не поступила');
    // Bekzod accepts the order from the admin panel meanwhile
    const admin = await t.signInStaff('manager', bekzod);
    const res = await admin.client.admin.orders.fulfil({
      params: { number: order.number },
      body: { action: 'accept', expectedStatus: 'payment_confirmed' },
    });
    expect(res.status).toBe(200);

    const late = await press(dilnoza, 'Да, отменить: Оплата не поступила', confirm);
    expect(late.toast()?.text).toBe('Уже изменено');
    expect(await statusOf(order.number)).toBe('accepted');
    // the admin's move redrew the card with the steps again
    const c = await cardWith(order.number, '📦 Собирается');
    expect(c.plain).toContain('✅ Принят — Bekzod, 15:00');
    expect(c.plain).not.toContain('Отменить заказ?');
  });

  it('exactly one card per order, however often the confirmation or the card job is delivered', async () => {
    const client = await shopper();
    const order = await placeOrder(client);
    const receipt = await pay(order);
    // the confirmation again (a retried job, a second manager): the door refuses, no second card
    const again = await t.app.get(PaymentConfirmation).confirmPayment({
      orderId: order.id,
      creditId: (await orderRow(order.number)).creditId!,
      receiptId: receipt.id,
      actor: { type: 'ai' },
    });
    expect(again.kind).not.toBe('confirmed');
    // the card's job run several times at once, on top of the worker's own delivery
    const cards = t.app.get(OrderCards);
    await Promise.allSettled([cards.sync(order.id), cards.sync(order.id), cards.sync(order.id)]);
    await t.db.transaction((tx) => cards.touch(tx, order.id));

    await card(order.number);
    await t.app.get(WorkerRuntime).tick();
    // a delivery that found the card busy is retried by the queue (backoff from 5 s)
    await vi.waitFor(
      async () => {
        const rows = await t.db.select().from(outbox).where(eq(outbox.kind, 'order_card'));
        expect(rows.every((r) => r.sentAt !== null)).toBe(true);
      },
      { timeout: 25_000, interval: 250 },
    );
    expect(groupMessages().filter((m) => !m.photo)).toHaveLength(1);
    expect(groupMessages().filter((m) => m.photo)).toHaveLength(1);
    // a touch that changes nothing on screen edits nothing
    expect(cardOf(order.number)!.edits).toBe(0);
  });

  it('no orders group set: no card, and the order still moves', async () => {
    // the default: no group until the owner enters its id
    await t.db.delete(settings).where(eq(settings.key, 'bot.groupChatId'));
    await addStaff(dilnoza);
    const client = await shopper();
    const order = await placeOrder(client);
    await pay(order);
    const admin = await t.signInStaff('manager', dilnoza);
    const res = await admin.client.admin.orders.fulfil({
      params: { number: order.number },
      body: { action: 'accept', expectedStatus: 'payment_confirmed' },
    });
    expect(res.status).toBe(200);
    await t.app.get(WorkerRuntime).tick();
    expect(groupMessages()).toHaveLength(0);
  });

  it('a card someone deleted is posted again on the next change, with its receipt', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const first = await card(order.number);
    await vi.waitFor(() => expect(groupMessages().filter((m) => m.photo)).toHaveLength(1));
    t.edges.telegram.messages.delete(first.messageId);

    await press(dilnoza, '✅ Принят', first);
    const again = await card(order.number, (text) => text.includes('Принят — Dilnoza'));
    expect(again.messageId).not.toBe(first.messageId);
    expect(again.threadId).toBe(ORDERS_TOPIC);
    await vi.waitFor(() =>
      expect(groupMessages().filter((m) => m.photo && repliesTo(again.messageId)(m))).toHaveLength(
        1,
      ),
    );
    // and it is the one edited from then on
    await press(dilnoza, '📦 Собирается', again);
    expect(
      (await card(order.number, (text) => text.includes('Собирается — Dilnoza'))).messageId,
    ).toBe(again.messageId);
  });

  it('a group that became a supergroup: its cards and questions follow the new chat id', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    await press(dilnoza, '✅ Принят', await card(order.number));
    await press(dilnoza, '📦 Собирается', await cardWith(order.number, '📦 Собирается'));
    await press(dilnoza, '🚚 Передан в BTS', await cardWith(order.number, '🚚 Передан в BTS'));
    const question = await groupMessage((m) => m.plain.includes('введите трек-номер BTS'));

    // Telegram moves the group: the old id is refused from now on
    const NEW = -1009876543210;
    t.edges.telegram.migrated.set(GROUP, NEW);
    const res = await t.postUpdate({
      update_id: ++updateId,
      message: {
        message_id: 777,
        date: 1_700_000_000,
        chat: { id: GROUP, type: 'group', title: 'Lummi' },
        from: from(dilnoza),
        migrate_to_chat_id: NEW,
      },
    });
    expect(res.status).toBe(200);
    expect(await t.app.get(SettingsService).get('bot.groupChatId')).toBe(NEW);
    const [row] = await t.db.select().from(orderCards).where(eq(orderCards.orderId, order.id));
    expect(row!.chatId).toBe(NEW);

    // the question still counts, answered in the new chat; the card shows the change there
    await reply(dilnoza, 'BTS-555666', question, NEW);
    expect(await statusOf(order.number)).toBe('handed_to_bts');
    await vi.waitFor(
      () => {
        const moved = [...t.edges.telegram.messages.values()].find(
          (m) => m.chatId === NEW && m.plain.startsWith(`Заказ № ${order.number} · Передан в BTS`),
        );
        expect(moved?.threadId).toBe(ORDERS_TOPIC);
        // with its receipt, as a reply to it
        expect(
          [...t.edges.telegram.messages.values()].filter(
            (m) => m.chatId === NEW && m.photo && repliesTo(moved!.messageId)(m),
          ),
        ).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
  });

  it('a delivery that outlived its lease leaves the next holder alone, and the newest card stays on screen', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const telegram = t.edges.telegram;
    const leaseOf = async () =>
      (await t.db.select().from(orderCards).where(eq(orderCards.orderId, order.id)))[0]!.syncingAt;

    // the first delivery hangs in Telegram past outbox.requeueAfterSeconds (300 s)
    telegram.holdEdits = true;
    await press(dilnoza, '✅ Принят', await card(order.number));
    await vi.waitFor(() => expect(telegram.heldEdits).toHaveLength(1), { timeout: 10_000 });
    const first = await leaseOf();
    t.edges.clock.advance(10 * MIN);

    // a second change: its delivery takes the expired lease and renders the newer card
    const admin = await t.signInStaff('manager', bekzod);
    const moved = await admin.client.admin.orders.fulfil({
      params: { number: order.number },
      body: { action: 'start_assembly', expectedStatus: 'accepted' },
    });
    expect(moved.status).toBe(200);
    await vi.waitFor(() => expect(telegram.heldEdits).toHaveLength(2), { timeout: 10_000 });
    const second = await leaseOf();
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());

    // the first call fails late: it must not free the lease the second delivery holds
    telegram.heldEdits[0]!.fail(new Error('socket hang up'));
    await vi.waitFor(async () => {
      const [late] = await t.db
        .select()
        .from(outbox)
        .where(and(eq(outbox.kind, 'order_card'), eq(outbox.ref, order.id)))
        .orderBy(asc(outbox.id))
        .offset(1)
        .limit(1);
      expect(late!.sendingAt).toBeNull();
    });
    expect(await leaseOf()).toEqual(second);

    // the second lands; then a late success of an old render is overwritten by the newest one
    telegram.heldEdits[1]!.land();
    await card(order.number, (text) => text.includes('Собирается — Bekzod'));
    await vi.waitFor(async () => expect(await leaseOf()).toBeNull());
  });

  it('an old render that lands after a newer one is put right', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const telegram = t.edges.telegram;
    telegram.holdEdits = true;
    await press(dilnoza, '✅ Принят', await card(order.number));
    await vi.waitFor(() => expect(telegram.heldEdits).toHaveLength(1), { timeout: 10_000 });
    t.edges.clock.advance(10 * MIN);
    const admin = await t.signInStaff('manager', bekzod);
    await admin.client.admin.orders.fulfil({
      params: { number: order.number },
      body: { action: 'start_assembly', expectedStatus: 'accepted' },
    });
    await vi.waitFor(() => expect(telegram.heldEdits).toHaveLength(2), { timeout: 10_000 });

    // the newer render lands first and is recorded as shown
    telegram.holdEdits = false;
    telegram.heldEdits[1]!.land();
    await card(order.number, (text) => text.startsWith(`Заказ № ${order.number} · Собирается`));
    // then the old one lands: Telegram shows «Принят» again, until the card is put right
    const status = (e: { text: string }) =>
      plainText(e.text, { parse_mode: 'HTML' }).split('\n')[0];
    const before = telegram.edited.length;
    telegram.heldEdits[0]!.land();
    await vi.waitFor(
      async () => {
        const [row] = await t.db.select().from(orderCards).where(eq(orderCards.orderId, order.id));
        expect(row!.syncingAt).toBeNull();
        expect(telegram.edited.slice(before).map(status)).toEqual([
          `Заказ № ${order.number} · Принят`,
          `Заказ № ${order.number} · Собирается`,
        ]);
      },
      { timeout: 15_000 },
    );
    expect(cardOf(order.number)!.plain.split('\n')[0]).toBe(`Заказ № ${order.number} · Собирается`);
  });

  it('a button the bot never drew answers «Нельзя» and changes nothing', async () => {
    await addStaff(dilnoza);
    const order = await paidOrder();
    const c = await card(order.number);
    const forged = async (data: string) => {
      const id = ++updateId;
      await t.postUpdate({
        update_id: id,
        callback_query: {
          id: `cb-${id}`,
          from: from(dilnoza),
          chat_instance: 'group',
          data,
          message: {
            message_id: c.messageId,
            date: 1_700_000_000,
            chat: groupChat,
            from: botUser,
            text: c.plain,
          },
        },
      });
      return t.edges.telegram.answers.find((a) => a.id === `cb-${id}`)?.text;
    };
    for (const data of [
      'ord:zz',
      // no step leads on from a delivered order
      `ord:n:${order.id}:delivered`,
      // «Не забрал в BTS» fits only a parcel handed over
      `ord:r:${order.id}:payment_confirmed:not_collected_at_bts`,
      `ord:y:${order.id}:payment_confirmed:not_collected_at_bts`,
      // no such order
      'ord:n:999999:payment_confirmed',
    ])
      expect(await forged(data)).toBe('Нельзя');
    expect(await statusOf(order.number)).toBe('payment_confirmed');
  });

  it('a second press on «Передан в BTS» replaces the first question', async () => {
    await addStaff(dilnoza);
    await addStaff(bekzod);
    const order = await paidOrder();
    await press(dilnoza, '✅ Принят', await card(order.number));
    await press(dilnoza, '📦 Собирается', await cardWith(order.number, '📦 Собирается'));
    const c = await cardWith(order.number, '🚚 Передан в BTS');
    await press(dilnoza, '🚚 Передан в BTS', c);
    const first = await groupMessage((m) => m.plain.startsWith('Dilnoza, введите трек-номер'));
    await press(bekzod, '🚚 Передан в BTS', c);
    const second = await groupMessage((m) => m.plain.startsWith('Bekzod, введите трек-номер'));

    const late = await reply(dilnoza, 'BTS 1234 5678', first);
    expect((await groupMessage(repliesTo(late))).plain).toBe(
      `Этот вопрос по заказу № ${order.number} уже не действует: ответьте на последний вопрос бота.`,
    );
    expect(await statusOf(order.number)).toBe('assembling');
    await reply(bekzod, 'BTS 8765 4321', second);
    expect((await orderRow(order.number)).trackingNumber).toBe('BTS 8765 4321');
  });
});
