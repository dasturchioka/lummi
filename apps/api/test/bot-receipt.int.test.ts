import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  asc,
  botPendingReceipts,
  customers,
  btsPoints,
  eq,
  fragrances,
  orders,
  outbox,
  receipts,
  regions,
} from '@lummi/db';
import { fill, formatMoney } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { ReceiptsService } from '../src/receipts/receipts.service';
import type { WorkerRuntime } from '../src/worker/runtime';
import { receiptPdf } from './harness/pdf';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, TEST_BOT_TOKEN, TEST_MINIAPP_URL, type TestApp } from './harness/test-app';

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let worker: WorkerRuntime;
beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  t.edges.files.files.clear();
  t.edges.telegramFiles.files.clear();
  t.edges.telegramFiles.downloads.length = 0;
  t.edges.telegram.answered.length = 0;
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const MB = 1024 * 1024;

async function shopper(user: TestUser = ali, phone = '998901234567') {
  const { client, token } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  if ((await client.me.shareContact({ body: { proof } })).status !== 200)
    throw new Error('contact');
  return Object.assign(client, { token });
}
type Shopper = Awaited<ReturnType<typeof shopper>>;

async function orderBody(s: Shopper): Promise<CreateOrderBody> {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await s.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point!.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
  };
}

/** One 10 ml of the first fragrance, ordered; returns the order number and its amount due. */
async function placeOrder(s: Shopper) {
  const [f] = await t.db.select({ slug: fragrances.slug }).from(fragrances).limit(1);
  const add = await s.cart.addLine({ body: { slug: f!.slug, ml: 10, qty: 1 } });
  if (add.status !== 200) throw new Error(`add ${add.status}`);
  const res = await s.orders.create({ body: await orderBody(s) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return { number: res.body.number, amountDue: res.body.amountDue };
}

let shot = 0;
/** A receipt-like screenshot, different each call (a repeated file is a duplicate, #36). */
async function png() {
  shot += 1;
  const bars = Array.from({ length: 12 }, (_, i) => {
    const w = Math.round(900 * ((shot >> i) & 1 ? 0.8 : 0.3));
    return `<rect x="90" y="${(i + 1) * 150}" width="${w}" height="40" fill="#222"/>`;
  }).join('');
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2000"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`,
    ),
  )
    .png()
    .toBuffer();
}

/** The intake runs in the worker after the webhook answers: wait until no bot receipt is in flight. */
const intakeDone = () =>
  vi.waitFor(
    async () => {
      const rows = await t.db.select().from(botPendingReceipts);
      expect(rows.filter((r) => r.orderNumber !== null)).toHaveLength(0);
    },
    { timeout: 15_000 },
  );
/** POST a raw update, then wait for the intake it started. */
async function post(update: object) {
  const res = await t.postUpdate(update);
  await intakeDone();
  return res;
}

let updateId = 5000;
const base = (user: TestUser) => ({
  message_id: ++updateId,
  date: 1_700_000_000,
  chat: { id: user.id, type: 'private', first_name: user.first_name },
  from: {
    id: user.id,
    is_bot: false,
    first_name: user.first_name,
    language_code: user.language_code,
  },
});
const photoUpdate = (user: TestUser, sizes: { id: string; size?: number }[], id = ++updateId) => ({
  update_id: id,
  message: {
    ...base(user),
    photo: sizes.map((s, i) => ({
      file_id: s.id,
      file_unique_id: `u-${s.id}`,
      width: 100 * (i + 1),
      height: 200 * (i + 1),
      ...(s.size === undefined ? {} : { file_size: s.size }),
    })),
  },
});
const documentUpdate = (
  user: TestUser,
  doc: { id: string; name?: string; mime?: string; size?: number },
  id = ++updateId,
) => ({
  update_id: id,
  message: {
    ...base(user),
    document: {
      file_id: doc.id,
      file_unique_id: `u-${doc.id}`,
      ...(doc.name ? { file_name: doc.name } : {}),
      ...(doc.mime ? { mime_type: doc.mime } : {}),
      ...(doc.size === undefined ? {} : { file_size: doc.size }),
    },
  },
});
const callbackUpdate = (user: TestUser, data: string, id = ++updateId) => ({
  update_id: id,
  callback_query: {
    id: `cb-${id}`,
    from: {
      id: user.id,
      is_bot: false,
      first_name: user.first_name,
      language_code: user.language_code,
    },
    chat_instance: 'ci',
    data,
    message: { ...base(user), text: 'which order?' },
  },
});

