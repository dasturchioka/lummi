import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  asc,
  auditLog,
  btsPoints,
  customers,
  eq,
  fragrances,
  orderEvents,
  orderLines,
  orders,
  outbox,
  regions,
  reviewPhotos,
  reviews,
  settings,
} from '@lummi/db';
import { fill } from '@lummi/i18n';
import { dictionaries } from '@lummi/i18n/all';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { SettingsService } from '../src/settings/settings.service';
import { WorkerRuntime } from '../src/worker/runtime';
import type { TestUser } from './harness/sign-init-data';
import {
  createTestApp,
  MANAGER_WIDGET_USER,
  TEST_BOT_TOKEN,
  type StaffSession,
  type TestApp,
} from './harness/test-app';

/**
 * Seam 1 (ADR 0028): reviews (#41) over HTTP and the webhook: the request sweep, the bot's
 * rating / comment / photo conversation, the «Отзывы» post for low ratings, the admin panel and
 * the customer-facing block. Reviews stay private until staff publish them.
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

const GROUP = -1001234567890;
const REVIEWS_TOPIC = 9;
const HOUR = 3600_000;
const T0 = new Date('2026-11-09T10:00:00Z');

let t: TestApp;
let worker: WorkerRuntime;
beforeAll(async () => {
  t = await createTestApp();
  worker = t.startWorker();
});
afterAll(() => t.close());
beforeEach(async () => {
  vi.restoreAllMocks();
  t.edges.clock.set(T0);
  await worker.pause();
  t.edges.telegram.releaseHeld();
  await t.reset();
  t.edges.telegram.reset();
  t.edges.files.files.clear();
  t.edges.telegramFiles.files.clear();
  t.edges.telegramFiles.downloads.length = 0;
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  const config = t.app.get(SettingsService);
  await config.set('bot.groupChatId', GROUP, { type: 'system' });
  await config.set(
    'bot.topics',
    { orders: 7, payments: 8, reviews: REVIEWS_TOPIC, system: 10 },
    { type: 'system' },
  );
  await worker.resume();
});

const ali: TestUser = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };
const tick = () => t.app.get(WorkerRuntime).tick();
const ru = dictionaries.ru.bot;

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
type Shopper = Awaited<ReturnType<typeof shopper>>;

async function slugs(n: number) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

/**
 * A delivered order of the first `n` fragrances (10 ml each), delivered at the fake clock's "now".
 * Placed through the API, then moved to «Доставлен» in the DB with its history row: the payment
 * and fulfilment chain has its own tests.
 */
