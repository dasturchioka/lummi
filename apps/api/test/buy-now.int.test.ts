import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  and,
  asc,
  cartLines,
  carts,
  discoverySet,
  eq,
  fragrances,
  orderLines,
  orders,
  promoCodeUses,
  volumes,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import {
  orderBody,
  samarkandPoint as pointOf,
  shopper,
  slugs as slugsOf,
  tenMl as tenMlOf,
  whileTableLocked as lockedWhile,
} from './harness/orders';
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

const ali: TestUser = { id: 71, first_name: 'Ali', language_code: 'ru' };
const vali: TestUser = { id: 72, first_name: 'Vali', language_code: 'uz' };

const slugs = (n: number) => slugsOf(t, n);
const point = () => pointOf(t);

async function volumeOf(slug: string, ml: number) {
  const [v] = await t.db
    .select({ id: volumes.id })
    .from(volumes)
    .innerJoin(fragrances, eq(fragrances.id, volumes.fragranceId))
    .where(and(eq(fragrances.slug, slug), eq(volumes.ml, ml)));
  return v!;
}

/** The customer's cart exactly as stored: its row and every line, all columns. */
async function cartRows(customerId: number) {
  const state = await t.db.select().from(carts).where(eq(carts.customerId, customerId));
  const lines = await t.db
    .select()
    .from(cartLines)
    .where(eq(cartLines.customerId, customerId))
    .orderBy(asc(cartLines.id));
  return JSON.stringify({ state, lines });
}

async function customerIdOf(client: Awaited<ReturnType<typeof shopper>>) {
  const me = await client.me.get();
  if (me.status !== 200) throw new Error(`me: ${me.status}`);
  return me.body.id;
}

/**
 * A cart with every line kind, a promo code and a discount choice: what «Купить сейчас» must
 * leave exactly as it was.
 */
async function fullCart(client: Awaited<ReturnType<typeof shopper>>) {
  const s = await slugs(8);
  await client.cart.addLine({ body: { slug: s[0]!, ml: 30, qty: 2 } });
  await client.cart.addDiscovery({ body: { qty: 1 } });
  const builder = await client.cart.addBuilder({ body: { slugs: s.slice(1, 6), qty: 1 } });
  expect(builder.status).toBe(200);
  const id = await customerIdOf(client);
  await t.db
    .update(carts)
    .set({ promoCode: 'BLOGGER10', discountChoice: { type: 'promo_code' } })
    .where(eq(carts.customerId, id));
  return { id, s };
}

