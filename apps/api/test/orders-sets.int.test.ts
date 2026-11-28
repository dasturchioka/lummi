import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverySet, eq, fragrances, orderLines, orders, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import {
  orderBody,
  samarkandPoint as pointOf,
  shopper,
  slugs as slugsOf,
  tenMl as tenMlOf,
  whileTableLocked as lockedWhile,
} from './harness/orders';
import { giftSampleOff } from './harness/gift-sample';
import { FILL_UL, stockBottles } from './harness/stock';
import { createTestApp, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

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
  await t.seedCatalog();
  // the seed's concentrate would give each first order a 5 ml sample; not what these tests are about
  await giftSampleOff(t);
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 61, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 62, first_name: 'Vali', language_code: 'uz' };

const signedUp = (user: TestUser, phone: string) => shopper(t, user, phone);
const slugs = (n: number) => slugsOf(t, n);
const tenMl = (slug: string) => tenMlOf(t, slug);
const samarkandPoint = () => pointOf(t);
const whileTableLocked = <T>(table: string, run: () => Promise<T>) => lockedWhile(t, table, run);

/**
 * 10 ml fills of this fragrance held by orders, as the admin stock list shows its reserve in ml
 * (ADR 0043): these tests hold nothing else of it.
 */
async function reservedOf(slug: string) {
  const manager = await t.managerSession();
  const { fragranceId } = await tenMl(slug);
  // the list pages by fragrance: find the fragrance's own page by its name
  const [f] = await t.db
    .select({ name: fragrances.name })
    .from(fragrances)
    .where(eq(fragrances.id, fragranceId));
  const res = await manager.client.admin.stock.list({ query: { q: f!.name } });
  if (res.status !== 200) throw new Error(`stock list: ${res.status}`);
  const row = res.body.fragrances.find((r) => r.fragranceId === fragranceId);
  return row && Math.round(row.reservedMl * 1000) / FILL_UL[10];
}

describe('a Discovery set order (ADR 0009)', () => {
  it('snapshots the five fragrances and reserves from its own stock, never 10 ml', async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 3 });
    const client = await signedUp(ali, '998901234567');
    // the 10 ml bottles of the fragrances that are in the box: none of them may move
    const box = await client.sets.discovery();
    if (box.status !== 200) throw new Error('discovery');
    const inBox = box.body.fragrances.map((f) => f.slug!);
    const before = await Promise.all(inBox.map(async (s) => reservedOf(s)));
    expect(inBox).toHaveLength(5);
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
    // the snapshot: the five chosen, in the owner's order, and no 10 ml volumes
    expect(res.body.lines[0]!.setComposition!.map((f) => f.name)).toEqual(
      box.body.fragrances.map((f) => f.name),
    );
    const [line] = await t.db.select().from(orderLines);
    expect(line!.setVolumeIds).toBeNull();
    expect(line!.setComposition).toHaveLength(5);
    // its own stock: 3 - 2 left; the 10 ml of the box's fragrances unchanged
    const after = await client.sets.discovery();
    expect(after.status === 200 && after.body.available).toBe(1);
    expect(await Promise.all(inBox.map((s) => reservedOf(s)))).toEqual(before);
    const card = await client.catalog.fragrance({ params: { slug: inBox[0]! } });
    // the seed's 1 000 ml of concentrate, untouched: 97 fills of 10 ml (ADR 0043)
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(97);
  });

  it('a composition fragrance with no 10 ml still checks out (the box holds its own bottles)', async () => {
    const point = await samarkandPoint();
    const client = await signedUp(ali, '998901234567');
    const box = await client.sets.discovery();
    if (box.status !== 200) throw new Error('discovery');
    const v = await tenMl(box.body.fragrances[2]!.slug!);
    await t.db.delete(volumes).where(eq(volumes.id, v.id));
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 299_000) });
    expect(res.status).toBe(201);
    expect(res.status === 201 && res.body.lines[0]!.setComposition).toHaveLength(5);
  });

  it('two concurrent orders for the last set: exactly one wins', async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 1 });
    const a = await signedUp(ali, '998901234567');
    const b = await signedUp(vali, '998907654321');
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
    const client = await signedUp(ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 299_000) });
    expect(res.status).toBe(201);
    const held = await client.sets.discovery();
    expect(held.status === 200 && held.body.available).toBe(0);
    await t.db.update(orders).set({ status: 'cancelled' });
    const back = await client.sets.discovery();
    expect(back.status === 200 && back.body.available).toBe(1);
  });
});

