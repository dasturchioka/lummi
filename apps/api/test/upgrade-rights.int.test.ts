import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody, FulfilBody, OrderStatus, SettingKey } from '@lummi/contracts';
import {
  and,
  asc,
  btsPoints,
  customers,
  eq,
  fragrances,
  inArray,
  orders,
  outbox,
  regions,
  upgradeRights,
  volumes,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { BirthdayCouponJob } from '../src/birthday/birthday-job';
import { seedCatalog } from '../src/catalog/seed';
import { OrderStatusService } from '../src/order-status/order-status.service';
import { ReceiptsService } from '../src/receipts/receipts.service';
import { WorkerRuntime } from '../src/worker/runtime';
import { shopper, whileLockedUntil } from './harness/orders';
import { payWithCredit, uniqueReceiptImage } from './harness/payments';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): Upgrade rights (#38, ADR 0003 0005 0007 0009) over HTTP. Every order reaches
 * «Доставлен» the way a manager takes it there: the admin panel's fulfilment steps (#33).
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
  // 15:00 in Tashkent on 9 November
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 81, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 82, first_name: 'Vali', language_code: 'uz' };

type Shopper = Awaited<ReturnType<typeof shopper>>;

/** One worker tick (every sweep, then the outbox) at the fake clock's "now". */
const tick = () => t.app.get(WorkerRuntime).tick();

/** Seed prices: 30 ml 149 000, 50 ml 219 000; 20 % off one bottle leaves 119 200 and 175 200. */
const SET_PRICES = [
  { ml: 30, price: 119_200, source: 'set', percent: 20 },
  { ml: 50, price: 175_200, source: 'set', percent: 20 },
] as const;

async function allSlugs() {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows.map((r) => r.slug).sort();
}