describe('«Купить сейчас»: one line, the cart untouched (spec Changes 2026-11-07, cart)', () => {
  it('a volume: the checkout quotes that line alone and the order holds it; the cart stays byte-identical', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const { id, s } = await fullCart(client);
    const before = await cartRows(id);
    const item = `volume:${s[7]}:50`;

    const checkout = await client.checkout.get({ query: { regionId: p.regionId, item } });
    expect(checkout.status).toBe(200);
    if (checkout.status !== 200) return;
    // 219 000 + 25 000 delivery, whatever the cart holds
    expect(checkout.body.quote.itemsSubtotal).toBe(219_000);
    expect(checkout.body.quote.total).toBe(244_000);
    expect(checkout.body.itemCount).toBe(1);
    expect(checkout.body.item).toMatchObject({ kind: 'volume', slug: s[7], ml: 50, qty: 1 });
    expect(await cartRows(id)).toBe(before);

    const res = await client.orders.create({ body: { ...orderBody(p.id, 244_000), item } });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ kind: 'volume', slug: s[7], ml: 50, qty: 1 });
    expect(res.body.total).toBe(244_000);
    expect(await cartRows(id)).toBe(before);
  });

  it('a promo code applied in the cart never reaches a buy-now order, and the cart keeps it (#29)', async () => {
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
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugs(1);
    await client.cart.addLine({ body: { slug: s!, ml: 30, qty: 1 } });
    const applied = await client.cart.applyPromoCode({ body: { code: 'bloger10' } });
    expect(applied.status === 200 && applied.body.quote.discount).toMatchObject({
      type: 'promo_code',
      code: 'BLOGER10',
      amount: 14_900,
    });
    const id = await customerIdOf(client);
    const before = await cartRows(id);

    const item = `volume:${s}:50`;
    const checkout = await client.checkout.get({ query: { regionId: p.regionId, item } });
    expect(checkout.status === 200 && checkout.body.quote.discount).toBeNull();
    const res = await client.orders.create({ body: { ...orderBody(p.id, 244_000), item } });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.discount).toBeNull();
    expect(res.body.total).toBe(244_000);
    // no use of the code was held, and the cart still has it, applied
    expect(await t.db.select().from(promoCodeUses)).toHaveLength(0);
    expect(await cartRows(id)).toBe(before);
    const cart = await client.cart.get();
    expect(cart.status === 200 && [cart.body.promoCode, cart.body.quote.discount?.type]).toEqual([
      'BLOGER10',
      'promo_code',
    ]);
  });

  it('the Discovery set: reserved from its own stock, the cart untouched', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const { id } = await fullCart(client);
    const before = await cartRows(id);
    const res = await client.orders.create({
      body: { ...orderBody(p.id, 299_000), item: 'discovery_set' },
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines.map((l) => [l.kind, l.qty])).toEqual([['discovery_set', 1]]);
    expect(res.body.lines[0]!.setComposition).toHaveLength(5);
    const box = await client.sets.discovery();
    // 5 on hand, 1 reserved by this order (the cart's line reserves nothing)
    expect(box.status === 200 && box.body.available).toBe(4);
    expect(await cartRows(id)).toBe(before);
  });

  it('a builder set: one 10 ml of each of the five reserved, the cart untouched', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const { id, s } = await fullCart(client);
    const before = await cartRows(id);
    const five = [s[3]!, s[7]!, s[0]!, s[6]!, s[2]!];
    const item = `builder_set:${five.join(',')}`;
    const checkout = await client.checkout.get({ query: { item } });
    expect(checkout.status === 200 && checkout.body.item).toMatchObject({ kind: 'builder_set' });
    const res = await client.orders.create({ body: { ...orderBody(p.id, 299_000), item } });
    expect(res.status).toBe(201);
    if (res.status !== 201) return;
    expect(res.body.lines.map((l) => [l.kind, l.qty])).toEqual([['builder_set', 1]]);
    const [line] = await t.db.select().from(orderLines);
    const tenMlIds = await Promise.all(five.map(async (f) => (await tenMlOf(t, f)).id));
    expect([...line!.setVolumeIds!].sort()).toEqual([...tenMlIds].sort());
    const card = await client.catalog.fragrance({ params: { slug: s[7]! } });
    expect(card.status === 200 && card.body.volumes.find((v) => v.ml === 10)?.available).toBe(19);
    expect(await cartRows(id)).toBe(before);
  });

  it('a shopper with no cart gets no cart row from it', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugs(1);
    const res = await client.orders.create({
      body: { ...orderBody(p.id, 94_000), item: `volume:${s}:10` },
    });
    expect(res.status).toBe(201);
    expect(await t.db.select().from(carts)).toHaveLength(0);
    expect(await t.db.select().from(cartLines)).toHaveLength(0);
  });

  it('a stale total is refused with the new buy-now checkout, a repeat of the key returns the same order', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugs(1);
    const item = `volume:${s}:30`;
    const stale = await client.orders.create({ body: { ...orderBody(p.id, 1_000), item } });
    expect(stale.status).toBe(409);
    if (stale.status !== 409 || !('checkout' in stale.body)) throw new Error('expected 409');
    expect(stale.body.code).toBe('total_changed');
    expect(stale.body.checkout.quote.total).toBe(174_000);
    expect(stale.body.checkout.item).toMatchObject({ kind: 'volume', slug: s, ml: 30 });

    const body = { ...orderBody(p.id, 174_000), item };
    const first = await client.orders.create({ body });
    const again = await client.orders.create({ body });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(first.status === 201 && again.status === 201 && again.body.number).toBe(
      first.status === 201 ? first.body.number : -1,
    );
    expect(await t.db.select().from(orders)).toHaveLength(1);
  });

  it('an unknown or hidden fragrance is not found (GET 404, POST 422 unknown_item)', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugs(1);
    expect((await client.checkout.get({ query: { item: 'volume:no-such-thing:10' } })).status).toBe(
      404,
    );
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, s!));
    expect((await client.checkout.get({ query: { item: `volume:${s}:10` } })).status).toBe(404);
    const res = await client.orders.create({
      body: { ...orderBody(p.id, 94_000), item: `volume:${s}:10` },
    });
    expect(res.status).toBe(422);
    expect(res.status === 422 && res.body.code).toBe('unknown_item');
    // a malformed item is refused by the contract (400; the typed client knows no 400 here)
    for (const item of ['volume:x:20', 'builder_set:a,b,c', 'builder_set:a,a,b,c,d', 'gift'])
      await expect(client.checkout.get({ query: { item } })).rejects.toThrow(/got: 400/);
  });
});