const sent = async () => (await t.db.select().from(outbox).orderBy(asc(outbox.id))).map((r) => r);
const texts = async () => (await sent()).map((r) => r.text);
const lastReply = async () => (await sent()).at(-1)!;
const statusOf = async (number: number) =>
  (await t.db.select().from(orders).where(eq(orders.number, number)))[0]!.status;
const receiptRows = () => t.db.select().from(receipts).orderBy(asc(receipts.id));

/** The same button Telegram would echo back: the callback data of the n-th button of the last reply. */
async function choiceButtons() {
  const reply = await lastReply();
  const markup = (
    reply.options as {
      reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
    }
  ).reply_markup;
  return markup!.inline_keyboard.flat();
}

describe('a receipt sent to the bot', () => {
  it('a photo with one order awaiting payment is attached, like an upload', async () => {
    const s = await shopper();
    const o = await placeOrder(s);
    const before = (await texts()).length;
    t.edges.telegramFiles.files.set('big', await png());
    t.edges.telegramFiles.files.set('small', await png());
    // the 5 MB size is the largest under the 10 MB cap; the 20 MB one is skipped
    const res = await post(
      photoUpdate(ali, [
        { id: 'small', size: 20_000 },
        { id: 'big', size: 5 * MB },
        { id: 'huge', size: 20 * MB },
      ]),
    );
    expect(res.status).toBe(200);
    expect(t.edges.telegramFiles.downloads).toEqual(['big']);
    const [r] = await receiptRows();
    expect(r).toMatchObject({ source: 'bot', kind: 'png', verdict: 'pending', fileName: null });
    expect(await statusOf(o.number)).toBe('receipt_review');
    // exactly the message an upload queues
    expect((await texts()).slice(before)).toEqual([
      fill(dictionaries.ru.bot.receiptReceived, { number: String(o.number) }),
    ]);
  });

  it('a PDF document goes through the same path and keeps its name', async () => {
    const s = await shopper();
    const o = await placeOrder(s);
    t.edges.telegramFiles.files.set('pdf1', receiptPdf());
    await post(
      documentUpdate(ali, { id: 'pdf1', name: 'check.pdf', mime: 'application/pdf', size: 3000 }),
    );
    const [r] = await receiptRows();
    expect(r).toMatchObject({ source: 'bot', kind: 'pdf', fileName: 'check.pdf' });
    expect(await statusOf(o.number)).toBe('receipt_review');
  });

  it('a file of the wrong type by its first bytes is refused, in the customer language', async () => {
    const s = await shopper(vali, '998907654321');
    const o = await placeOrder(s);
    t.edges.telegramFiles.files.set('txt', Buffer.from('this is not an image at all'));
    await post(documentUpdate(vali, { id: 'txt', name: 'check.png', mime: 'image/png', size: 27 }));
    expect(await receiptRows()).toHaveLength(0);
    expect(await statusOf(o.number)).toBe('awaiting_payment');
    expect((await lastReply()).text).toBe(dictionaries.uz.bot.receiptUnsupported);
  });

  it('a document whose declared type is not an image or a PDF is refused without downloading', async () => {
    await placeOrder(await shopper());
    await post(
      documentUpdate(ali, { id: 'zip', name: 'a.zip', mime: 'application/zip', size: 100 }),
    );
    expect(t.edges.telegramFiles.downloads).toEqual([]);
    expect((await lastReply()).text).toBe(dictionaries.ru.bot.receiptUnsupported);
  });

  it('a file over the size setting is refused by its declared size, before any download', async () => {
    const o = await placeOrder(await shopper());
    await post(documentUpdate(ali, { id: 'big', name: 'a.png', mime: 'image/png', size: 11 * MB }));
    expect(t.edges.telegramFiles.downloads).toEqual([]);
    expect(await statusOf(o.number)).toBe('awaiting_payment');
    expect((await lastReply()).text).toBe(fill(dictionaries.ru.bot.receiptTooLarge, { max: '10' }));
  });

  it('a file that is over the cap only once downloaded is refused the same way', async () => {
    await placeOrder(await shopper());
    t.edges.telegramFiles.files.set('liar', Buffer.alloc(10 * MB + 1, 1));
    await post(documentUpdate(ali, { id: 'liar', mime: 'image/png', size: 1000 }));
    expect(await receiptRows()).toHaveLength(0);
    expect((await lastReply()).text).toBe(fill(dictionaries.ru.bot.receiptTooLarge, { max: '10' }));
  });

  it('a photo whose every size is over the cap is refused', async () => {
    await placeOrder(await shopper());
    await post(photoUpdate(ali, [{ id: 'a', size: 12 * MB }]));
    expect(t.edges.telegramFiles.downloads).toEqual([]);
    expect((await lastReply()).text).toContain('10');
  });

  it('a file Telegram cannot hand over gets a "send it again" reply and nothing is stored', async () => {
    const o = await placeOrder(await shopper());
    await post(photoUpdate(ali, [{ id: 'gone', size: 1000 }]));
    expect(await receiptRows()).toHaveLength(0);
    expect(await statusOf(o.number)).toBe('awaiting_payment');
    expect((await lastReply()).text).toBe(dictionaries.ru.bot.receiptTryAgain);
  });

  it('no order awaiting payment: a polite reply with a button to the orders', async () => {
    await shopper();
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    expect(t.edges.telegramFiles.downloads).toEqual([]);
    const reply = await lastReply();
    expect(reply.text).toBe(dictionaries.ru.bot.receiptNoOrders);
    expect(reply.options).toEqual({
      reply_markup: {
        inline_keyboard: [
          [{ text: dictionaries.ru.bot.openOrders, web_app: { url: `${TEST_MINIAPP_URL}orders` } }],
        ],
      },
    });
  });

  it('someone who has not opened the shop is told to open it first', async () => {
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(vali, [{ id: 'p', size: 1000 }]));
    const reply = await lastReply();
    expect(reply.chatId).toBe(vali.id);
    expect(reply.text).toBe(dictionaries.uz.bot.receiptUnknownUser);
    expect(reply.options).toEqual({
      reply_markup: {
        inline_keyboard: [
          [{ text: dictionaries.uz.bot.openShop, web_app: { url: TEST_MINIAPP_URL } }],
        ],
      },
    });
  });

  it('a second receipt while one is under check is told so, as an upload gets a 409', async () => {
    const o = await placeOrder(await shopper());
    t.edges.telegramFiles.files.set('one', await png());
    t.edges.telegramFiles.files.set('two', await png());
    await post(photoUpdate(ali, [{ id: 'one', size: 1000 }]));
    await post(photoUpdate(ali, [{ id: 'two', size: 1000 }]));
    expect(await receiptRows()).toHaveLength(1);
    expect((await lastReply()).text).toBe(
      fill(dictionaries.ru.bot.receiptUnderCheck, { number: String(o.number) }),
    );
  });

  it('the same update_id twice attaches once', async () => {
    const o = await placeOrder(await shopper());
    t.edges.telegramFiles.files.set('p', await png());
    const u = photoUpdate(ali, [{ id: 'p', size: 1000 }]);
    await post(u);
    await post(u);
    expect(await receiptRows()).toHaveLength(1);
    expect(t.edges.telegramFiles.downloads).toEqual(['p']);
    expect(await statusOf(o.number)).toBe('receipt_review');
  });

  it('a message in a group is ignored', async () => {
    await placeOrder(await shopper());
    const u = photoUpdate(ali, [{ id: 'p', size: 1000 }]);
    u.message.chat = { id: -100123, type: 'supergroup', first_name: 'g' };
    const before = (await texts()).length;
    expect((await post(u)).status).toBe(200);
    expect(t.edges.telegramFiles.downloads).toEqual([]);
    expect((await texts()).length).toBe(before);
  });
});

