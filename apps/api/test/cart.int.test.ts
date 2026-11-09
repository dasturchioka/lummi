import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiContract } from '@lummi/contracts';
import { signContact } from '@lummi/contracts/sign-contact';
import { and, cartLines, carts, customers, eq, fragrances, regions, volumes } from '@lummi/db';
import { initClient } from '@ts-rest/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, TEST_BOT_TOKEN, type TestApp } from './harness/test-app';

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
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
});

const ali = { id: 41, first_name: 'Ali', language_code: 'ru' };
const vali = { id: 42, first_name: 'Vali', language_code: 'uz' };

/** Three fragrances in a fixed order: the seed's slugs sorted. */
async function slugs(n = 6) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}
async function setStock(slug: string, ml: number, onHand: number) {
  const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
  await t.db
    .update(volumes)
    .set({ onHand })
    .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, ml)));
}
async function me(user = ali) {
  const { client } = await t.signIn(user);
  const get = async () => {
    const res = await client.cart.get();
    if (res.status !== 200) throw new Error(`cart: ${res.status}`);
    return res.body;
  };
  const add = async (slug: string, ml: 10 | 30 | 50, qty = 1) => {
    const res = await client.cart.addLine({ body: { slug, ml, qty } });
    return res;
  };
  return { client, get, add };
}

describe('cart read and add', () => {
  it('needs a session', async () => {
    expect((await t.client.cart.get()).status).toBe(401);
  });

  it('starts empty: a zero quote with nothing to deliver', async () => {
    const { get } = await me();
    const cart = await get();
    expect(cart.lines).toEqual([]);
    expect(cart.count).toBe(0);
    expect(cart.quote).toMatchObject({ itemsSubtotal: 0, deliveryFee: 0, total: 0 });
    expect(cart.deliveryCity).toBeNull();
  });

  it('adds a volume and returns a fresh quote with the default 25 000 delivery', async () => {
    const [slug] = await slugs();
    const { add } = await me();
    const res = await add(slug!, 10);
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({
      slug,
      ml: 10,
      qty: 1,
      available: 20,
      soldOut: false,
    });
    expect(res.body.count).toBe(1);
    expect(res.body.quote).toMatchObject({
      itemsSubtotal: 69_000,
      deliveryFee: 25_000,
      total: 94_000,
      amountToFreeDelivery: 181_000,
    });
    expect(res.body.quote.lines[0]).toMatchObject({
      key: String(res.body.lines[0]!.id),
      unitPrice: 69_000,
      lineTotal: 69_000,
    });
  });

  it('adding the same volume again raises the quantity on one line', async () => {
    const [slug] = await slugs();
    const { add, get } = await me();
    await add(slug!, 30);
    await add(slug!, 30, 2);
    const cart = await get();
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.qty).toBe(3);
    expect(cart.quote.itemsSubtotal).toBe(3 * 149_000);
  });

  it('answers 404 for an unknown or hidden fragrance and for a volume it does not sell', async () => {
    const [slug] = await slugs();
    const { add } = await me();
    expect((await add('no-such', 10)).status).toBe(404);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, slug!));
    expect((await add(slug!, 10)).status).toBe(404);
  });

  it('is per customer: another customer sees an empty cart, the same customer sees it on a second device', async () => {
    const [slug] = await slugs();
    await (await me(ali)).add(slug!, 10);
    expect((await (await me(vali)).get()).lines).toEqual([]);
    expect((await (await me(ali)).get()).lines).toHaveLength(1);
  });
});

