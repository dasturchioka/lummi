import { customers, discoverySet, eq, fragrances } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { moveCustomerData } from '../src/auth/customers.service';
import { createTestApp, type TestApp } from './harness/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.seedCatalog();
});

const ali = { id: 61, first_name: 'Ali', language_code: 'ru' };
const vali = { id: 62, first_name: 'Vali', language_code: 'uz' };

async function slugs(n = 4) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}

describe('favourites', () => {
  it('needs a session', async () => {
    const [a] = await slugs(1);
    expect((await t.client.favourites.ids()).status).toBe(401);
    expect((await t.client.favourites.list()).status).toBe(401);
    expect((await t.client.favourites.add({ params: { target: a! } })).status).toBe(401);
    expect((await t.client.favourites.remove({ params: { target: a! } })).status).toBe(401);
  });

  it('starts empty and works before registration (no phone)', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.favourites.ids();
    expect(res.status === 200 && res.body).toEqual({ slugs: [], discoverySet: false });
    const [a] = await slugs(1);
    const add = await client.favourites.add({ params: { target: a! } });
    expect(add.status === 200 && add.body.slugs).toEqual([a]);
  });

  it('adds and removes idempotently', async () => {
    const [a, b] = await slugs(2);
    const { client } = await t.signIn(ali);
    await client.favourites.add({ params: { target: a! } });
    const again = await client.favourites.add({ params: { target: a! } });
    expect(again.status === 200 && again.body.slugs).toEqual([a]);
    await client.favourites.add({ params: { target: b! } });
    const ids = await client.favourites.ids();
    expect(ids.status === 200 && [...ids.body.slugs].sort()).toEqual([a, b].sort());

    await client.favourites.remove({ params: { target: a! } });
    const gone = await client.favourites.remove({ params: { target: a! } });
    expect(gone.status === 200 && gone.body.slugs).toEqual([b]);
    // removing something never saved is fine too
    const [c] = await slugs(3).then((s) => s.slice(2));
    expect((await client.favourites.remove({ params: { target: c! } })).status).toBe(200);
  });

  it('keeps each customer to their own', async () => {
    const [a, b] = await slugs(2);
    const x = await t.signIn(ali);
    const y = await t.signIn(vali);
    await x.client.favourites.add({ params: { target: a! } });
    await y.client.favourites.add({ params: { target: b! } });
    const xs = await x.client.favourites.ids();
    const ys = await y.client.favourites.ids();
    expect(xs.status === 200 && xs.body.slugs).toEqual([a]);
    expect(ys.status === 200 && ys.body.slugs).toEqual([b]);
    // y removing a does not touch x
    await y.client.favourites.remove({ params: { target: a! } });
    const after = await x.client.favourites.ids();
    expect(after.status === 200 && after.body.slugs).toEqual([a]);
  });

  it('answers 404 for an unknown or hidden fragrance', async () => {
    const [a] = await slugs(1);
    const { client } = await t.signIn(ali);
    expect((await client.favourites.add({ params: { target: 'no-such-one' } })).status).toBe(404);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, a!));
    expect((await client.favourites.add({ params: { target: a! } })).status).toBe(404);
  });

  it('lists cards with price and availability, newest first, and drops a hidden fragrance', async () => {
    const [a, b, c] = await slugs(3);
    const { client } = await t.signIn(ali);
    for (const s of [a, b, c]) await client.favourites.add({ params: { target: s! } });
    const res = await client.favourites.list();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.items.map((i) => i.slug)).toEqual([c, b, a]);
    expect(res.body.items[0]).toHaveProperty('fromPrice');
    expect(res.body.items[0]).toHaveProperty('soldOut');
    expect(res.body.discoverySet).toBeNull();

    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, b!));
    const list = await client.favourites.list();
    expect(list.status === 200 && list.body.items.map((i) => i.slug)).toEqual([c, a]);
    const ids = await client.favourites.ids();
    expect(ids.status === 200 && [...ids.body.slugs].sort()).toEqual([a, c].sort());
    // shown again once the owner unhides it
    await t.db.update(fragrances).set({ hidden: false }).where(eq(fragrances.slug, b!));
    const back = await client.favourites.list();
    expect(back.status === 200 && back.body.items).toHaveLength(3);
  });

  it('can hold the Discovery set, idempotently, with its price and availability', async () => {
    const { client } = await t.signIn(ali);
    await t.db.update(discoverySet).set({ onHand: 3 });
    await client.favourites.add({ params: { target: 'discovery-set' } });
    const again = await client.favourites.add({ params: { target: 'discovery-set' } });
    expect(again.status === 200 && again.body).toEqual({ slugs: [], discoverySet: true });
    const list = await client.favourites.list();
    expect(list.status === 200 && list.body.discoverySet).toMatchObject({
      available: 3,
      soldOut: false,
    });
    const other = await t.signIn(vali);
    const theirs = await other.client.favourites.ids();
    expect(theirs.status === 200 && theirs.body.discoverySet).toBe(false);

    await client.favourites.remove({ params: { target: 'discovery-set' } });
    const gone = await client.favourites.remove({ params: { target: 'discovery-set' } });
    expect(gone.status === 200 && gone.body.discoverySet).toBe(false);
  });
});

describe('relink', () => {
  it("moves the merged-away customer's favourites to the older one, without doubles", async () => {
    const [a, b, c] = await slugs(3);
    const old = await t.signIn(ali);
    const fresh = await t.signIn(vali);
    await old.client.favourites.add({ params: { target: a! } });
    await old.client.favourites.add({ params: { target: b! } });
    await fresh.client.favourites.add({ params: { target: b! } });
    await fresh.client.favourites.add({ params: { target: c! } });
    await fresh.client.favourites.add({ params: { target: 'discovery-set' } });
    await old.client.favourites.add({ params: { target: 'discovery-set' } });

    const rows = await t.db.select({ id: customers.id, tg: customers.telegramId }).from(customers);
    const idOf = (tg: number) => rows.find((r) => Number(r.tg) === tg)!.id;
    await t.db.transaction((tx) => moveCustomerData(tx, idOf(62), idOf(61), new Date()));

    const mine = await old.client.favourites.ids();
    expect(mine.status === 200 && [...mine.body.slugs].sort()).toEqual([a, b, c].sort());
    expect(mine.status === 200 && mine.body.discoverySet).toBe(true);
    const gone = await fresh.client.favourites.ids();
    expect(gone.status === 200 && gone.body).toEqual({ slugs: [], discoverySet: false });
  });
});