describe('several orders awaiting payment', () => {
  async function twoOrders() {
    const s = await shopper();
    const first = await placeOrder(s);
    const second = await placeOrder(s);
    return { s, first, second };
  }

  it('asks with one button per order; the choice attaches the file to that order', async () => {
    const { first, second } = await twoOrders();
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    expect(t.edges.telegramFiles.downloads).toEqual([]); // nothing fetched until they choose
    const reply = await lastReply();
    expect(reply.text).toBe(dictionaries.ru.bot.receiptWhichOrder);
    const buttons = await choiceButtons();
    expect(buttons.map((b) => b.text)).toEqual([
      fill(dictionaries.ru.bot.receiptOrderChoice, {
        number: String(first.number),
        amount: formatMoney(first.amountDue, 'ru'),
      }),
      fill(dictionaries.ru.bot.receiptOrderChoice, {
        number: String(second.number),
        amount: formatMoney(second.amountDue, 'ru'),
      }),
    ]);
    expect(buttons.every((b) => (b.callback_data ?? '').length <= 64)).toBe(true);
    expect(await t.db.select().from(botPendingReceipts)).toHaveLength(1);

    const before = (await texts()).length;
    const res = await post(callbackUpdate(ali, buttons[1]!.callback_data!));
    expect(res.status).toBe(200);
    expect(t.edges.telegram.answered).toHaveLength(1);
    expect(t.edges.telegramFiles.downloads).toEqual(['p']);
    expect(await statusOf(second.number)).toBe('receipt_review');
    expect(await statusOf(first.number)).toBe('awaiting_payment');
    expect((await receiptRows())[0]).toMatchObject({ source: 'bot' });
    expect((await texts()).slice(before)).toEqual([
      fill(dictionaries.ru.bot.receiptReceived, { number: String(second.number) }),
    ]);
    expect(await t.db.select().from(botPendingReceipts)).toHaveLength(0);
  });

  it('a stale choice (the order is no longer awaiting payment) gets a polite answer', async () => {
    const { s, first, second } = await twoOrders();
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    const buttons = await choiceButtons();
    const cancelled = await s.orders.cancel({
      params: { number: first.number },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(cancelled.status).toBe(200);
    await post(callbackUpdate(ali, buttons[0]!.callback_data!));
    expect(await receiptRows()).toHaveLength(0);
    expect(t.edges.telegram.answered).toHaveLength(1);
    expect((await lastReply()).text).toBe(
      fill(dictionaries.ru.bot.orderNotAwaiting, { number: String(first.number) }),
    );
    expect(await statusOf(second.number)).toBe('awaiting_payment');
    // the file stays, still waiting for a choice, so they can pick the other order
    const [kept] = await t.db.select().from(botPendingReceipts);
    expect(kept).toMatchObject({ fileId: 'p', orderNumber: null });
  });

  it('a choice after the wait window asks for the receipt again', async () => {
    await twoOrders();
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    const buttons = await choiceButtons();
    t.edges.clock.advance(2 * 3600 * 1000);
    await post(callbackUpdate(ali, buttons[0]!.callback_data!));
    expect(await receiptRows()).toHaveLength(0);
    expect((await lastReply()).text).toBe(dictionaries.ru.bot.receiptExpired);
  });

  it("one customer cannot use another's button", async () => {
    await twoOrders();
    await shopper(vali, '998907654321');
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    const buttons = await choiceButtons();
    await post(callbackUpdate(vali, buttons[0]!.callback_data!));
    expect(await receiptRows()).toHaveLength(0);
    expect(t.edges.telegramFiles.downloads).toEqual([]);
  });

  it('the same choice tapped twice attaches once', async () => {
    await twoOrders();
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    const data = (await choiceButtons())[0]!.callback_data!;
    await post(callbackUpdate(ali, data));
    await post(callbackUpdate(ali, data)); // a new update_id: the pending file is gone
    expect(await receiptRows()).toHaveLength(1);
    // the file is gone, and the order it went to is under check
    expect((await lastReply()).text).toBe(
      fill(dictionaries.ru.bot.receiptUnderCheck, { number: '1001' }),
    );
  });
});

describe('the intake is never lost (ADR 0021)', () => {
  it('a submit that throws once is retried and attaches exactly once', async () => {
    const o = await placeOrder(await shopper());
    t.edges.telegramFiles.files.set('p', await png());
    vi.spyOn(t.app.get(ReceiptsService), 'submit').mockRejectedValueOnce(new Error('boom'));
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    expect(await receiptRows()).toHaveLength(1);
    expect(await statusOf(o.number)).toBe('receipt_review');
    expect(t.edges.telegramFiles.downloads).toEqual(['p', 'p']);
    // no apology: the retry succeeded
    expect((await texts()).filter((x) => x === dictionaries.ru.bot.receiptTryAgain)).toEqual([]);
  });

  it('a crash between the commit and the queue entry is picked up by the sweep', async () => {
    const o = await placeOrder(await shopper());
    const [c] = await t.db.select().from(customers);
    t.edges.telegramFiles.files.set('lost', await png());
    // what an update that committed and then died leaves behind
    await t.db.insert(botPendingReceipts).values({
      customerId: c!.id,
      fileId: 'lost',
      orderNumber: o.number,
      createdAt: t.edges.clock.now(),
    });
    t.edges.clock.advance(5 * 60 * 1000);
    await worker.tick();
    await intakeDone();
    expect(await receiptRows()).toHaveLength(1);
    expect(await statusOf(o.number)).toBe('receipt_review');
  });

  it('a final failure sends a polite "send it again" in the customer language and clears the row', async () => {
    const s = await shopper(vali, '998907654321');
    const o = await placeOrder(s);
    await post(photoUpdate(vali, [{ id: 'gone', size: 1000 }])); // Telegram never hands it over
    expect(t.edges.telegramFiles.downloads).toEqual(['gone', 'gone', 'gone']);
    expect(await receiptRows()).toHaveLength(0);
    expect(await statusOf(o.number)).toBe('awaiting_payment');
    expect(await t.db.select().from(botPendingReceipts)).toHaveLength(0);
    expect((await lastReply()).text).toBe(dictionaries.uz.bot.receiptTryAgain);
  });

  it('a submit that keeps throwing ends with the polite reply, not silence', async () => {
    await placeOrder(await shopper());
    t.edges.telegramFiles.files.set('p', await png());
    vi.spyOn(t.app.get(ReceiptsService), 'submit').mockRejectedValue(new Error('boom'));
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    expect((await lastReply()).text).toBe(dictionaries.ru.bot.receiptTryAgain);
    expect(await t.db.select().from(botPendingReceipts)).toHaveLength(0);
  });
});

describe('callback routing', () => {
  it("another feature's button is not answered by the receipt handler", async () => {
    await shopper();
    const res = await t.postUpdate(callbackUpdate(ali, 'grp:confirm:1'));
    expect(res.status).toBe(200);
    expect(t.edges.telegram.answered).toEqual([]);
    expect(await t.db.select().from(botPendingReceipts)).toHaveLength(0);
  });
});

describe('same as an upload', () => {
  it('the bot and the Mini App leave the same status, message and receipt row', async () => {
    const dilya: TestUser = { id: 43, first_name: 'Dilya', language_code: 'ru' };
    const a = await shopper(ali);
    const b = await shopper(dilya, '998909998877');
    const viaBot = await placeOrder(a);
    const viaApp = await placeOrder(b);
    const before = (await texts()).length;
    t.edges.telegramFiles.files.set('p', await png());
    await post(photoUpdate(ali, [{ id: 'p', size: 1000 }]));
    const afterBot = (await sent()).slice(before);
    const upload = await fetch(`${t.baseUrl}/orders/${viaApp.number}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${b.token}` },
      body: await png(),
    });
    expect(upload.status).toBe(201);
    const afterUpload = (await sent()).slice(before + afterBot.length);
    const norm = (m: (typeof afterBot)[number], n: number) => ({
      text: m.text.replaceAll(String(n), '<n>'),
      options: JSON.parse(JSON.stringify(m.options).replaceAll(String(n), '<n>')),
    });
    expect(afterBot).toHaveLength(1);
    expect(afterUpload).toHaveLength(1);
    expect(norm(afterBot[0]!, viaBot.number)).toEqual(norm(afterUpload[0]!, viaApp.number));
    expect(await statusOf(viaBot.number)).toBe(await statusOf(viaApp.number));
    const [rBot, rApp] = await receiptRows();
    expect([rBot!.source, rApp!.source]).toEqual(['bot', 'miniapp']);
    expect({
      ...rBot,
      id: 0,
      orderId: 0,
      source: '',
      originalKey: '',
      normalizedKey: '',
      sha256: '',
      phash: '',
      createdAt: null,
    }).toMatchObject({
      kind: rApp!.kind,
      verdict: rApp!.verdict,
      normalizedMime: rApp!.normalizedMime,
    });
  });
});

describe('the sweep that prunes', () => {
  it('deletes only the choices nobody made in time', async () => {
    await shopper();
    const [c] = await t.db.select().from(customers);
    const now = t.edges.clock.now();
    const rows = await t.db
      .insert(botPendingReceipts)
      .values([
        { customerId: c!.id, fileId: 'old', createdAt: new Date(now.getTime() - 3 * 86_400_000) },
        { customerId: c!.id, fileId: 'fresh', createdAt: new Date(now.getTime() - 60_000) },
      ])
      .returning();
    expect(rows).toHaveLength(2);
    await worker.tick();
    const left = await t.db.select().from(botPendingReceipts);
    expect(left.map((r) => r.fileId)).toEqual(['fresh']);
  });
});