/** The checkout body for the cart as it is now, to a Samarkand point at the quoted total. */
async function checkoutBody(client: Shopper, extra: Partial<CreateOrderBody> = {}, item?: string) {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  const checkout = await client.checkout.get({ query: { regionId: region!.id, item } });
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

/** The Discovery set's five fragrances, as its page names them. */
async function discoverySlugs(client: Shopper) {
  const box = await client.sets.discovery();
  if (box.status !== 200) throw new Error(`discovery ${box.status}`);
  return box.body.fragrances.map((f) => f.slug!);
}

/** The full-size prices the fragrance card shows with the customer's upgrade right. */
async function rightPrices(client: Shopper, slug: string) {
  const card = await client.catalog.fragrance({ params: { slug } });
  if (card.status !== 200) throw new Error(`card ${card.status}`);
  return card.body.upgradeRightPrices.map(({ lastDay: _lastDay, ...p }) => p);
}

/**
 * The rights an order opened, in the order it opened them.
 * TODO(#38 after #30): read them from «Мои скидки» once it lists rights.
 */
async function rightsOf(number: number) {
  const { id } = await orderRow(number);
  return t.db
    .select()
    .from(upgradeRights)
    .where(eq(upgradeRights.sourceOrderId, id))
    .orderBy(asc(upgradeRights.id));
}

async function fragranceIds(slugs: string[]) {
  const rows = await t.db
    .select({ id: fragrances.id })
    .from(fragrances)
    .where(inArray(fragrances.slug, slugs));
  return rows.map((r) => r.id);
}

async function setSetting(key: SettingKey, value: unknown) {
  const owner = await t.ownerSession();
  const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
  if (res.status !== 200) throw new Error(`setting ${key}: ${res.status}`);
}

describe('opening on «Доставлен»', () => {
  it('a delivered Discovery set opens a right on each of its five fragrances, shown on their cards', async () => {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    const outside = (await allSlugs()).find((s) => !inBox.includes(s))!;
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const number = await placeOrder(client);

    // handed to BTS is not delivered: nothing yet
    await fulfilTo(number, 'handed_to_bts');
    expect(await rightPrices(client, inBox[0]!)).toEqual([]);

    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.fulfil({
      params: { number },
      body: { action: 'deliver', expectedStatus: 'handed_to_bts' },
    });
    expect(res.status).toBe(200);
    for (const slug of inBox) expect(await rightPrices(client, slug), slug).toEqual(SET_PRICES);
    expect(await rightPrices(client, outside)).toEqual([]);
    // the right is the shopper's own: another customer sees regular prices
    const other = await shopper(t, vali, '998907654321');
    expect(await rightPrices(other, inBox[0]!)).toEqual([]);
  });

  it('a builder set of two opens two rights; its 10 ml bottles never open single rights, even switched on', async () => {
    await setSetting('upgradeRights.single10ml.enabled', true);
    const client = await shopper(t, ali, '998901112233');
    const picked = (await allSlugs()).slice(10, 15);
    const add = await client.cart.addBuilder({ body: { slugs: picked, qty: 2 } });
    expect(add.status).toBe(200);
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');

    const rights = await rightsOf(number);
    expect(rights).toHaveLength(2);
    for (const r of rights) {
      expect(r.source).toBe('set');
      expect(r.fragrances.map((f) => f.fragranceId).sort()).toEqual(
        (await fragranceIds(picked)).sort(),
      );
    }
    for (const slug of picked) expect(await rightPrices(client, slug), slug).toEqual(SET_PRICES);
  });

  it('a single 10 ml bottle opens nothing while its source is off (the default)', async () => {
    const client = await shopper(t, ali, '998901112233');
    const [slug] = await allSlugs();
    await client.cart.addLine({ body: { slug: slug!, ml: 10, qty: 1 } });
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');
    expect(await rightsOf(number)).toEqual([]);
    expect(await rightPrices(client, slug!)).toEqual([]);
  });

  it('switched on, one right per fragrance bought in 10 ml, however many bottles; none for 30 or 50 ml', async () => {
    await setSetting('upgradeRights.single10ml.enabled', true);
    await setSetting('upgradeRights.single10ml.percent', 10);
    const client = await shopper(t, ali, '998901112233');
    const [a, b, c] = await allSlugs();
    await client.cart.addLine({ body: { slug: a!, ml: 10, qty: 3 } });
    await client.cart.addLine({ body: { slug: b!, ml: 10, qty: 1 } });
    await client.cart.addLine({ body: { slug: c!, ml: 30, qty: 1 } });
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');

    const rights = await rightsOf(number);
    expect(rights.map((r) => [r.source, r.fragrances.map((f) => f.fragranceId)])).toEqual([
      ['single_10ml', await fragranceIds([a!])],
      ['single_10ml', await fragranceIds([b!])],
    ]);
    // 10 % off 149 000 and 219 000
    expect(await rightPrices(client, a!)).toEqual([
      { ml: 30, price: 134_100, source: 'single_10ml', percent: 10 },
      { ml: 50, price: 197_100, source: 'single_10ml', percent: 10 },
    ]);
    expect(await rightPrices(client, c!)).toEqual([]);
  });
});

describe('settings per source (set: 20 %, 30 days, on)', () => {
  it('the set right runs 30 Tashkent days from delivery, through the whole last day', async () => {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const number = await placeOrder(client);
    // delivered 9 November, 15:00 Tashkent
    await fulfilTo(number, 'delivered');
    const card = await client.catalog.fragrance({ params: { slug: inBox[0]! } });
    expect(card.status === 200 && card.body.upgradeRightPrices.map((p) => p.lastDay)).toEqual([
      '2026-12-09',
      '2026-12-09',
    ]);
    // still on at 23:59 Tashkent on 9 December, gone at midnight (a month later: a new session)
    t.edges.clock.set(new Date('2026-12-09T18:59:59Z'));
    const later = (await t.signIn(ali)).client;
    expect(await rightPrices(later, inBox[0]!)).toEqual(SET_PRICES);
    t.edges.clock.set(new Date('2026-12-09T19:00:00Z'));
    expect(await rightPrices(later, inBox[0]!)).toEqual([]);
  });

  it('percent and term are read when the right opens and stay with it; switched off, a set opens none', async () => {
    await setSetting('upgradeRights.set.percent', 25);
    await setSetting('upgradeRights.set.validityDays', 10);
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const first = await placeOrder(client);
    await fulfilTo(first, 'delivered');
    // the owner changes the terms and switches the source off afterwards: the open right keeps its own
    await setSetting('upgradeRights.set.percent', 5);
    await setSetting('upgradeRights.set.enabled', false);
    const card = await client.catalog.fragrance({ params: { slug: inBox[0]! } });
    expect(card.status === 200 && card.body.upgradeRightPrices).toEqual([
      // 25 % off 149 000 = 37 250; off 219 000 = 54 750
      { ml: 30, price: 111_750, source: 'set', percent: 25, lastDay: '2026-11-19' },
      { ml: 50, price: 164_250, source: 'set', percent: 25, lastDay: '2026-11-19' },
    ]);

    await client.cart.addDiscovery({ body: { qty: 1 } });
    const second = await placeOrder(client);
    await fulfilTo(second, 'delivered');
    expect(await rightsOf(second)).toEqual([]);
  });
});

describe('the card price (TZ §3.4 «Отображение», ADR 0008)', () => {
  it('a marked-down volume shows only its sale price, unless the setting lets the right apply to it', async () => {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    await fulfilTo(await placeOrder(client), 'delivered');
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, inBox[0]!));
    await t.db
      .update(volumes)
      .set({ salePrice: 129_000 })
      .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, 30)));

    expect(await rightPrices(client, inBox[0]!)).toEqual([SET_PRICES[1]]);

    await setSetting('pricing.discountsApplyToMarkedDown', {
      upgradeRight: true,
      birthdayCoupon: false,
    });
    // 20 % off the sale price 129 000 = 25 800
    expect(await rightPrices(client, inBox[0]!)).toEqual([
      { ml: 30, price: 103_200, source: 'set', percent: 20 },
      SET_PRICES[1],
    ]);
  });
});