async function deliveredOrder(user: TestUser = ali, phone = '998901234567', n = 2) {
  const s: Shopper = await shopper(user, phone);
  const chosen = await slugs(n);
  for (const slug of chosen) {
    const add = await s.cart.addLine({ body: { slug, ml: 10, qty: 1 } });
    if (add.status !== 200) throw new Error(`add ${add.status}`);
  }
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await s.checkout.get({ query: { regionId: region!.id } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const body: CreateOrderBody = {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998901234567',
    delivery: { kind: 'point', pointId: point!.id },
    consent: true,
    confirmedTotal: checkout.body.quote.total,
    confirmedDiscount: checkout.body.quote.discount,
    idempotencyKey: randomUUID(),
  };
  const res = await s.orders.create({ body });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  const [order] = await t.db.select().from(orders).where(eq(orders.number, res.body.number));
  await deliver(order!.id);
  return { id: order!.id, number: res.body.number, slugs: chosen, client: s };
}

async function deliver(orderId: number, at = t.edges.clock.now()) {
  await t.db.update(orders).set({ status: 'delivered' }).where(eq(orders.id, orderId));
  await t.db.insert(orderEvents).values({
    orderId,
    fromStatus: 'handed_to_bts',
    toStatus: 'delivered',
    action: 'deliver',
    actorType: 'system',
    createdAt: at,
  });
}

let updateId = 9000;
const from = (u: TestUser) => ({
  id: u.id,
  is_bot: false,
  first_name: u.first_name,
  language_code: u.language_code,
});
const chatOf = (u: TestUser) => ({ id: u.id, type: 'private', first_name: u.first_name });
const message = (u: TestUser) => ({
  message_id: ++updateId,
  date: 1_700_000_000,
  chat: chatOf(u),
  from: from(u),
});
const tap = (u: TestUser, data: string) =>
  t.postUpdate({
    update_id: ++updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: from(u),
      chat_instance: 'ci',
      data,
      message: { ...message(u), text: 'review?' },
    },
  });
const say = (u: TestUser, text: string) =>
  t.postUpdate({ update_id: ++updateId, message: { ...message(u), text } });
const sendPhoto = (u: TestUser, fileId: string, size = 20_000) =>
  t.postUpdate({
    update_id: ++updateId,
    message: {
      ...message(u),
      photo: [
        {
          file_id: fileId,
          file_unique_id: `u-${fileId}`,
          width: 800,
          height: 600,
          file_size: size,
        },
      ],
    },
  });

let shot = 0;
/** A real, distinct JPEG. */
async function jpeg() {
  shot += 1;
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: shot * 7, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}
const addPhoto = async (id: string) => t.edges.telegramFiles.files.set(id, await jpeg());

const reviewRows = () => t.db.select().from(reviews).orderBy(asc(reviews.id));
const photoRows = () => t.db.select().from(reviewPhotos).orderBy(asc(reviewPhotos.id));
const outboxFor = async (chatId: number) =>
  (await t.db.select().from(outbox).orderBy(asc(outbox.id))).filter((r) => r.chatId === chatId);
/** The review requests sent to a customer (rows with rating buttons). */
const asksTo = async (u: TestUser) =>
  (await outboxFor(u.id)).filter((r) => buttons(r).some((b) => b.callback_data?.startsWith('rev:r:')));
const lastReplyTo = async (u: TestUser) => (await outboxFor(u.id)).at(-1)!;
const buttons = (row: { options: unknown }) =>
  (
    row.options as {
      reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
    }
  ).reply_markup?.inline_keyboard.flat() ?? [];
/** Every photo fetch finished (stored, or given up). */
const photosSettled = () =>
  vi.waitFor(
    async () => expect((await photoRows()).filter((p) => p.fileKey === null)).toHaveLength(0),
    {
      timeout: 15_000,
    },
  );
const topicPosts = () =>
  [...t.edges.telegram.messages.values()].filter(
    (m) => m.chatId === GROUP && m.threadId === REVIEWS_TOPIC,
  );

/** The request goes out: the clock passes the delay and the sweep runs. */
async function request(_order: { id: number }) {
  t.edges.clock.advance(24 * HOUR);
  await tick();
}

/** The «Готово» button of the latest reply that has one. */
async function doneButton(user: TestUser = ali) {
  for (const row of (await outboxFor(user.id)).reverse()) {
    const b = buttons(row).find((x) => x.text === ru.reviewDone);
    if (b) return b.callback_data!;
  }
  throw new Error('no «Готово» button was sent');
}
const skipButton = async (user: TestUser = ali) =>
  buttons(await lastReplyTo(user)).find((b) => b.text === ru.reviewSkip)!.callback_data!;

describe('the review request sweep', () => {
  it('asks once, after the delay, with 1 to 5 buttons, and stamps the marker', async () => {
    const o = await deliveredOrder();
    t.edges.clock.advance(23 * HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(0);

    t.edges.clock.advance(HOUR);
    await tick();
    const [ask] = await asksTo(ali);
    expect(ask!.text).toBe(fill(ru.reviewRequest, { number: String(o.number) }));
    expect(buttons(ask!).map((b) => b.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(buttons(ask!).map((b) => b.callback_data)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `rev:r:${o.id}:${n}`),
    );
    const [row] = await t.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.reviewRequestedAt).not.toBeNull();
    expect(row!.reviewRequest).toBe('sent');

    await tick();
    t.edges.clock.advance(5 * HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(1);
  });

  it('follows the delay setting', async () => {
    await t.app.get(SettingsService).set('reviews.requestDelayHours', 2, { type: 'system' });
    await deliveredOrder();
    t.edges.clock.advance(HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(0);
    t.edges.clock.advance(HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(1);
  });

  it('asks in the customer language', async () => {
    const o = await deliveredOrder(vali, '998901112233');
    t.edges.clock.advance(24 * HOUR);
    await tick();
    expect((await asksTo(vali))[0]!.text).toBe(
      fill(dictionaries.uz.bot.reviewRequest, { number: String(o.number) }),
    );
  });

  it('skips orders that are no longer delivered (cancelled, returned) and never asks them later', async () => {
    const o = await deliveredOrder();
    await t.db.update(orders).set({ status: 'returned' }).where(eq(orders.id, o.id));
    t.edges.clock.advance(30 * HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(0);
  });

  it('does not ask a customer who blocked the bot and marks the order «не доставлено»', async () => {
    const o = await deliveredOrder();
    await t.db.update(customers).set({ botBlocked: true }).where(eq(customers.telegramId, ali.id));
    t.edges.clock.advance(24 * HOUR);
    await tick();
    expect(await asksTo(ali)).toHaveLength(0);
    const [row] = await t.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.reviewRequest).toBe('not_delivered');
    // unblocking later does not bring the request back: once
    await t.db.update(customers).set({ botBlocked: false }).where(eq(customers.telegramId, ali.id));
    await tick();
    expect(await asksTo(ali)).toHaveLength(0);
  });
});

describe('the bot conversation', () => {
  it('a rating creates a private review and asks for a comment', async () => {
    const o = await deliveredOrder();
    await request(o);
    expect((await tap(ali, `rev:r:${o.id}:5`)).status).toBe(200);
    const [r] = await reviewRows();
    expect(r).toMatchObject({ orderId: o.id, rating: 5, published: false, step: 'comment' });
    const ask = await lastReplyTo(ali);
    expect(ask.text).toBe(fill(ru.reviewAskComment, { rating: '5' }));
    expect(buttons(ask)[0]!.text).toBe(ru.reviewSkip);
  });

  it('stores a comment, then asks for photos, then finishes with «Готово»', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:4`);
    await say(ali, 'Очень красивый аромат, держится весь день');
    const [r] = await reviewRows();
    expect(r!.comment).toBe('Очень красивый аромат, держится весь день');
    expect(r!.step).toBe('photos');
    expect((await lastReplyTo(ali)).text).toBe(fill(ru.reviewAskPhotos, { max: '3' }));
    await tap(ali, await doneButton());
    expect((await reviewRows())[0]!.step).toBe('done');
    expect((await lastReplyTo(ali)).text).toBe(ru.reviewThanks);
  });

  it('skipping the comment goes on to the photos', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:3`);
    await tap(ali, await skipButton());
    expect((await reviewRows())[0]).toMatchObject({ comment: null, step: 'photos' });
  });

  it('a second tap on the rating changes nothing and says so', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:5`);
    await tap(ali, `rev:r:${o.id}:1`);
    const rows = await reviewRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(5);
    expect((await lastReplyTo(ali)).text).toBe(ru.reviewAlready);
  });

  it("another customer's button, a forged order and an out-of-range rating do nothing", async () => {
    const o = await deliveredOrder();
    await request(o);
    await shopper(vali, '998901112233');
    await tap(vali, `rev:r:${o.id}:5`);
    await tap(ali, `rev:r:${o.id}:9`);
    await tap(ali, 'rev:r:99999:5');
    await tap(ali, 'rev:x');
    expect(await reviewRows()).toHaveLength(0);
  });

  it('a request that was never sent cannot be answered', async () => {
    const o = await deliveredOrder();
    await tap(ali, `rev:r:${o.id}:5`);
    expect(await reviewRows()).toHaveLength(0);
  });

  it('refuses a comment over the setting and keeps waiting for one', async () => {
    await t.app.get(SettingsService).set('reviews.commentMaxLength', 50, { type: 'system' });
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:5`);
    await say(ali, 'x'.repeat(51));
    expect((await reviewRows())[0]).toMatchObject({ comment: null, step: 'comment' });
    expect((await lastReplyTo(ali)).text).toBe(fill(ru.reviewCommentTooLong, { max: '50' }));
  });

  it('text with no review waiting for it is not a comment, and a command is not either', async () => {
    const o = await deliveredOrder();
    await request(o);
    await say(ali, 'привет');
    await tap(ali, `rev:r:${o.id}:5`);
    await say(ali, '/start');
    expect((await reviewRows())[0]!.comment).toBeNull();
  });

  it('closes an abandoned review after the idle setting, and a low one reaches the topic', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:2`);
    t.edges.clock.advance(30 * 60_000);
    await tick();
    expect((await reviewRows())[0]!.step).toBe('comment');
    t.edges.clock.advance(31 * 60_000);
    await tick();
    expect((await reviewRows())[0]!.step).toBe('done');
    await vi.waitFor(() => expect(topicPosts()).toHaveLength(1));
  });
});

describe('photos', () => {
  async function toPhotoStep(rating = 5) {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:${rating}`);
    await say(ali, 'Нравится');
    return o;
  }

  it('stores a checked photo through FileStore, privately', async () => {
    await toPhotoStep();
    await addPhoto('p1');
    await sendPhoto(ali, 'p1');
    await photosSettled();
    const [p] = await photoRows();
    expect(p!.fileKey).toMatch(/^private\/reviews\//);
    expect(t.edges.files.files.has(p!.fileKey!)).toBe(true);
    const bytes = t.edges.files.files.get(p!.fileKey!)!;
    expect((await sharp(bytes).metadata()).format).toBe('jpeg');
    expect((await lastReplyTo(ali)).text).toBe(fill(ru.reviewPhotoTaken, { n: '1', max: '3' }));
  });

  it('judges the file by its first bytes, not by its name or type', async () => {
    await toPhotoStep();
    t.edges.telegramFiles.files.set('fake', Buffer.from('MZ not an image at all'));
    await sendPhoto(ali, 'fake');
    await photosSettled();
    expect(await photoRows()).toHaveLength(0);
    expect((await lastReplyTo(ali)).text).toBe(ru.reviewPhotoUnsupported);
  });

  it('refuses a photo over the receipt size cap', async () => {
    await toPhotoStep();
    await sendPhoto(ali, 'huge', 20 * 1024 * 1024);
    await photosSettled();
    expect(await photoRows()).toHaveLength(0);
    expect((await lastReplyTo(ali)).text).toBe(fill(ru.reviewPhotoTooLarge, { max: '10' }));
  });

  it('takes up to the setting, then closes the review with thanks', async () => {
    await t.app.get(SettingsService).set('reviews.maxPhotos', 2, { type: 'system' });
    await toPhotoStep();
    for (const id of ['a', 'b', 'c']) {
      await addPhoto(id);
      await sendPhoto(ali, id);
      await photosSettled();
    }
    expect(await photoRows()).toHaveLength(2);
    expect((await reviewRows())[0]!.step).toBe('done');
    expect(t.edges.telegramFiles.downloads).toEqual(['a', 'b']);
  });

  it('retries a download that fails, and gives up with a polite message', async () => {
    await toPhotoStep();
    // no bytes for this id: every attempt is "unavailable"
    await sendPhoto(ali, 'gone');
    await photosSettled();
    expect(await photoRows()).toHaveLength(0);
    expect(t.edges.telegramFiles.downloads.filter((d) => d === 'gone').length).toBeGreaterThan(1);
    expect((await lastReplyTo(ali)).text).toBe(ru.reviewPhotoTryAgain);
  });

  it('the same update delivered twice stores one photo', async () => {
    await toPhotoStep();
    await addPhoto('p1');
    const update = {
      update_id: ++updateId,
      message: {
        ...message(ali),
        photo: [{ file_id: 'p1', file_unique_id: 'u', width: 1, height: 1, file_size: 100 }],
      },
    };
    await t.postUpdate(update);
    await t.postUpdate(update);
    await photosSettled();
    expect(await photoRows()).toHaveLength(1);
  });

  it('a photo sent while no review waits for one is still a receipt, never a review photo', async () => {
    await deliveredOrder();
    await addPhoto('p1');
    await sendPhoto(ali, 'p1');
    await vi.waitFor(async () => expect((await lastReplyTo(ali)).text).toBe(ru.receiptNoOrders));
    expect(await photoRows()).toHaveLength(0);
  });
});

describe('the «Отзывы» topic', () => {
  it('posts a low rating with the order number, phone, rating, comment and photos', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:2`);
    await say(ali, 'Аромат <быстро> пропал & ушёл');
    await addPhoto('p1');
    await sendPhoto(ali, 'p1');
    await photosSettled();
    await tap(ali, await doneButton());
    await vi.waitFor(() => expect(topicPosts().length).toBeGreaterThanOrEqual(2));
    const [text, photo] = topicPosts();
    expect(text!.plain).toContain(String(o.number));
    expect(text!.plain.replace(/\D/g, '')).toContain('998901234567');
    expect(text!.plain).toContain('2/5');
    expect(text!.plain).toContain('Аромат <быстро> пропал & ушёл');
    expect(photo!.photo).toBeDefined();
    expect(ru.reviewThanksLow).toBeTruthy();
    expect((await outboxFor(ali.id)).map((r) => r.text)).toContain(ru.reviewThanksLow);
  });

  it('posts a low rating without a comment too, once', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:1`);
    await tap(ali, await skipButton());
    const done = await doneButton();
    await tap(ali, done);
    await tap(ali, done);
    await vi.waitFor(() => expect(topicPosts()).toHaveLength(1));
    await tick();
    await new Promise((r) => setTimeout(r, 300));
    expect(topicPosts()).toHaveLength(1);
    expect(topicPosts()[0]!.plain).toContain(dictionaries.ru.bot.group.reviewNoComment);
  });

  it('does not post a high rating', async () => {
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:4`);
    await tap(ali, await skipButton());
    await tap(ali, await doneButton());
    await tick();
    await new Promise((r) => setTimeout(r, 300));
    expect(topicPosts()).toHaveLength(0);
    expect((await lastReplyTo(ali)).text).toBe(ru.reviewThanks);
  });

  it('the low-rating limit is a setting', async () => {
    await t.app.get(SettingsService).set('reviews.lowRatingMax', 4, { type: 'system' });
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:4`);
    await tap(ali, await skipButton());
    await tap(ali, await doneButton());
    await vi.waitFor(() => expect(topicPosts()).toHaveLength(1));
  });

  it('waits for the group: with none set the review is kept and posts once it is', async () => {
    await t.db.delete(settings).where(eq(settings.key, 'bot.groupChatId'));
    const o = await deliveredOrder();
    await request(o);
    await tap(ali, `rev:r:${o.id}:1`);
    await tap(ali, await skipButton());
    await tap(ali, await doneButton());
    await tick();
    expect(topicPosts()).toHaveLength(0);
    await t.app.get(SettingsService).set('bot.groupChatId', GROUP, { type: 'system' });
    await tick();
    await vi.waitFor(() => expect(topicPosts()).toHaveLength(1));
  });
});

