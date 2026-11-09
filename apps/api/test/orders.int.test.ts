import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  btsPoints,
  customers,
  eq,
  fragrances,
  orderLines,
  orders,
  outbox,
  regions,
  volumes,
} from '@lummi/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

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

const ali: TestUser = { id: 41, first_name: 'Ali', last_name: 'Valiyev', language_code: 'ru' };
const vali: TestUser = { id: 42, first_name: 'Vali', language_code: 'uz' };

const nowSec = () => Math.floor(t.edges.clock.now().getTime() / 1000);

/** A signed-in shopper; with `phone` they have shared their contact (ADR 0004). */
async function shopper(user: TestUser = ali, phone: string | null = '998901234567') {
  const { client } = await t.signIn(user);
  if (phone) {
    const proof = signContact({ botToken: TEST_BOT_TOKEN, userId: user.id, phone, authDate: nowSec() });
    const res = await client.me.shareContact({ body: { proof } });
    if (res.status !== 200) throw new Error(`contact: ${res.status}`);
  }
  const add = async (slug: string, ml: 10 | 30 | 50, qty = 1) => {
    const res = await client.cart.addLine({ body: { slug, ml, qty } });
    if (res.status !== 200) throw new Error(`add ${slug}: ${res.status}`);
    return res.body;
  };
  return { client, add };
}

async function slugs(n = 3) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id, fragranceId: volumes.fragranceId })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}

async function setStock(slug: string, ml: number, onHand: number) {
  const v = await volumeOf(slug, ml);
  await t.db.update(volumes).set({ onHand }).where(eq(volumes.id, v.id));
}