describe('quantity is capped at available', () => {
  it('caps an add at what is available, and says sold_out when nothing is', async () => {
    const [slug] = await slugs();
    await setStock(slug!, 10, 3);
    const { add } = await me();
    const res = await add(slug!, 10, 10);
    expect(res.status === 200 && res.body.lines[0]?.qty).toBe(3);
    // already at the cap: stays at 3
    const again = await add(slug!, 10, 1);
    expect(again.status === 200 && again.body.lines[0]?.qty).toBe(3);
    await setStock(slug!, 30, 0);
    expect((await add(slug!, 30)).status).toBe(409);
  });

  it('caps a set-quantity at available', async () => {
    const [slug] = await slugs();
    await setStock(slug!, 10, 4);
    const { client, add } = await me();
    const added = await add(slug!, 10);
    if (added.status !== 200) throw new Error();
    const lineId = added.body.lines[0]!.id;
    const res = await client.cart.setQuantity({ params: { lineId }, body: { qty: 50 } });
    expect(res.status === 200 && res.body.lines[0]?.qty).toBe(4);
    const down = await client.cart.setQuantity({ params: { lineId }, body: { qty: 2 } });
    expect(down.status === 200 && down.body.quote.itemsSubtotal).toBe(2 * 69_000);
  });

  it('quotes no more than is now available when stock fell below the stored quantity, and recovers on restock', async () => {
    const [slug] = await slugs();
    const { add, get } = await me();
    await add(slug!, 10, 5);
    await setStock(slug!, 10, 2);
    const low = await get();
    expect(low.lines[0]).toMatchObject({ qty: 2, available: 2, soldOut: false });
    expect(low.quote.itemsSubtotal).toBe(2 * 69_000);
    await setStock(slug!, 10, 20);
    expect((await get()).lines[0]?.qty).toBe(5);
  });

  it('cannot change or remove another customer line', async () => {
    const [slug] = await slugs();
    const a = await me(ali);
    const added = await a.add(slug!, 10);
    if (added.status !== 200) throw new Error();
    const lineId = added.body.lines[0]!.id;
    const v = await me(vali);
    expect((await v.client.cart.setQuantity({ params: { lineId }, body: { qty: 2 } })).status).toBe(
      404,
    );
    await v.client.cart.removeLine({ params: { lineId } });
    expect((await a.get()).lines).toHaveLength(1);
  });

  it('removes a line', async () => {
    const [s1, s2] = await slugs();
    const { client, add } = await me();
    await add(s1!, 10);
    const two = await add(s2!, 30);
    if (two.status !== 200) throw new Error();
    const res = await client.cart.removeLine({ params: { lineId: two.body.lines[1]!.id } });
    expect(res.status === 200 && res.body.lines.map((l) => l.ml)).toEqual([10]);
    expect(res.status === 200 && res.body.quote.itemsSubtotal).toBe(69_000);
  });
});

describe('sold-out lines', () => {
  it('stay in the cart flagged, and are left out of the quote and the count', async () => {
    const [s1, s2] = await slugs();
    const { add, get } = await me();
    await add(s1!, 10);
    await add(s2!, 10, 2);
    await setStock(s1!, 10, 0);
    const cart = await get();
    expect(cart.lines).toHaveLength(2);
    const gone = cart.lines.find((l) => l.slug === s1);
    expect(gone).toMatchObject({ soldOut: true, available: 0 });
    expect(cart.quote.lines.find((l) => l.key === String(gone!.id))?.soldOut).toBe(true);
    expect(cart.quote.itemsSubtotal).toBe(2 * 69_000);
    expect(cart.count).toBe(2);
  });

  it('a cart of only sold-out lines costs nothing, delivery included', async () => {
    const [slug] = await slugs();
    const { add, get } = await me();
    await add(slug!, 10);
    await setStock(slug!, 10, 0);
    expect((await get()).quote).toMatchObject({ itemsSubtotal: 0, deliveryFee: 0, total: 0 });
  });

  it('a hidden fragrance line stays, flagged sold out', async () => {
    const [slug] = await slugs();
    const { add, get } = await me();
    await add(slug!, 10);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, slug!));
    expect((await get()).lines[0]).toMatchObject({ soldOut: true });
  });
});