describe('the source order cancelled or returned (TZ §3.4: the right never appears or is closed)', () => {
  it('a set order cancelled before delivery opens nothing', async () => {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const number = await placeOrder(client);
    await fulfilTo(number, 'handed_to_bts');
    const manager = await t.managerSession();
    const res = await manager.client.admin.orders.cancel({
      params: { number },
      body: { expectedStatus: 'handed_to_bts', reason: 'not_collected_at_bts' },
    });
    expect(res.status).toBe(200);
    expect(await rightsOf(number)).toEqual([]);
    expect(await rightPrices(client, inBox[0]!)).toEqual([]);
  });

  it('a returned set order closes the rights it opened (#40 adds the admin route; the move is #24’s)', async () => {
    const client = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const number = await placeOrder(client);
    await fulfilTo(number, 'delivered');
    expect(await rightsOf(number)).toHaveLength(2);

    const manager = await t.managerSession();
    const out = await t.app
      .get(OrderStatusService)
      .transition(
        (await orderRow(number)).id,
        'return',
        { type: 'staff', id: manager.staff.id },
        'delivered',
        { reason: 'Не подошёл аромат', lines: [{ position: 0, backToStock: true }] },
      );
    expect(out.kind).toBe('done');
    expect(await rightPrices(client, inBox[0]!)).toEqual([]);
    expect((await rightsOf(number)).every((r) => r.closedAt !== null)).toBe(true);
  });
});