/** An active BTS point in Samarkand, its region's tariff set to `tariff`. */
async function samarkandPoint(tariff = 31_000) {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  await t.db.update(regions).set({ deliveryTariff: tariff }).where(eq(regions.id, region!.id));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  return { region: { ...region!, deliveryTariff: tariff }, point: point! };
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

function body(over: Partial<CreateOrderBody> & { confirmedTotal: number; pointId?: number }) {
  const { pointId, ...rest } = over;
  return {
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998 90 123 45 67',
    delivery: { kind: 'point' as const, pointId: pointId ?? 0 },
    consent: true,
    ...rest,
  } satisfies CreateOrderBody;
}

describe('createOrder', () => {
  it('creates an order «Ожидает оплаты» from the cart, priced with the point region tariff, and empties the ordered lines', async () => {
    const [s1, s2] = await slugs();
    const { region, point } = await samarkandPoint(31_000);
    const { client, add } = await shopper();
    await add(s1!, 10, 2);
    await add(s2!, 30);

    const checkout = await client.checkout.get({ query: { regionId: region.id } });
    expect(checkout.status).toBe(200);
    if (checkout.status !== 200) return;
    // 2 x 69 000 + 149 000 = 287 000: free delivery, whatever the tariff
    expect(checkout.body.quote).toMatchObject({ itemsSubtotal: 287_000, deliveryFee: 0, total: 287_000 });
    expect(checkout.body).toMatchObject({
      itemCount: 3,
      phone: '+998901234567',
      recipientName: 'Ali Valiyev',
      needsConsent: true,
    });

    const res = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 287_000, comment: 'Позвоните заранее' }),
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body).toMatchObject({
      number: 1001,
      status: 'awaiting_payment',
      recipient: { name: 'Ali Valiyev', phone: '+998901234567' },
      comment: 'Позвоните заранее',
      gift: { isGift: false, message: null },
      itemsSubtotal: 287_000,
      discount: null,
      deliveryFee: 0,
      thresholdBase: 'before',
      thresholdBaseAmount: 287_000,
      total: 287_000,
      amountDue: 287_000,
      delivery: {
        region: { ru: region.nameRu, uz: region.nameUz },
        point: { code: point.code, name: point.name, address: point.address, city: point.city },
        typed: null,
      },
    });
    expect(res.body.lines.map((l) => [l.slug, l.ml, l.qty, l.unitPrice, l.lineTotal])).toEqual([
      [s1, 10, 2, 69_000, 138_000],
      [s2, 30, 1, 149_000, 149_000],
    ]);
    // the reserve lives 12 h by default (setting orders.reserveTtlSeconds)
    expect(Date.parse(res.body.reserveUntil) - t.edges.clock.now().getTime()).toBe(12 * 3600_000);

    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines).toEqual([]);
  });

  it('prices delivery with the chosen point region tariff, not the saved delivery city', async () => {
    const [s1] = await slugs();
    const { region, point } = await samarkandPoint(31_000);
    const [tashkent] = (await t.db.select().from(regions)).filter((r) => r.code === 'tashkent-city');
    await t.db.update(regions).set({ deliveryTariff: 20_000 }).where(eq(regions.id, tashkent!.id));
    const { client, add } = await shopper();
    const [city] = await t.db
      .select({ city: btsPoints.city })
      .from(btsPoints)
      .where(and(eq(btsPoints.regionId, tashkent!.id), eq(btsPoints.active, true)))
      .limit(1);
    expect(
      (await client.me.setDeliveryCity({ body: { regionId: tashkent!.id, city: city!.city } }))
        .status,
    ).toBe(200);
    await add(s1!, 10);

    // without a point the saved city prices it; with the point, its region does
    const before = await client.checkout.get({ query: {} });
    expect(before.status === 200 && before.body.quote.deliveryFee).toBe(20_000);
    const checkout = await client.checkout.get({ query: { regionId: region.id } });
    expect(checkout.status === 200 && checkout.body.quote).toMatchObject({
      deliveryFee: 31_000,
      total: 100_000,
    });
    const res = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 100_000 }) });
    expect(res.status === 201 && [res.body.deliveryFee, res.body.total]).toEqual([31_000, 100_000]);
  });

  it('refuses a stale total with 409 and the new checkout, writes nothing, and takes the confirmed new total', async () => {
    const [s1] = await slugs();
    const { region, point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    // the shopper saw 69 000 + 25 000; the owner raises the price before they confirm
    const v = await volumeOf(s1!, 10);
    await t.db.update(volumes).set({ price: 79_000 }).where(eq(volumes.id, v.id));

    const stale = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) });
    expect(stale.status).toBe(409);
    if (stale.status !== 409) return;
    expect(stale.body.code).toBe('total_changed');
    expect(stale.body.checkout.quote).toMatchObject({ itemsSubtotal: 79_000, total: 104_000 });
    expect(stale.body.checkout.region?.id).toBe(region.id);
    expect((await client.orders.list()).body).toEqual([]);
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines).toHaveLength(1);

    const again = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 104_000 }) });
    expect(again.status === 201 && again.body.total).toBe(104_000);
  });

  it('refuses checkout without an account phone (403) and creates nothing', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint();
    const { client, add } = await shopper(ali, null);
    await add(s1!, 10);
    const checkout = await client.checkout.get({ query: {} });
    expect(checkout.status === 200 && checkout.body.phone).toBeNull();
    const res = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'phone_required' });
    expect((await client.orders.list()).body).toEqual([]);
  });

  it('needs a session', async () => {
    expect((await t.client.checkout.get({ query: {} })).status).toBe(401);
    expect((await t.client.orders.list()).status).toBe(401);
  });
});

