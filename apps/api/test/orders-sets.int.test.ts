import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateOrderBody } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import {
  and,
  btsPoints,
  discoverySet,
  eq,
  fragrances,
  orderLines,
  orders,
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

const ali: TestUser = { id: 61, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 62, first_name: 'Vali', language_code: 'uz' };

async function shopper(user: TestUser, phone: string) {
  const { client } = await t.signIn(user);
  const proof = signContact({
    botToken: TEST_BOT_TOKEN,
    userId: user.id,
    phone,
    authDate: Math.floor(t.edges.clock.now().getTime() / 1000),
  });
  const res = await client.me.shareContact({ body: { proof } });
  if (res.status !== 200) throw new Error(`contact: ${res.status}`);
  return client;
}

async function slugs(n: number) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

async function tenMl(slug: string) {
  const [v] = await t.db
    .select({ id: volumes.id, fragranceId: volumes.fragranceId })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, 10)));
  return v!;
}

async function samarkandPoint() {
  const [region] = (await t.db.select().from(regions)).filter((r) => r.nameRu.startsWith('Самарк'));
  const [point] = await t.db
    .select()
    .from(btsPoints)
    .where(and(eq(btsPoints.regionId, region!.id), eq(btsPoints.active, true)))
    .limit(1);
  return point!;
}

const orderBody = (pointId: number, confirmedTotal: number) =>
  ({
    recipientName: 'Ali Valiyev',
    recipientPhone: '+998 90 123 45 67',
    delivery: { kind: 'point', pointId },
    consent: true,
    idempotencyKey: randomUUID(),
    confirmedTotal,
  }) satisfies CreateOrderBody;

/** Runs `run` while another session holds an EXCLUSIVE lock on `table`: concurrent requests line up at their first write to it. */
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

describe('a Discovery set order (ADR 0009)', () => {
  it('snapshots the five fragrances and reserves from its own stock, never 10 ml', async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 3 });
    const before = await Promise.all((await slugs(8)).map(async (s) => (await tenMl(s)).id));
    const client = await shopper(ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const res = await client.orders.create({ body: orderBody(point.id, 2 * 299_000) });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({
      kind: 'discovery_set',
      qty: 2,
      unitPrice: 299_000,
      lineTotal: 598_000,
      name: { ru: 'Discovery set', uz: 'Discovery set' },
    });
    expect(res.body.lines[0]!.setComposition).toHaveLength(5);
    const [line] = await t.db.select().from(orderLines);
    expect(line!.setVolumeIds).toHaveLength(5);
    expect(line!.setComposition!.every((f) => f.brand.length > 0)).toBe(true);
    // its own stock: 3 - 2 left, the 10 ml bottles untouched
    const shop = await client.sets.discovery();
    expect(shop.status === 200 && shop.body.available).toBe(1);
    const card = await client.catalog.fragrance({ params: { slug: (await slugs(1))[0]! } });
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(20);
    expect(before.length).toBe(8);
  });

  it('two concurrent orders for the last set: exactly one wins', async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 1 });
    const a = await shopper(ali, '998901234567');
    const b = await shopper(vali, '998907654321');
    await a.cart.addDiscovery({ body: { qty: 1 } });
    await b.cart.addDiscovery({ body: { qty: 1 } });
    // 299 000 is over the free-delivery threshold: no delivery fee
    const results = await whileTableLocked('order_lines', () =>
      Promise.all([
        a.orders.create({ body: orderBody(point.id, 299_000) }),
        b.orders.create({ body: orderBody(point.id, 299_000) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost?.status === 409 && lost.body.code).toBe('nothing_to_order');
    expect(await t.db.select().from(orders)).toHaveLength(1);
    const shop = await a.sets.discovery();
    expect(shop.status === 200 && [shop.body.available, shop.body.soldOut]).toEqual([0, true]);
  });

  it('a cancelled order gives the boxes back', async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 1 });
    const client = await shopper(ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1 } });
    await client.orders.create({ body: orderBody(point.id, 299_000) });
    await t.db.update(orders).set({ status: 'cancelled' });
    const shop = await client.sets.discovery();
    expect(shop.status === 200 && shop.body.available).toBe(1);
  });
});

describe('a builder set order (ADR 0009)', () => {
  it('reserves one 10 ml of each of the five, per set unit', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await shopper(ali, '998901234567');
    await client.cart.addBuilder({ body: { slugs: five, qty: 2 } });
    const res = await client.orders.create({ body: orderBody(point.id, 2 * 299_000) });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines[0]).toMatchObject({ kind: 'builder_set', qty: 2 });
    for (const slug of five) {
      const card = await client.catalog.fragrance({ params: { slug } });
      expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(18);
    }
    // the Discovery set's own stock is untouched
    const shop = await client.sets.discovery();
    expect(shop.status === 200 && shop.body.available).toBe(10);
  });

  it('keeps its five fragrances as bought after they are edited', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await shopper(ali, '998901234567');
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 299_000) });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    const bought = res.body.lines[0]!.setComposition!.map((f) => f.name).sort();
    await t.db.update(fragrances).set({ name: 'Renamed', originalBrand: 'Other', hidden: true });
    const again = await client.orders.get({ params: { number: res.body.number } });
    expect(again.status).toBe(200);
    if (again.status !== 200) return;
    expect(again.body.lines[0]!.setComposition!.map((f) => f.name).sort()).toEqual(bought);
    expect(again.body.lines[0]!.setComposition!.every((f) => f.brand !== 'Other')).toBe(true);
  });

  it('two concurrent orders for the last 10 ml of one of the five: exactly one wins', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const v = await tenMl(five[2]!);
    await t.db.update(volumes).set({ onHand: 1 }).where(eq(volumes.id, v.id));
    const a = await shopper(ali, '998901234567');
    const b = await shopper(vali, '998907654321');
    await a.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await b.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const results = await whileTableLocked('order_lines', () =>
      Promise.all([
        a.orders.create({ body: orderBody(point.id, 299_000) }),
        b.orders.create({ body: orderBody(point.id, 299_000) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('a Discovery and a builder line in one order both go through', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await shopper(ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 2 * 299_000) });
    expect(res.status).toBe(201);
    expect(res.status === 201 && res.body.lines.map((l) => l.kind)).toEqual([
      'discovery_set',
      'builder_set',
    ]);
    expect(await t.db.select().from(orderLines)).toHaveLength(2);
  });
});