describe('«Купить сейчас» reserves like a cart order (ADR 0010)', () => {
  it('a sold-out item quotes nothing to order and is refused 409 nothing_to_order', async () => {
    const p = await point();
    const client = await shopper(t, ali, '998901234567');
    const [s] = await slugs(1);
    const v = await volumeOf(s!, 10);
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, v.id));
    const checkout = await client.checkout.get({ query: { item: `volume:${s}:10` } });
    expect(
      checkout.status === 200 && [checkout.body.itemCount, checkout.body.item?.soldOut],
    ).toEqual([0, true]);
    const res = await client.orders.create({
      body: { ...orderBody(p.id, 0), item: `volume:${s}:10` },
    });
    expect(res.status === 409 && res.body.code).toBe('nothing_to_order');
  });

  it('a builder set with one 10 ml short is quoted sold out, naming it (not unknown)', async () => {
    const client = await shopper(t, ali, '998901234567');
    const five = await slugs(5);
    const v = await volumeOf(five[3]!, 10);
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, v.id));
    const checkout = await client.checkout.get({
      query: { item: `builder_set:${five.join(',')}` },
    });
    expect(checkout.status).toBe(200);
    if (checkout.status !== 200) return;
    expect(checkout.body.itemCount).toBe(0);
    expect(
      checkout.body.item?.kind === 'builder_set' && checkout.body.item.short.map((f) => f.slug),
    ).toEqual([five[3]]);
  });

  it('the last unit: a buy-now and a cart checkout cannot both win', async () => {
    const p = await point();
    const [s] = await slugs(1);
    const v = await volumeOf(s!, 10);
    await t.db.update(volumes).set({ onHand: 1 }).where(eq(volumes.id, v.id));
    const a = await shopper(t, ali, '998901234567');
    const b = await shopper(t, vali, '998907654321');
    await b.cart.addLine({ body: { slug: s!, ml: 10, qty: 1 } });
    const results = await lockedWhile(t, 'order_lines', () =>
      Promise.all([
        a.orders.create({ body: { ...orderBody(p.id, 94_000), item: `volume:${s}:10` } }),
        b.orders.create({ body: orderBody(p.id, 94_000) }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409);
    expect(lost?.status === 409 && lost.body.code).toBe('nothing_to_order');
    expect(await t.db.select().from(orders)).toHaveLength(1);
  });

  it('the last unit taken by a buy-now: a later cart checkout sees nothing left', async () => {
    const p = await point();
    const [s] = await slugs(1);
    const v = await volumeOf(s!, 30);
    await t.db.update(volumes).set({ onHand: 1 }).where(eq(volumes.id, v.id));
    const a = await shopper(t, ali, '998901234567');
    await a.cart.addLine({ body: { slug: s!, ml: 30, qty: 1 } });
    const bought = await a.orders.create({
      body: { ...orderBody(p.id, 174_000), item: `volume:${s}:30` },
    });
    expect(bought.status).toBe(201);
    // the cart line stays (untouched), now sold out
    const cart = await a.cart.get();
    expect(cart.status === 200 && cart.body.lines.map((l) => [l.qty, l.soldOut])).toEqual([
      [1, true],
    ]);
    const res = await a.orders.create({ body: orderBody(p.id, 174_000) });
    expect(res.status === 409 && res.body.code).toBe('nothing_to_order');
  });
});