describe('stock: the order is the reserve (ADR 0010)', () => {
  it('two concurrent orders for the last unit: exactly one wins, the other sees nothing left to order', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    await setStock(s1!, 50, 1);
    const a = await shopper(ali, '998901234567');
    const b = await shopper(vali, '998907654321');
    await a.add(s1!, 50);
    await b.add(s1!, 50);
    // both saw 219 000 free of delivery... below 250 000: 219 000 + 25 000
    const confirmed = { pointId: point.id, confirmedTotal: 244_000 };

    // Both requests run while order lines cannot be written yet, so each reads the stock before
    // either has reserved it: only the row lock on the volume keeps the second from selling it again.
    const results = await whileTableLocked('order_lines', () =>
      Promise.all([
        a.client.orders.create({ body: body(confirmed) }),
        b.client.orders.create({ body: body(confirmed) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost?.status === 409 && lost.body.code).toBe('nothing_to_order');
    expect(lost?.status === 409 && lost.body.checkout.quote.itemsSubtotal).toBe(0);

    const card = await a.client.catalog.fragrance({ params: { slug: s1! } });
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 50)?.available).toBe(0);
  });

  it('available drops by the ordered quantity on the card, the list and in another cart', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    await setStock(s1!, 10, 5);
    await setStock(s1!, 30, 0);
    await setStock(s1!, 50, 0);
    const buyer = await shopper();
    const other = await shopper(vali, '998907654321');
    await other.add(s1!, 10, 5);
    await buyer.add(s1!, 10, 3);
    const res = await buyer.client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 3 * 69_000 + 25_000 }),
    });
    expect(res.status).toBe(201);

    const card = await other.client.catalog.fragrance({ params: { slug: s1! } });
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(2);
    const cart = await other.client.cart.get();
    expect(cart.status === 200 && cart.body.lines[0]).toMatchObject({
      qty: 2,
      available: 2,
      limited: true,
    });

    // the last two go too: the list card shows the fragrance sold out
    await other.client.cart.setQuantity({
      params: { lineId: cart.status === 200 ? cart.body.lines[0]!.id : 0 },
      body: { qty: 2 },
    });
    const second = await other.client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 2 * 69_000 + 25_000 }),
    });
    expect(second.status).toBe(201);
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, s1!));
    const found = await other.client.catalog.search({ query: { q: f!.name } });
    expect(found.status === 200 && found.body.items.find((i) => i.slug === s1)?.soldOut).toBe(true);
  });

  it('later price changes never change an existing order snapshot', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 30, 2);
    const created = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 298_000 }),
    });
    expect(created.status).toBe(201);
    const v = await volumeOf(s1!, 30);
    await t.db.update(volumes).set({ price: 199_000, salePrice: 99_000 }).where(eq(volumes.id, v.id));
    await t.db.update(fragrances).set({ name: 'Renamed' }).where(eq(fragrances.slug, s1!));
    await t.db
      .update(btsPoints)
      .set({ address: 'Moved away', active: false })
      .where(eq(btsPoints.id, point.id));

    const order = await client.orders.get({ params: { number: 1001 } });
    expect(order.status).toBe(200);
    if (order.status !== 200 || created.status !== 201) return;
    expect(order.body).toEqual(created.body);
    expect(order.body.lines[0]).toMatchObject({ unitPrice: 149_000, lineTotal: 298_000 });
    expect(order.body.delivery.point?.address).toBe(point.address);
  });

  it('on hand set below the reserve is flagged in the admin on-hand list', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10, 4);
    expect(
      (await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 276_000 }) }))
        .status,
    ).toBe(201);
    const v = await volumeOf(s1!, 10);
    const manager = await t.managerSession();
    const res = await manager.client.admin.onHand.set({ params: { id: v.id }, body: { onHand: 2 } });
    expect(res.status === 200 && res.body).toMatchObject({
      onHand: 2,
      reserved: 4,
      available: 0,
      belowReserve: true,
    });
  });

  it('a builder set line reserves one 10 ml of each of its five fragrances', async () => {
    const five = await slugs(5);
    const vols = await Promise.all(five.map((s) => volumeOf(s, 10)));
    const { client } = await shopper();
    const [c] = await t.db.select({ id: customers.id }).from(customers).where(eq(customers.telegramId, ali.id));
    const { point, region } = await samarkandPoint();
    const [order] = await t.db
      .insert(orders)
      .values({
        customerId: c!.id,
        reserveUntil: t.edges.clock.now(),
        recipientName: 'Ali',
        recipientPhone: '+998901234567',
        regionId: region.id,
        regionNameRu: region.nameRu,
        regionNameUz: region.nameUz,
        btsPointId: point.id,
        pointCode: point.code,
        itemsSubtotal: 2 * 299_000,
        deliveryFee: 0,
        thresholdBase: 'before',
        thresholdBaseAmount: 2 * 299_000,
        total: 2 * 299_000,
        amountDue: 2 * 299_000,
      })
      .returning();
    await t.db.insert(orderLines).values({
      orderId: order!.id,
      position: 0,
      kind: 'builder_set',
      nameRu: 'Свой набор',
      nameUz: 'Oʻz toʻplamingiz',
      ml: 10,
      unitPrice: 299_000,
      regularUnitPrice: 299_000,
      qty: 2,
      lineTotal: 598_000,
      setVolumeIds: vols.map((v) => v.id),
    });
    for (const slug of five) {
      const card = await client.catalog.fragrance({ params: { slug } });
      expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(18);
    }
    // a cancelled order holds nothing
    await t.db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, order!.id));
    const card = await client.catalog.fragrance({ params: { slug: five[0]! } });
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(20);
  });
});