/** A finished, delivered, rated order; returns its review id. */
async function rated(
  o: { id: number },
  rating: number,
  comment: string | null,
  user: TestUser = ali,
  at = t.edges.clock.now(),
) {
  const [c] = await t.db.select().from(customers).where(eq(customers.telegramId, user.id));
  const [r] = await t.db
    .insert(reviews)
    .values({
      orderId: o.id,
      customerId: c!.id,
      rating,
      comment,
      step: 'done',
      postQueuedAt: at,
      createdAt: at,
    })
    .returning();
  return r!;
}

describe('the product card block', () => {
  it('unpublished reviews never reach the customer', async () => {
    const o = await deliveredOrder();
    await rated(o, 5, 'Великолепно');
    const res = await o.client.reviews.forTarget({ params: { target: o.slugs[0]! } });
    expect(res.status).toBe(200);
    expect(res.status === 200 && res.body).toEqual({ average: null, count: 0, items: [] });
  });

  it('a published review shows on each fragrance of its order, and on no other', async () => {
    const o = await deliveredOrder(ali, '998901234567', 2);
    const r = await rated(o, 4, 'Тёплый, древесный');
    await t.db
      .update(reviews)
      .set({ published: true, publishedAt: T0 })
      .where(eq(reviews.id, r.id));
    for (const slug of o.slugs) {
      const res = await o.client.reviews.forTarget({ params: { target: slug } });
      expect(res.status === 200 && res.body.count).toBe(1);
      expect(res.status === 200 && res.body.average).toBe(4);
      expect(res.status === 200 && res.body.items[0]).toMatchObject({
        id: r.id,
        rating: 4,
        comment: 'Тёплый, древесный',
        firstName: 'Ali',
        photos: [],
      });
    }
    const [other] = (await slugs(5)).filter((s) => !o.slugs.includes(s));
    const none = await o.client.reviews.forTarget({ params: { target: other! } });
    expect(none.status === 200 && none.body.count).toBe(0);
  });

  it('never carries the phone, the order number or the last name', async () => {
    const o = await deliveredOrder();
    const r = await rated(o, 5, null);
    await t.db
      .update(reviews)
      .set({ published: true, publishedAt: T0 })
      .where(eq(reviews.id, r.id));
    const res = await o.client.reviews.forTarget({ params: { target: o.slugs[0]! } });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('998901234567');
    expect(json).not.toContain(String(o.number));
    expect(json).not.toContain('orderId');
  });

  it('counts and averages every published review and lists the latest few', async () => {
    await t.app.get(SettingsService).set('reviews.cardLimit', 2, { type: 'system' });
    const first = await deliveredOrder(ali, '998901234567', 1);
    const second = await deliveredOrder(vali, '998901112233', 1);
    for (const [i, [o, rating, user]] of (
      [
        [first, 5, ali],
        [second, 2, vali],
      ] as const
    ).entries()) {
      const r = await rated(o, rating, `c${rating}`, user);
      await t.db
        .update(reviews)
        .set({ published: true, publishedAt: new Date(T0.getTime() + i * HOUR) })
        .where(eq(reviews.id, r.id));
    }
    const res = await first.client.reviews.forTarget({ params: { target: first.slugs[0]! } });
    const body = res.status === 200 ? res.body : null;
    expect(body!.count).toBe(2);
    expect(body!.average).toBe(3.5);
    expect(body!.items.map((i) => i.rating)).toEqual([2, 5]); // newest published first
  });

  it('a Discovery set line puts the review on the set card; a builder set on its own', async () => {
    const o = await deliveredOrder();
    const comp = (await slugs(5)).map((s, i) => ({ fragranceId: i + 1, name: s, brand: 'x' }));
    await t.db.insert(orderLines).values({
      orderId: o.id,
      position: 5,
      kind: 'discovery_set',
      nameRu: 'Discovery set',
      nameUz: 'Discovery set',
      ml: 10,
      unitPrice: 1,
      regularUnitPrice: 1,
      qty: 1,
      lineTotal: 1,
      setComposition: comp,
    });
    const r = await rated(o, 5, 'Отличный набор');
    await t.db
      .update(reviews)
      .set({ published: true, publishedAt: T0 })
      .where(eq(reviews.id, r.id));
    const set = await o.client.reviews.forTarget({ params: { target: 'discovery-set' } });
    expect(set.status === 200 && set.body.count).toBe(1);
    const builder = await o.client.reviews.forTarget({ params: { target: 'builder-set' } });
    expect(builder.status === 200 && builder.body.count).toBe(0);
  });

  it('a fragrance inside a set shows the review too', async () => {
    const o = await deliveredOrder(ali, '998901234567', 1);
    const [inside] = (await slugs(8)).filter((s) => !o.slugs.includes(s)).slice(-1);
    const [f] = await t.db
      .select({ id: fragrances.id })
      .from(fragrances)
      .where(eq(fragrances.slug, inside!));
    const comp = [0, 1, 2, 3, 4].map((i) => ({
      fragranceId: i === 0 ? f!.id : 100000 + i,
      name: 'n',
      brand: 'b',
    }));
    await t.db.insert(orderLines).values({
      orderId: o.id,
      position: 5,
      kind: 'builder_set',
      nameRu: 'Свой набор',
      nameUz: 'Oʻz toʻplamim',
      ml: 10,
      unitPrice: 1,
      regularUnitPrice: 1,
      qty: 1,
      lineTotal: 1,
      setVolumeIds: [1, 2, 3, 4, 5],
      setComposition: comp,
    });
    const r = await rated(o, 5, null);
    await t.db
      .update(reviews)
      .set({ published: true, publishedAt: T0 })
      .where(eq(reviews.id, r.id));
    const res = await o.client.reviews.forTarget({ params: { target: inside! } });
    expect(res.status === 200 && res.body.count).toBe(1);
    const b = await o.client.reviews.forTarget({ params: { target: 'builder-set' } });
    expect(b.status === 200 && b.body.count).toBe(1);
  });

  it('needs a session, and an unknown fragrance is a 404', async () => {
    const o = await deliveredOrder();
    expect((await t.client.reviews.forTarget({ params: { target: o.slugs[0]! } })).status).toBe(
      401,
    );
    expect(
      (await o.client.reviews.forTarget({ params: { target: 'no-such-fragrance' } })).status,
    ).toBe(404);
  });

  it('serves a photo only while its review is published', async () => {
    const o = await deliveredOrder();
    const r = await rated(o, 5, null);
    t.edges.files.files.set('private/reviews/x.jpg', await jpeg());
    const [p] = await t.db
      .insert(reviewPhotos)
      .values({ reviewId: r.id, fileId: 'f', fileKey: 'private/reviews/x.jpg' })
      .returning();
    const url = `${t.baseUrl}/reviews/photos/${p!.publicKey}.jpg`;
    expect((await fetch(url)).status).toBe(404);
    await t.db
      .update(reviews)
      .set({ published: true, publishedAt: T0 })
      .where(eq(reviews.id, r.id));
    const ok = await fetch(url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    await t.db
      .update(reviews)
      .set({ published: false, publishedAt: null })
      .where(eq(reviews.id, r.id));
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(`${t.baseUrl}/reviews/photos/not-a-key.jpg`)).status).toBe(404);
  });
});