describe('delivery fee and the free-delivery nudge', () => {
  it('uses the delivery city region tariff, and names the city', async () => {
    await importBtsPoints(t.db, snapshot);
    const [slug] = await slugs();
    const regionRows = await t.db.select().from(regions);
    const region = regionRows.find((r) => r.nameRu.startsWith('Самарк'))!;
    await t.db.update(regions).set({ deliveryTariff: 31_000 }).where(eq(regions.id, region.id));
    const { client, add, get } = await me();
    await add(slug!, 10);
    expect((await get()).quote.deliveryFee).toBe(25_000); // no city: the default tariff
    const saved = await client.me.setDeliveryCity({
      body: { regionId: region.id, city: 'Самарканд' },
    });
    expect(saved.status).toBe(200);
    const cart = await get();
    expect(cart.deliveryCity).toMatchObject({ city: 'Самарканд' });
    expect(cart.quote).toMatchObject({ deliveryFee: 31_000, total: 100_000 });
  });

  it('takes the default tariff from the setting', async () => {
    const [slug] = await slugs();
    await t.db.insert((await import('@lummi/db')).settings).values({
      key: 'delivery.defaultTariff',
      value: 18_000,
    });
    const { add } = await me();
    const res = await add(slug!, 10);
    expect(res.status === 200 && res.body.quote.deliveryFee).toBe(18_000);
  });

  it('shows the amount to add, then free delivery with no nudge once the threshold is reached', async () => {
    const [s1, s2] = await slugs();
    const { add } = await me();
    const first = await add(s1!, 30); // 149 000
    expect(first.status === 200 && first.body.quote.amountToFreeDelivery).toBe(101_000);
    const next = await add(s2!, 30); // 298 000
    if (next.status !== 200) throw new Error();
    expect(next.body.quote).toMatchObject({
      amountToFreeDelivery: 0,
      deliveryFee: 0,
      total: 298_000,
    });
    expect(next.body.suggestions).toEqual([]);
  });
});

describe('suggestions', () => {
  it('lists up to 3 available 10 ml volumes not in the cart, hits first', async () => {
    const all = await slugs(8);
    const hit = all[5]!;
    await t.db.update(fragrances).set({ isHit: true }).where(eq(fragrances.slug, hit));
    const { add } = await me();
    const res = await add(all[0]!, 10);
    if (res.status !== 200) throw new Error();
    const got = res.body.suggestions;
    expect(got).toHaveLength(3);
    expect(got.every((s) => s.ml === 10 && s.price === 69_000)).toBe(true);
    expect(got.map((s) => s.slug)).not.toContain(all[0]);
    expect(got[0]?.slug).toBe(hit);
  });

  it('skips sold-out and hidden volumes and prices a markdown at its sale price', async () => {
    const all = await slugs(8);
    await t.db.update(fragrances).set({ isHit: true }).where(eq(fragrances.slug, all[1]!));
    await t.db.update(fragrances).set({ isHit: true }).where(eq(fragrances.slug, all[2]!));
    await setStock(all[1]!, 10, 0);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, all[2]!));
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, all[3]!));
    await t.db.update(fragrances).set({ isHit: true }).where(eq(fragrances.slug, all[3]!));
    await t.db
      .update(volumes)
      .set({ salePrice: 50_000 })
      .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, 10)));
    const { add } = await me();
    const res = await add(all[0]!, 30);
    if (res.status !== 200) throw new Error();
    const slugsGot = res.body.suggestions.map((s) => s.slug);
    expect(slugsGot).not.toContain(all[1]);
    expect(slugsGot).not.toContain(all[2]);
    expect(res.body.suggestions[0]).toMatchObject({ slug: all[3], price: 50_000 });
  });

  it('has none for an empty cart', async () => {
    expect((await (await me()).get()).suggestions).toEqual([]);
  });
});