describe('what the order records', () => {
  it('stores consent with its time on the first order only', async () => {
    const [s1, s2] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    const refused = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 94_000, consent: false }),
    });
    expect(refused.status === 422 && refused.body.code).toBe('consent_required');

    const firstAt = t.edges.clock.now();
    expect(
      (await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) }))
        .status,
    ).toBe(201);
    const [c] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));
    expect(c!.dataConsentAt?.toISOString()).toBe(firstAt.toISOString());

    // the second order neither asks nor moves the time
    t.edges.clock.advance(60_000);
    await add(s2!, 10);
    const checkout = await client.checkout.get({ query: {} });
    expect(checkout.status === 200 && checkout.body.needsConsent).toBe(false);
    expect(
      (
        await client.orders.create({
          body: body({ pointId: point.id, confirmedTotal: 94_000, consent: false }),
        })
      ).status,
    ).toBe(201);
    const [again] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));
    expect(again!.dataConsentAt?.toISOString()).toBe(firstAt.toISOString());
  });

  it('writes the "order created" message to the outbox with «Открыть заказ», in the customer language', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper(vali, '998907654321');
    await add(s1!, 10);
    await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) });
    const rows = await t.db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chatId).toBe(vali.id);
    // 10:00 UTC + 12 h = 22:00 UTC = 03:00 Tashkent the next day
    expect(rows[0]!.text).toBe(
      '№ 1001 buyurtma rasmiylashtirildi ✨\nToʻlov summasi: 94 000 soʻm\nAtirlar 10-noyabr, 03:00 gacha band qilindi. Buyurtma holati doim «Buyurtmalar» boʻlimida koʻrinadi.',
    );
    expect(rows[0]!.options).toEqual({
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buyurtmani ochish', web_app: { url: 'https://miniapp.test.invalid/orders/1001' } }],
        ],
      },
    });
  });

  it('keeps a typed address flagged, with the region it was typed for', async () => {
    const [s1] = await slugs();
    const { region } = await samarkandPoint(27_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    const res = await client.orders.create({
      body: {
        ...body({ confirmedTotal: 96_000 }),
        delivery: { kind: 'typed', regionId: region.id, text: 'Ургут, рядом с базаром' },
      },
    });
    expect(res.status).toBe(201);
    expect(res.status === 201 && res.body.delivery).toEqual({
      region: { ru: region.nameRu, uz: region.nameUz },
      point: null,
      typed: 'Ургут, рядом с базаром',
    });
  });

  it('marks a gift with its greeting free of charge, within the length setting', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    const checkout = await client.checkout.get({ query: {} });
    expect(checkout.status === 200 && checkout.body.giftMessageMax).toBe(250);
    const tooLong = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 94_000, gift: true, giftMessage: 'a'.repeat(251) }),
    });
    expect(tooLong.status === 422 && tooLong.body.code).toBe('gift_message_too_long');

    const res = await client.orders.create({
      body: body({
        pointId: point.id,
        confirmedTotal: 94_000,
        gift: true,
        giftMessage: '  С днём рождения!  ',
      }),
    });
    expect(res.status === 201 && [res.body.gift, res.body.total]).toEqual([
      { isGift: true, message: 'С днём рождения!' },
      94_000,
    ]);
  });

  it('keeps no greeting on an order that is not a gift', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    const res = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 94_000, gift: false, giftMessage: 'Привет' }),
    });
    expect(res.status === 201 && res.body.gift).toEqual({ isGift: false, message: null });
  });

  it('refuses a hidden or unknown point and an unknown region (422), and an empty cart (409)', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    const empty = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 0 }) });
    expect(empty.status === 409 && empty.body.code).toBe('nothing_to_order');
    await add(s1!, 10);
    await t.db.update(btsPoints).set({ active: false }).where(eq(btsPoints.id, point.id));
    const hidden = await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) });
    expect(hidden.status === 422 && hidden.body.code).toBe('unknown_point');
    const region = await client.orders.create({
      body: { ...body({ confirmedTotal: 94_000 }), delivery: { kind: 'typed', regionId: 999, text: 'Где-то' } },
    });
    expect(region.status === 422 && region.body.code).toBe('unknown_region');
  });

  it('validates the recipient phone on the server: an Uzbek number only, stored as E.164', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10);
    // a body that fails the contract's schema is a 400 (outside the typed statuses)
    await expect(
      client.orders.create({
        body: body({ pointId: point.id, confirmedTotal: 94_000, recipientPhone: '+7 912 000 00 00' }),
      }),
    ).rejects.toThrow(/got: 400/);
    expect((await client.orders.list()).body).toEqual([]);
    const ok = await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 94_000, recipientPhone: '93 555-44-33' }),
    });
    expect(ok.status === 201 && ok.body.recipient.phone).toBe('+998935554433');
  });
});