describe('the admin panel', () => {
  let owner: StaffSession;
  let manager: StaffSession;
  beforeEach(async () => {
    owner = await t.ownerSession();
    manager = await t.signInStaff('manager', MANAGER_WIDGET_USER);
  });

  async function seedThree() {
    const a = await deliveredOrder(ali, '998901234567', 1);
    const b = await deliveredOrder(vali, '998901112233', 2);
    const ra = await rated(a, 5, 'Супер');
    const rb = await rated(b, 2, 'Не понравился, копия', vali, new Date(T0.getTime() + 48 * HOUR));
    return { a, b, ra, rb };
  }

  it('is for staff only', async () => {
    expect((await t.client.admin.reviews.list({ query: {} })).status).toBe(401);
    const { ra } = await seedThree();
    expect(
      (
        await t.client.admin.reviews.setPublished({
          params: { id: ra.id },
          body: { published: true },
        })
      ).status,
    ).toBe(401);
  });

  it('lists every review, published or not, with the average, and shows a banned word as typed', async () => {
    await seedThree();
    const res = await manager.client.admin.reviews.list({ query: {} });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.total).toBe(2);
    expect(res.body.average).toBe(3.5);
    expect(res.body.publishedCount).toBe(0);
    expect(res.body.items.map((i) => i.rating)).toEqual([2, 5]);
    expect(res.body.items[0]).toMatchObject({
      comment: 'Не понравился, копия',
      phone: '+998901112233',
      published: false,
    });
    expect(res.body.items[0]!.items).toHaveLength(2);
    expect(res.body.items[0]!.orderNumber).toBeGreaterThan(0);
  });

  it('filters by rating, state and date', async () => {
    const { ra } = await seedThree();
    await owner.client.admin.reviews.setPublished({
      params: { id: ra.id },
      body: { published: true },
    });
    const q = async (query: object) => {
      const r = await owner.client.admin.reviews.list({ query: query as never });
      return r.status === 200 ? r.body : null;
    };
    expect((await q({ rating: 5 }))!.items).toHaveLength(1);
    expect((await q({ state: 'published' }))!.items.map((i) => i.id)).toEqual([ra.id]);
    expect((await q({ state: 'hidden' }))!.items).toHaveLength(1);
    // the first review is dated Nov 9, the second Nov 11 (Tashkent)
    expect((await q({ from: '2026-11-10' }))!.items).toHaveLength(1);
    expect((await q({ to: '2026-11-09' }))!.items).toHaveLength(1);
    expect((await q({ rating: 3 }))!.average).toBeNull();
    // the average covers every match, not the page
    expect((await q({ pageSize: 1 }))!.average).toBe(3.5);
  });

  it('publishes and hides, audited with the staff member, and the card follows', async () => {
    const { a, ra } = await seedThree();
    const pub = await manager.client.admin.reviews.setPublished({
      params: { id: ra.id },
      body: { published: true },
    });
    expect(pub.status === 200 && pub.body.published).toBe(true);
    const block = await a.client.reviews.forTarget({ params: { target: a.slugs[0]! } });
    expect(block.status === 200 && block.body.count).toBe(1);
    const hide = await owner.client.admin.reviews.setPublished({
      params: { id: ra.id },
      body: { published: false },
    });
    expect(hide.status === 200 && hide.body.published).toBe(false);
    const after = await a.client.reviews.forTarget({ params: { target: a.slugs[0]! } });
    expect(after.status === 200 && after.body.count).toBe(0);
    const log = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetType, 'review'), eq(auditLog.targetId, String(ra.id))));
    expect(log.map((l) => [l.action, l.actorType, l.actorId])).toEqual([
      ['review.published', 'staff', manager.staff.id],
      ['review.hidden', 'staff', owner.staff.id],
    ]);
    // setting the state it already has writes nothing more
    await owner.client.admin.reviews.setPublished({
      params: { id: ra.id },
      body: { published: false },
    });
    expect(
      await t.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.targetType, 'review'), eq(auditLog.targetId, String(ra.id)))),
    ).toHaveLength(2);
    expect(
      (
        await owner.client.admin.reviews.setPublished({
          params: { id: 99999 },
          body: { published: true },
        })
      ).status,
    ).toBe(404);
  });

  it('shows photos to staff, published or not, and to nobody else', async () => {
    const { ra } = await seedThree();
    t.edges.files.files.set('private/reviews/x.jpg', await jpeg());
    const [p] = await t.db
      .insert(reviewPhotos)
      .values({ reviewId: ra.id, fileId: 'f', fileKey: 'private/reviews/x.jpg' })
      .returning();
    const url = `${t.baseUrl}/admin/reviews/photos/${p!.id}`;
    expect((await fetch(url)).status).toBe(401);
    const ok = await fetch(url, { headers: { cookie: manager.cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('cache-control')).toContain('private');
    const list = await manager.client.admin.reviews.list({ query: {} });
    expect(list.status === 200 && list.body.items.find((i) => i.id === ra.id)!.photoIds).toEqual([
      p!.id,
    ]);
  });

  it('exports the filtered list to Excel', async () => {
    await seedThree();
    const url = `${t.baseUrl}/admin/reviews/export?rating=2`;
    expect((await fetch(url)).status).toBe(401);
    const res = await fetch(url, { headers: { cookie: manager.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
    const sheet = wb.worksheets[0]!;
    const rows = sheet.getSheetValues().slice(2) as unknown[][];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.join('|')).toContain('Не понравился, копия');
    expect(rows[0]!.join('|')).toContain('998901112233');
  });
});
