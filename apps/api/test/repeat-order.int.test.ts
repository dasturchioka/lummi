import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CART_MAX_QTY } from '@lummi/contracts/constants';
import { and, cartLines, discoverySet, eq, fragrances, orders, volumes } from '@lummi/db';
import pg from 'pg';
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

/**
 * Checks the client's cart out and returns the order number (the cart is empty after). The order
 * is then «Доставлен» (only a delivered or a cancelled order can be repeated): it holds no reserve.
 */
async function order(client: Client, status: 'delivered' | 'cancelled' = 'delivered') {
  const p = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: p.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout: ${checkout.status}`);
  const res = await client.orders.create({
    body: orderBody(p.id, checkout.body.quote.total),
  });
  if (res.status !== 201) throw new Error(`order: ${res.status}`);
  await t.db.update(orders).set({ status }).where(eq(orders.number, res.body.number));
  return res.body.number;
}

const outcome = (r: { lines: { added: number; reason: string | null }[] }) =>
  r.lines.map((l) => [l.added, l.reason]);

describe('«Повторить заказ» (spec Changes 2026-11-07 cart, 2026-11-11)', () => {
  it('adds the old lines at today’s prices, skips what is unavailable and counts «2 из 3»', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 3);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 30, qty: 2 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 10, qty: 1 } });
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const number = await order(client);

    // today: the 30 ml costs more, the 10 ml is gone
    await t.db
      .update(volumes)
      .set({ price: 155_000 })
      .where(eq(volumes.id, (await volumeOf(s[0]!, 30)).id));
    await setOnHand(s[1]!, 10, 0);

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result).toMatchObject({ added: 2, of: 3 });
    expect(res.body.result.lines.map((l) => [l.kind, l.ordered, l.added, l.reason])).toEqual([
      ['volume', 2, 2, null],
      ['volume', 1, 0, 'sold_out'],
      ['discovery_set', 1, 1, null],
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

  it('says why a line came back short: stock (capped) or the 99 ceiling (max_qty)', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 3);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 50, qty: 3 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 30, qty: 5 } });
    await client.cart.addLine({ body: { slug: s[2]!, ml: 10, qty: 1 } });
    const number = await order(client);
    // 50 ml: two left; 30 ml: plenty, but the cart already holds 97; 10 ml: the cart holds 99
    await setOnHand(s[0]!, 50, 2);
    await setOnHand(s[1]!, 30, 500);
    await setOnHand(s[2]!, 10, 500);
    await client.cart.addLine({ body: { slug: s[1]!, ml: 30, qty: 97 } });
    await client.cart.addLine({ body: { slug: s[2]!, ml: 10, qty: CART_MAX_QTY } });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.ordered, l.added, l.reason])).toEqual([
      [3, 2, 'capped'],
      [5, CART_MAX_QTY - 97, 'max_qty'],
      [1, 0, 'max_qty'],
    ]);
    expect(res.body.result).toMatchObject({ added: 2, of: 3 });
    const qty = Object.fromEntries(
      res.body.cart.lines.map((l) => [l.kind === 'volume' ? `${l.slug}:${l.ml}` : l.kind, l.qty]),
    );
    expect(qty).toEqual({
      [`${s[1]}:30`]: CART_MAX_QTY,
      [`${s[2]}:10`]: CART_MAX_QTY,
      [`${s[0]}:50`]: 2,
    });
  });

  it('a builder line comes back whole or not at all: one 10 ml short is set_incomplete', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 10);
    await client.cart.addBuilder({ body: { slugs: s.slice(0, 5), qty: 1 } });
    await client.cart.addBuilder({ body: { slugs: s.slice(5, 10), qty: 1 } });
    const number = await order(client);
    await setOnHand(s[2]!, 10, 0);

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.kind, l.added, l.reason])).toEqual([
      ['builder_set', 0, 'set_incomplete'],
      ['builder_set', 1, null],
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
    // one 10 ml of the first fragrance left, and the cart holds it already
    await setOnHand(s[0]!, 10, 1);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 10, qty: 1 } });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result).toMatchObject({ added: 0, of: 1 });
    expect(outcome(res.body.result)).toEqual([[0, 'set_incomplete']]);
    expect(res.body.cart.lines.map((l) => [l.kind, l.qty, l.soldOut])).toEqual([
      ['volume', 1, false],
    ]);
  });

  it('skips a hidden fragrance and a Discovery set that is gone, as sold out', async () => {
    const client = await shopper(t, ali, '998901234567');
    const s = await slugsOf(t, 2);
    await client.cart.addLine({ body: { slug: s[0]!, ml: 10, qty: 1 } });
    await client.cart.addLine({ body: { slug: s[1]!, ml: 10, qty: 1 } });
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const number = await order(client);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, s[0]!));
    await t.db.update(discoverySet).set({ onHand: 0 });

    const res = await client.orders.repeat({ params: { number } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.result.lines.map((l) => [l.kind, l.added, l.reason])).toEqual([
      ['volume', 0, 'sold_out'],
      ['volume', 1, null],
      ['discovery_set', 0, 'sold_out'],
    ]);
    expect(res.body.result).toMatchObject({ added: 1, of: 3 });
    expect(await t.db.select().from(cartLines)).toHaveLength(1);
  });

  it('only a delivered or cancelled order, and never someone else’s', async () => {
    const client = await shopper(t, ali, '998901234567');
    const other = await shopper(t, vali, '998907654321');
    const [s] = await slugsOf(t, 1);
    await client.cart.addLine({ body: { slug: s!, ml: 10, qty: 1 } });
    const number = await order(client, 'cancelled');
    expect((await other.orders.repeat({ params: { number } })).status).toBe(404);
    expect((await client.orders.repeat({ params: { number: 999_999 } })).status).toBe(404);
    const res = await client.orders.repeat({ params: { number } });
    expect(res.status === 200 && res.body.result).toMatchObject({ added: 1, of: 1 });

    // still in progress or awaiting payment: refused, the cart untouched
    for (const status of [
      'awaiting_payment',
      'receipt_review',
      'assembling',
      'handed_to_bts',
    ] as const) {
      await t.db.update(orders).set({ status }).where(eq(orders.number, number));
      const refused = await client.orders.repeat({ params: { number } });
      expect(refused.status).toBe(409);
      expect(refused.status === 409 && refused.body.code).toBe('not_repeatable');
    }
    expect((await t.db.select().from(cartLines)).map((l) => l.qty)).toEqual([1]);
  });
});

describe('cart writes take the cart row first (no deadlock)', () => {
  it('a repeat racing a quantity change on the same line: both go through', async () => {
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugsOf(t, 1);
    await client.cart.addLine({ body: { slug: s!, ml: 10, qty: 1 } });
    const number = await order(client);
    const added = await client.cart.addLine({ body: { slug: s!, ml: 10, qty: 1 } });
    if (added.status !== 200) throw new Error('add');
    const lineId = added.body.lines[0]!.id;

    // Another session holds the line: the quantity change queues on it first, then the repeat.
    // Taken in different orders (line then cart, cart then line) the two would deadlock here.
    const locker = new pg.Client({ connectionString: t.env.DATABASE_URL });
    await locker.connect();
    try {
      await locker.query('begin');
      await locker.query('select 1 from cart_lines where id = $1 for update', [lineId]);
      const change = client.cart.setQuantity({ params: { lineId }, body: { qty: 3 } });
      await new Promise((r) => setTimeout(r, 300));
      const repeat = client.orders.repeat({ params: { number } });
      await new Promise((r) => setTimeout(r, 300));
      await locker.query('commit');
      const [c, r] = await Promise.all([change, repeat]);
      expect([c.status, r.status]).toEqual([200, 200]);
    } finally {
      await locker.end();
    }
    const [line] = await t.db.select().from(cartLines);
    // whichever ran second saw the first: 3 then +1, or 1+1 then set to 3
    expect([3, 4]).toContain(line!.qty);
  });
});