describe('a builder set order (ADR 0009)', () => {
  it('reserves one 10 ml of each of the five, per set unit', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await signedUp(ali, '998901234567');
    await client.cart.addBuilder({ body: { slugs: five, qty: 2 } });
    const res = await client.orders.create({ body: orderBody(point.id, 2 * 299_000) });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines[0]).toMatchObject({ kind: 'builder_set', qty: 2 });
    // two 10 ml fills of each (20.6 ml) held: 979.4 ml fill 95 (ADR 0043)
    for (const slug of five) {
      const card = await client.catalog.fragrance({ params: { slug } });
      expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(95);
    }
    // the Discovery set's own stock is untouched
    const shop = await client.sets.discovery();
    expect(shop.status === 200 && shop.body.available).toBe(10);
  });

  it('keeps its five fragrances as bought after they are edited', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await signedUp(ali, '998901234567');
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 299_000) });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    const [line] = await t.db.select().from(orderLines);
    const snapshot = line!.setComposition!;
    expect(snapshot).toHaveLength(5);
    // the ids are the five picked, and each name and brand is what it was when bought
    const rows = await t.db.select().from(fragrances);
    for (const f of snapshot) {
      const row = rows.find((r) => r.id === f.fragranceId)!;
      expect(five).toContain(row.slug);
      expect([f.name, f.brand]).toEqual([row.name, row.originalBrand]);
    }
    expect(new Set(snapshot.map((f) => f.fragranceId)).size).toBe(5);
    await t.db.update(fragrances).set({ name: 'Renamed', originalBrand: 'Other', hidden: true });
    const again = await client.orders.get({ params: { number: res.body.number } });
    expect(again.status).toBe(200);
    if (again.status !== 200) return;
    expect(again.body.lines[0]!.setComposition).toEqual(
      snapshot.map(({ name, brand }) => ({ name, brand })),
    );
  });

  it('two concurrent orders for the last 10 ml of one of the five: exactly one wins and it is reserved once', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    // one 10 ml fill of it left (ADR 0043)
    await stockBottles(t, five[2]!, 10, 1);
    const a = await signedUp(ali, '998901234567');
    const b = await signedUp(vali, '998907654321');
    await a.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await b.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const results = await whileTableLocked('order_lines', () =>
      Promise.all([
        a.orders.create({ body: orderBody(point.id, 299_000) }),
        b.orders.create({ body: orderBody(point.id, 299_000) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await t.db.select().from(orders)).toHaveLength(1);
    expect(await reservedOf(five[2]!)).toBe(1);
  });

  it('a builder order shows in the builder offer, another cart and the admin stock', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    // one 10 ml fill of it left (ADR 0043)
    await stockBottles(t, five[1]!, 10, 1);
    const a = await signedUp(ali, '998901234567');
    const b = await signedUp(vali, '998907654321');
    await b.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await a.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    expect((await a.orders.create({ body: orderBody(point.id, 299_000) })).status).toBe(201);
    // the builder no longer offers the fragrance whose last 10 ml is taken
    const offer = await b.sets.builder();
    expect(offer.status === 200 && offer.body.options.map((o) => o.slug)).not.toContain(five[1]);
    // the other customer's set line is unavailable
    const cart = await b.cart.get();
    expect(cart.status === 200 && cart.body.lines[0]).toMatchObject({
      soldOut: true,
      available: 0,
    });
    // and the admin sees the reserve on every one of the five
    for (const slug of five) expect(await reservedOf(slug)).toBe(1);
  });

  it('a Discovery and a builder line in one order both go through', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    const client = await signedUp(ali, '998901234567');
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

describe('one 10 ml shared by several lines of one order (ADR 0010)', () => {
  it('the last 10 ml in a volume line and a builder set is reserved once, and the cart shows the second line unavailable', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    // one 10 ml fill of it left (ADR 0043)
    await stockBottles(t, five[0]!, 10, 1);
    const client = await signedUp(ali, '998901234567');
    await client.cart.addLine({ body: { slug: five[0]!, ml: 10, qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    // the builder set no longer fits: it shows like a sold-out line and the sums leave it out
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines.map((l) => [l.kind, l.soldOut])).toEqual([
      ['volume', false],
      ['builder_set', true],
    ]);
    const checkout = await client.checkout.get({ query: {} });
    expect(checkout.status).toBe(200);
    if (checkout.status !== 200) return;
    const res = await client.orders.create({
      body: orderBody(point.id, checkout.body.quote.total),
    });
    expect(res.status).toBe(201);
    expect(res.status === 201 && res.body.lines.map((l) => l.kind)).toEqual(['volume']);
    expect(await reservedOf(five[0]!)).toBe(1);
  });

  it('two builder sets sharing a fragrance with one unit left reserve it once', async () => {
    const six = await slugs(6);
    const point = await samarkandPoint();
    // one 10 ml fill of it left (ADR 0043)
    await stockBottles(t, six[1]!, 10, 1);
    const client = await signedUp(ali, '998901234567');
    await client.cart.addBuilder({ body: { slugs: six.slice(0, 5), qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: six.slice(1), qty: 1 } });
    const checkout = await client.checkout.get({ query: {} });
    if (checkout.status !== 200) throw new Error('checkout');
    const res = await client.orders.create({
      body: orderBody(point.id, checkout.body.quote.total),
    });
    expect(res.status).toBe(201);
    expect(res.status === 201 && res.body.lines).toHaveLength(1);
    expect(await reservedOf(six[1]!)).toBe(1);
  });

  it('a stale checkout that counted both lines is refused with the new total', async () => {
    const five = await slugs(5);
    const point = await samarkandPoint();
    // one 10 ml fill of it left (ADR 0043)
    await stockBottles(t, five[0]!, 10, 1);
    const client = await signedUp(ali, '998901234567');
    await client.cart.addLine({ body: { slug: five[0]!, ml: 10, qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const res = await client.orders.create({ body: orderBody(point.id, 69_000 + 299_000) });
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body.code).toBe('total_changed');
    expect(await t.db.select().from(orders)).toHaveLength(0);
  });
});

describe("the owner's own Discovery sets (ADR 0044)", () => {
  const evening = { ru: 'Вечерний', uz: 'Kechki' };
  async function newSet(hidden = false) {
    const owner = await t.ownerSession();
    const ids = (await t.db.select({ id: fragrances.id }).from(fragrances).limit(10)).map(
      (f) => f.id,
    );
    const res = await owner.client.admin.sets.create({
      body: { name: evening, vialMl: 10, price: 350_000, hidden, composition: ids.slice(5, 10) },
    });
    if (res.status !== 201) throw new Error(`create: ${res.status}`);
    await owner.client.admin.sets.setOnHand({
      query: { key: res.body.key },
      body: { onHand: 4, reason: 'Пересчёт' },
    });
    return { owner, set: res.body };
  }

  it('adds a set under the next key, last in the list, sold from its own boxes', async () => {
    const { owner, set } = await newSet();
    expect(set).toMatchObject({ key: 'set-3', vialMl: 10, name: evening, price: 350_000 });
    expect(set.composition).toHaveLength(5);
    const list = await owner.client.admin.sets.list();
    expect(list.status === 200 && list.body.map((s) => s.key)).toEqual([
      'discovery',
      'discovery-5',
      'set-3',
    ]);
    const client = await signedUp(ali, '998901234567');
    const shop = await client.sets.list();
    expect(shop.status === 200 && shop.body.map((s) => s.key)).toContain('set-3');
    const one = await client.sets.discovery({ query: { key: 'set-3' } });
    expect(one.status === 200 && one.body).toMatchObject({ name: evening, available: 4 });
  });

  it("orders it by its key and name, and its reserve is its own, never the main set's", async () => {
    const point = await samarkandPoint();
    await t.db.update(discoverySet).set({ onHand: 3 }).where(eq(discoverySet.key, 'discovery'));
    await newSet();
    const client = await signedUp(ali, '998901234567');
    const cart = await client.cart.addDiscovery({ body: { qty: 2, key: 'set-3' } });
    expect(cart.status === 200 && cart.body.lines).toMatchObject([
      { kind: 'discovery_set', key: 'set-3', setName: evening, qty: 2 },
    ]);
    const res = await client.orders.create({ body: orderBody(point.id, 2 * 350_000) });
    expect(res.status).toBe(201);
    const [line] = await t.db.select().from(orderLines);
    expect(line).toMatchObject({ setKey: 'set-3', nameRu: 'Вечерний', nameUz: 'Kechki', ml: 10 });
    const mine = await client.sets.discovery({ query: { key: 'set-3' } });
    expect(mine.status === 200 && mine.body.available).toBe(2);
    const main = await client.sets.discovery();
    expect(main.status === 200 && main.body.available).toBe(3);
  });

  it('a hidden set leaves the shop: not listed, not found, not added; the main set never hides', async () => {
    const { owner, set } = await newSet(true);
    expect(set.hidden).toBe(true);
    const client = await signedUp(ali, '998901234567');
    const shop = await client.sets.list();
    expect(shop.status === 200 && shop.body.map((s) => s.key)).not.toContain('set-3');
    expect((await client.sets.discovery({ query: { key: 'set-3' } })).status).toBe(404);
    expect((await client.cart.addDiscovery({ body: { qty: 1, key: 'set-3' } })).status).toBe(404);
    const main = await owner.client.admin.sets.get();
    if (main.status !== 200) throw new Error('main');
    const res = await owner.client.admin.sets.update({
      body: {
        name: main.body.name,
        hidden: true,
        price: main.body.price,
        composition: main.body.composition.map((c) => c.id),
      },
    });
    expect(res.status).toBe(422);
  });

  it('is the owner’s to add: a manager is refused', async () => {
    const manager = await t.managerSession();
    const ids = (await t.db.select({ id: fragrances.id }).from(fragrances).limit(5)).map(
      (f) => f.id,
    );
    const res = await manager.client.admin.sets.create({
      body: { name: evening, vialMl: 5, price: 99_000, hidden: false, composition: ids },
    });
    expect(res.status).toBe(403);
  });
});