describe('the stored discount choice and prefilled code', () => {
  it('start empty and a typed code clears the stored choice', async () => {
    const [slug] = await slugs();
    const { add, get } = await me();
    await add(slug!, 10);
    const [row] = await t.db.select().from(carts);
    expect(row).toMatchObject({ discountChoice: null, promoCode: null });
    const { CartService } = await import('../src/cart/cart.service');
    const svc = t.app.get(CartService);
    await svc.setDiscountChoice(row!.customerId, { type: 'birthday_coupon', id: 7 });
    await svc.setPromoCode(row!.customerId, 'summer');
    const [after] = await t.db.select().from(carts);
    expect(after).toMatchObject({ discountChoice: null, promoCode: 'SUMMER' });
    await svc.setDiscountChoice(row!.customerId, { type: 'promo_code' });
    expect((await get()).promoCode).toBe('SUMMER');
  });
});

describe('relink', () => {
  const nowSec = () => Math.floor(t.edges.clock.now().getTime() / 1000);
  const contact = (userId: number) =>
    signContact({ botToken: TEST_BOT_TOKEN, userId, phone: '998901234567', authDate: nowSec() });

  it('moves the cart lines, the choice and the prefilled code to the customer who held the phone', async () => {
    const [s1, s2] = await slugs();
    const old = await me(ali);
    await old.client.me.shareContact({ body: { proof: contact(ali.id) } });
    await old.add(s1!, 10);
    const [oldRow] = await t.db.select().from(customers).where(eq(customers.telegramId, ali.id));

    const fresh = await me(vali);
    await fresh.add(s1!, 10, 2); // the same volume: quantities add up
    await fresh.add(s2!, 30);
    await t.db
      .update(carts)
      .set({ promoCode: 'FRESH', discountChoice: { type: 'promo_code' } })
      .where(
        eq(
          carts.customerId,
          (await t.db.select().from(customers).where(eq(customers.telegramId, vali.id)))[0]!.id,
        ),
      );

    const res = await fresh.client.me.shareContact({ body: { proof: contact(vali.id) } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const client = initClient(apiContract, {
      baseUrl: t.baseUrl,
      baseHeaders: { authorization: `Bearer ${res.body.session!.token}` },
      throwOnUnknownStatus: true,
    });
    const cart = await client.cart.get();
    if (cart.status !== 200) throw new Error();
    const byMl = Object.fromEntries(cart.body.lines.map((l) => [`${l.slug}:${l.ml}`, l.qty]));
    expect(byMl).toEqual({ [`${s1}:10`]: 3, [`${s2}:30`]: 1 });
    expect(cart.body.promoCode).toBe('FRESH');
    // the merged-away customer leaves no lines or cart row behind
    const lines = await t.db.select().from(cartLines);
    expect(lines.every((l) => l.customerId === oldRow!.id)).toBe(true);
    expect(await t.db.select().from(carts)).toHaveLength(1);
    expect((await t.db.select().from(carts))[0]).toMatchObject({
      customerId: oldRow!.id,
      discountChoice: { type: 'promo_code' },
    });
  });

  it('keeps the older cart code and choice when it has its own', async () => {
    const [s1] = await slugs();
    const old = await me(ali);
    await old.client.me.shareContact({ body: { proof: contact(ali.id) } });
    await old.add(s1!, 10);
    await t.db.update(carts).set({ promoCode: 'OLD' });
    const fresh = await me(vali);
    await fresh.add(s1!, 30);
    await t.db
      .update(carts)
      .set({ promoCode: 'NEW' })
      .where(
        eq(
          carts.customerId,
          (await t.db.select().from(customers).where(eq(customers.telegramId, vali.id)))[0]!.id,
        ),
      );
    const res = await fresh.client.me.shareContact({ body: { proof: contact(vali.id) } });
    if (res.status !== 200) throw new Error();
    expect((await t.db.select().from(carts))[0]?.promoCode).toBe('OLD');
  });
});