describe('reminders (TZ §3.4: 7 days and 1 day before the end, when unused)', () => {
  // delivered 9 November: the last day is 9 December; reminders at 10:00 Tashkent (05:00 UTC) on
  // 2 December (7 days left) and 8 December (1 day left)
  const FIRST = new Date('2026-12-02T05:00:00Z');
  const LAST = new Date('2026-12-08T05:00:00Z');
  const MIN = 60_000;

  /** Reminder messages queued so far, oldest first. */
  async function reminders() {
    const rows = await t.db.select().from(outbox).orderBy(asc(outbox.id));
    return rows.filter((r) => /Напоминаем|Eslatma/.test(r.text));
  }

  async function deliveredSet(user: TestUser, phone: string) {
    const client = await shopper(t, user, phone);
    const inBox = await discoverySlugs(client);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    await fulfilTo(await placeOrder(client), 'delivered');
    const names = (await client.sets.discovery()).body as { fragrances: { name: string }[] };
    return { client, inBox, names: names.fragrances.map((f) => f.name) };
  }

  it('sends each once, at 10:00 Tashkent, in the customer language, naming the five fragrances', async () => {
    const { names } = await deliveredSet(vali, '998907654321');
    const at = async (instant: Date) => {
      t.edges.clock.set(instant);
      await tick();
      await tick();
    };
    await at(new Date(FIRST.getTime() - MIN));
    expect(await reminders()).toHaveLength(0);
    await at(FIRST);
    await at(new Date(FIRST.getTime() + 3 * MIN));
    const first = await reminders();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      chatId: vali.id,
      text: `Eslatma: toʻplam uchun −20% chegirma 9-dekabr kuni oxirigacha amal qiladi ⏳\nU toʻplamdagi istalgan iforning bitta toʻliq flakoniga: ${names.join(', ')}.`,
      options: {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Doʻkonni ochish', web_app: { url: 'https://miniapp.test.invalid/' } }],
          ],
        },
      },
    });

    await at(new Date(LAST.getTime() - MIN));
    expect(await reminders()).toHaveLength(1);
    await at(LAST);
    await at(new Date(LAST.getTime() + 60 * MIN));
    expect(await reminders()).toHaveLength(2);
    // past the end: nothing more
    await at(new Date('2026-12-10T05:00:00Z'));
    expect(await reminders()).toHaveLength(2);
  });

  it('a worker that was down past the last reminder sends only the last one', async () => {
    await deliveredSet(ali, '998901112233');
    t.edges.clock.set(new Date(LAST.getTime() + 2 * 3600_000));
    await tick();
    const sent = await reminders();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(
      /^Напоминаем: скидка за набор −20% действует до 9 декабря включительно ⏳\n/,
    );
  });

  it('a blocked bot gets no message, and the right stays on the card', async () => {
    const { client, inBox } = await deliveredSet(ali, '998901112233');
    await t.db.update(customers).set({ botBlocked: true }).where(eq(customers.telegramId, ali.id));
    t.edges.clock.set(FIRST);
    await tick();
    t.edges.clock.set(LAST);
    await tick();
    expect(await reminders()).toHaveLength(0);
    const later = (await t.signIn(ali)).client;
    expect(await rightPrices(later, inBox[0]!)).toEqual(SET_PRICES);
    void client;
  });

  it('follow the settings: days before the end and the hour', async () => {
    await setSetting('upgradeRights.firstReminderDays', 3);
    await setSetting('upgradeRights.lastReminderDays', 0);
    await setSetting('upgradeRights.reminderHour', 18);
    await deliveredSet(ali, '998901112233');
    // 6 December 18:00 Tashkent = 13:00 UTC; the last day itself, 9 December, at 18:00
    t.edges.clock.set(new Date('2026-12-06T12:59:00Z'));
    await tick();
    expect(await reminders()).toHaveLength(0);
    t.edges.clock.set(new Date('2026-12-06T13:00:00Z'));
    await tick();
    expect(await reminders()).toHaveLength(1);
    t.edges.clock.set(new Date('2026-12-09T13:00:00Z'));
    await tick();
    expect(await reminders()).toHaveLength(2);
  });

  it('a right shorter than the first reminder never gets that one', async () => {
    await setSetting('upgradeRights.set.validityDays', 5);
    await deliveredSet(ali, '998901112233');
    // last day 14 November: the 7-days-left moment (7 November) was before it opened
    t.edges.clock.set(new Date('2026-11-12T06:00:00Z'));
    await tick();
    expect(await reminders()).toHaveLength(0);
    t.edges.clock.set(new Date('2026-11-13T05:00:00Z'));
    await tick();
    expect(await reminders()).toHaveLength(1);
  });
});