describe('the «Заказы» tab', () => {
  it('lists the customer orders newest first, numbered from 1001, and opens each; another customer gets 404', async () => {
    const [s1, s2] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    await add(s1!, 10, 2);
    await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 163_000 }) });
    t.edges.clock.advance(60_000);
    await add(s2!, 30);
    await client.orders.create({
      body: body({ pointId: point.id, confirmedTotal: 174_000, gift: true }),
    });

    const list = await client.orders.list();
    expect(list.status === 200 && list.body.map((o) => [o.number, o.itemCount, o.total, o.isGift, o.status])).toEqual([
      [1002, 1, 174_000, true, 'awaiting_payment'],
      [1001, 2, 163_000, false, 'awaiting_payment'],
    ]);
    expect((await client.orders.get({ params: { number: 1002 } })).status).toBe(200);
    const stranger = await shopper(vali, '998907654321');
    expect((await stranger.client.orders.get({ params: { number: 1001 } })).status).toBe(404);
    expect((await stranger.client.orders.list()).body).toEqual([]);
  });

  it('shows the order in the app even when the bot may not write to the customer', async () => {
    const [s1] = await slugs();
    const { point } = await samarkandPoint(25_000);
    const { client, add } = await shopper();
    expect((await client.me.writeAccess({ body: { allowed: false } })).status).toBe(200);
    await add(s1!, 10);
    expect(
      (await client.orders.create({ body: body({ pointId: point.id, confirmedTotal: 94_000 }) }))
        .status,
    ).toBe(201);
    const list = await client.orders.list();
    expect(list.status === 200 && list.body.map((o) => o.number)).toEqual([1001]);
  });
});
