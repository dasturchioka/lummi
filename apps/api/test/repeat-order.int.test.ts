import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import { and, cartLines, discoverySet, eq, fragrances, orders, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import { createTestApp, type TestApp } from './harness/test-app';
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
  t.edges.clock.set(new Date('2026-11-11T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  await t.db.update(discoverySet).set({ onHand: 5 });
});

const ali: TestUser = { id: 81, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 82, first_name: 'Vali', language_code: 'uz' };

type Client = Awaited<ReturnType<typeof shopper>>;

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id, onHand: volumes.onHand })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}

const setOnHand = async (slug: string, ml: number, onHand: number) =>
  t.db
    .update(volumes)
    .set({ onHand })
    .where(eq(volumes.id, (await volumeOf(slug, ml)).id));

/** Checks the client's cart out and returns the order number (the cart is empty after). */
async function order(client: Client) {
  const p = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: p.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout: ${checkout.status}`);
  const res = await client.orders.create({
    body: orderBody(p.id, checkout.body.quote.total),
  });
  if (res.status !== 201) throw new Error(`order: ${res.status}`);
  return res.body.number;
}

describe('«Повторить заказ» (spec Changes 2026-11-07, cart)', () => {
  it('adds the old lines at today’s prices, skips what is unavailable and counts «2 из 3»', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 3);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 30, qty: 2 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 10, qty: 1 } });
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const number = await order(client);

    // today: the 30 ml costs more, the 10 ml is gone (its whole stock is the old order's reserve)
    await t.db
      .update(volumes)
      .set({ price: 155_000 })
      .where(eq(volumes.id, (await volumeOf(s[0]!, 30)).id));
    await setOnHand(s[1]!, 10, 1);

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result).toMatchObject({ added: 2, of: 3 });
    expect(res.body.result.lines.map((l) => [l.kind, l.ordered, l.added])).toEqual([
      ['volume', 2, 2],
      ['volume', 1, 0],
      ['discovery_set', 1, 1],
    ]);
    // the cart: at today's price, the sold-out line not added at all
    const cart = res.body.cart;
    expect(cart.lines.map((l) => [l.kind, l.qty])).toEqual([
      ['volume', 2],
      ['discovery_set', 1],
    ]);
    expect(cart.quote.lines.find((q) => q.qty === 2)?.unitPrice).toBe(155_000);
    expect(cart.quote.itemsSubtotal).toBe(2 * 155_000 + 299_000);
  });

  it('caps a line at what is available and at the per-line ceiling', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 2);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 50, qty: 3 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 30, qty: 5 } });
    const number = await order(client);
    // 50 ml: 3 reserved by the order + 2 free; 30 ml: plenty, but the cart already holds 97
    await setOnHand(s[0]!, 50, 5);
    await setOnHand(s[1]!, 30, 500);
    await client.cart.addLine({ body: { slug: s[1]!, ml: 30, qty: 97 } });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.ordered, l.added])).toEqual([
      [3, 2],
      [5, CART_MAX_QTY - 97],
    ]);
    expect(res.body.result).toMatchObject({ added: 2, of: 2 });
    const qty = Object.fromEntries(
      res.body.cart.lines.map((l) => [l.kind === 'volume' ? `${l.slug}:${l.ml}` : l.kind, l.qty]),
    );
    expect(qty).toEqual({ [`${s[1]}:30`]: CART_MAX_QTY, [`${s[0]}:50`]: 2 });
  });

  it('a builder line comes back whole or not at all: one 10 ml short skips it', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 10);
    await client.cart.addBuilder({ body: { slugs: s.slice(0, 5), qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: s.slice(5, 10), qty: 1 } });
    const number = await order(client);
    // the first set's third 10 ml: only what the old order reserves is on hand
    await setOnHand(s[2]!, 10, 1);

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.kind, l.added])).toEqual([
      ['builder_set', 0],
      ['builder_set', 1],
    ]);
    expect(res.body.result).toMatchObject({ added: 1, of: 2 });
    expect(res.body.cart.lines).toHaveLength(1);
    expect(
      res.body.cart.lines[0]!.kind === 'builder_set' &&
        res.body.cart.lines[0]!.fragrances.map((f) => f.slug).sort(),
    ).toEqual(s.slice(5, 10).sort());
  });

  it('shares a 10 ml with what the cart already holds: the cart’s own lines keep theirs', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 5);
    await client.cart.addBuilder({ body: { slugs: s, qty: 1 } });
    const number = await order(client);
    // one free 10 ml of the first fragrance, and the cart holds it already
    await setOnHand(s[0]!, 10, 2);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 10, qty: 1 } });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result).toMatchObject({ added: 0, of: 1 });
    expect(res.body.cart.lines.map((l) => [l.kind, l.qty, l.soldOut])).toEqual([
      ['volume', 1, false],
    ]);
  });

  it('skips a hidden fragrance and a Discovery set that is gone', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 2);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 10, qty: 1 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 10, qty: 1 } });
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const number = await order(client);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, s[0]!));
    // the old order holds two boxes; nothing else is left
    await t.db.update(discoverySet).set({ onHand: 2 });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.kind, l.added])).toEqual([
      ['volume', 0],
      ['volume', 1],
      ['discovery_set', 0],
    ]);
    expect(res.body.result).toMatchObject({ added: 1, of: 3 });
    expect(await t.db.select().from(cartLines)).toHaveLength(1);
  });

  it('works on a cancelled order too, and never on someone else’s', async () => {
    const client = await shopper(t, ali, '998901234567');
    const other = await shopper(t, vali, '998907654321');
    const [s] = await slugsOf(t, 1);
    await client.cart.addLine({ body: { slug: s!, ml: 10, qty: 1 } });
    const number = await order(client);
    await t.db.update(orders).set({ status: 'cancelled' });
    expect((await other.orders.repeat({ params: { number } })).status).toBe(404);
    expect((await client.orders.repeat({ params: { number: 999_999 } })).status).toBe(404);
    const res = await client.orders.repeat({ params: { number } });
    expect(res.status === 200 && res.body.result).toMatchObject({ added: 1, of: 1 });
  });
});