describe('the right in the cart and the order (ADR 0002, 0005, 0007)', () => {
  /** Ali, whose Discovery set was delivered on 9 November: one right on its five, through 9 December. */
  async function withRight() {
    const s = await shopper(t, ali, '998901112233');
    const inBox = await discoverySlugs(s);
    const outside = (await allSlugs()).filter((x) => !inBox.includes(x));
    await s.cart.addDiscovery({ body: { qty: 1 } });
    const source = await placeOrder(s);
    await fulfilTo(source, 'delivered');
    const [right] = await rightsOf(source);
    return { s, inBox, outside, right: right!, source };
  }
  async function add(c: Shopper, slug: string, ml: 10 | 30 | 50, qty = 1) {
    const res = await c.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug}: ${res.status}`);
  }
  async function quoteOf(c: Shopper) {
    const cart = await c.cart.get();
    if (cart.status !== 200) throw new Error(`cart ${cart.status}`);
    return cart.body.quote;
  }
  async function buyNow(c: Shopper, item: string) {
    const res = await c.orders.create({ body: await checkoutBody(c, { item }, item) });
    if (res.status !== 201) throw new Error(`order ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  it('discounts one full-size bottle of a covered fragrance by 20 %, delivery left out', async () => {
    const { s, inBox, right } = await withRight();
    await add(s, inBox[0]!, 30, 2);
    expect(await quoteOf(s)).toMatchObject({
      itemsSubtotal: 298_000,
      // one bottle: 20 % of 149 000
      discount: { type: 'upgrade_right', id: right.id, source: 'set', amount: 29_800 },
      thresholdBase: 'before',
      deliveryFee: 0,
      total: 268_200,
    });
  });

  it('covers only its five fragrances, and never a 10 ml', async () => {
    const { s, inBox, outside } = await withRight();
    await add(s, outside[0]!, 50);
    await add(s, inBox[0]!, 10);
    expect(await quoteOf(s)).toMatchObject({ itemsSubtotal: 288_000, discount: null });
  });

  it('the free-delivery threshold is counted before the right’s discount', async () => {
    const { s, inBox, outside } = await withRight();
    // 219 000 + 69 000 = 288 000 reaches 250 000; less 43 800 it would not
    await add(s, inBox[0]!, 50);
    await add(s, outside[0]!, 10);
    expect(await quoteOf(s)).toMatchObject({
      itemsSubtotal: 288_000,
      discount: { type: 'upgrade_right', amount: 43_800 },
      thresholdBaseAmount: 288_000,
      deliveryFee: 0,
      total: 244_200,
    });
  });

  it('an entered promo code wins; the right stays the customer’s', async () => {
    const { s, inBox, right } = await withRight();
    const owner = await t.ownerSession();
    const created = await owner.client.admin.promoCodes.create({
      body: {
        code: 'BLOGER10',
        kind: 'percent',
        percent: 10,
        amount: null,
        maxDiscount: null,
        expiresOn: null,
        minOrderTotal: null,
        totalLimit: null,
        perCustomerLimit: null,
        newCustomersOnly: false,
        appliesToMarkedDown: false,
        active: true,
      },
    });
    expect(created.status).toBe(201);
    await add(s, inBox[0]!, 50);
    await s.cart.applyPromoCode({ body: { code: 'BLOGER10' } });
    expect(await quoteOf(s)).toMatchObject({
      discount: { type: 'promo_code', code: 'BLOGER10', amount: 21_900 },
      total: 222_100,
      alternatives: [
        { discount: { type: 'upgrade_right', id: right.id, amount: 43_800 }, total: 200_200 },
      ],
    });
    const order = await placeOrder(s);
    expect((await orderRow(order)).discount).toMatchObject({ type: 'promo_code' });
    expect(await rightPrices(s, inBox[0]!)).toEqual(SET_PRICES);
  });

  it('without a code the server picks the lowest total including delivery: the right over a bigger birthday coupon', async () => {
    const { s, inBox, outside, right } = await withRight();
    // born 1 December: the coupon (20 % of items, threshold after it) arrives 28 November at 10:00
    expect(
      (await s.me.setBirthDate({ body: { birthDate: '1996-12-01', consent: true } })).status,
    ).toBe(200);
    t.edges.clock.set(new Date('2026-11-28T05:00:00Z'));
    await t.app.get(BirthdayCouponJob).run();
    const later = (await t.signIn(ali)).client;

    // 219 000 + 69 000: the right takes 43 800 and delivery stays free (244 200); the coupon takes
    // 57 600, but 230 400 is under the threshold, so delivery comes back (255 400)
    await add(later, inBox[0]!, 50);
    await add(later, outside[0]!, 10);
    expect(await quoteOf(later)).toMatchObject({
      discount: { type: 'upgrade_right', id: right.id, amount: 43_800 },
      total: 244_200,
      alternatives: [{ discount: { type: 'birthday_coupon', amount: 57_600 }, total: 255_400 }],
    });

    // with more in the cart the coupon’s 20 % of everything is cheaper overall
    await add(later, outside[1]!, 50);
    expect(await quoteOf(later)).toMatchObject({
      itemsSubtotal: 507_000,
      discount: { type: 'birthday_coupon', amount: 100_000 },
      total: 407_000,
    });
  });

  it('the order holds it: the snapshot carries it, the card and the next cart no longer have it', async () => {
    const { s, inBox, right, source } = await withRight();
    await add(s, inBox[0]!, 50);
    const number = await placeOrder(s);
    const row = await orderRow(number);
    expect(row).toMatchObject({
      discount: { type: 'upgrade_right', id: right.id, source: 'set', amount: 43_800 },
      total: 200_200,
    });
    expect((await rightsOf(source))[0]).toMatchObject({ usedByOrderId: row.id });
    expect(await rightPrices(s, inBox[1]!)).toEqual([]);
    await add(s, inBox[1]!, 50);
    expect(await quoteOf(s)).toMatchObject({ discount: null });
  });

  it('«Купить сейчас» takes it too', async () => {
    const { s, inBox, right } = await withRight();
    const order = await buyNow(s, `volume:${inBox[2]}:30`);
    expect(order.discount).toMatchObject({ type: 'upgrade_right', id: right.id, amount: 29_800 });
  });

  it('two concurrent orders cannot both use it: one holds it, the other gets 409 with the new quote', async () => {
    const { s, inBox, right } = await withRight();
    const bodies = [
      await checkoutBody(s, { item: `volume:${inBox[0]}:50` }, `volume:${inBox[0]}:50`),
      await checkoutBody(s, { item: `volume:${inBox[1]}:50` }, `volume:${inBox[1]}:50`),
    ] as const;
    expect(bodies.map((b) => b.confirmedDiscount)).toMatchObject([
      { type: 'upgrade_right', id: right.id },
      { type: 'upgrade_right', id: right.id },
    ]);
    const results = await whileLockedUntil(t, 'upgrade_rights', 2, () =>
      Promise.all([s.orders.create({ body: bodies[0] }), s.orders.create({ body: bodies[1] })]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 201)).toMatchObject({
      body: { discount: { type: 'upgrade_right', id: right.id, amount: 43_800 } },
    });
    expect(results.find((r) => r.status === 409)).toMatchObject({
      body: { code: 'total_changed', checkout: { quote: { discount: null, total: 244_000 } } },
    });
  });

  it('a cancel gives it back within its term; past the term it is lost', async () => {
    const { s, inBox, right, source } = await withRight();
    await add(s, inBox[0]!, 50);
    const first = await placeOrder(s);
    const cancel = (c: Shopper, number: number) =>
      c.orders.cancel({ params: { number }, body: { expectedStatus: 'awaiting_payment' } });
    expect((await cancel(s, first)).status).toBe(200);
    expect(await rightPrices(s, inBox[0]!)).toEqual(SET_PRICES);

    // 9 December, 23:00 Tashkent: the last hour of the right
    t.edges.clock.set(new Date('2026-12-09T18:00:00Z'));
    const later = (await t.signIn(ali)).client;
    await add(later, inBox[0]!, 50);
    const second = await placeOrder(later);
    expect((await orderRow(second)).discount).toMatchObject({
      type: 'upgrade_right',
      id: right.id,
    });
    // cancelled at 00:30 on 10 December: the right ended meanwhile, so it stays with that order
    t.edges.clock.set(new Date('2026-12-09T19:30:00Z'));
    expect((await cancel((await t.signIn(ali)).client, second)).status).toBe(200);
    expect((await rightsOf(source))[0]).toMatchObject({
      usedByOrderId: (await orderRow(second)).id,
    });
  });

  it('a returned set order closes the right it opened; an order that already used it keeps its discount', async () => {
    const { s, inBox, right, source } = await withRight();
    await add(s, inBox[0]!, 50);
    const used = await placeOrder(s);
    const manager = await t.managerSession();
    const out = await t.app
      .get(OrderStatusService)
      .transition(
        (await orderRow(source)).id,
        'return',
        { type: 'staff', id: manager.staff.id },
        'delivered',
        { reason: 'Не подошёл аромат', lines: [{ position: 0, backToStock: true }] },
      );
    expect(out.kind).toBe('done');
    expect((await orderRow(used)).discount).toMatchObject({ type: 'upgrade_right', id: right.id });
    // cancelling the order that used it does not bring a closed right back
    await s.orders.cancel({
      params: { number: used },
      body: { expectedStatus: 'awaiting_payment' },
    });
    expect(await rightPrices(s, inBox[0]!)).toEqual([]);
    await add(s, inBox[0]!, 50);
    expect(await quoteOf(s)).toMatchObject({ discount: null });
  });

  it('no reminder for a right an order holds', async () => {
    const { s, inBox } = await withRight();
    await add(s, inBox[0]!, 50);
    // paid, so the reserve sweep does not cancel it (a cancel would give the right back)
    await fulfilTo(await placeOrder(s), 'payment_confirmed');
    t.edges.clock.set(new Date('2026-12-02T05:00:00Z'));
    await tick();
    t.edges.clock.set(new Date('2026-12-08T05:00:00Z'));
    await tick();
    const rows = await t.db.select().from(outbox);
    expect(rows.filter((r) => /Напоминаем/.test(r.text))).toEqual([]);
  });
});
