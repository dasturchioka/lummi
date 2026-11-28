import sharp from 'sharp';
import {
  auditLog,
  cartLines,
  customers,
  discoverySet,
  discoverySetItems,
  eq,
  fragrances,
} from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { moveCartData } from '../src/cart/move-cart';
import { concentrateUl, FILL_UL, stockBottles } from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

const MAIN_NAME = { ru: 'Discovery set', uz: 'Discovery set' };

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.seedCatalog();
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const ali = { id: 51, first_name: 'Ali', language_code: 'ru' };

async function slugs(n = 8) {
  const rows = await t.db.select({ slug: fragrances.slug }).from(fragrances);
  return rows
    .map((r) => r.slug)
    .sort()
    .slice(0, n);
}
/** Exactly `bottles` 10 ml fills of the fragrance's concentrate (ADR 0043). */
const setTenMl = (slug: string, bottles: number) => stockBottles(t, slug, 10, bottles);
/** 10 ml bottles the fragrance's concentrate fills, reserve aside: the shelf's count of them. */
const tenMlOnHand = async (slug: string) =>
  Math.floor((await concentrateUl(t, slug)) / FILL_UL[10]);
const setOnHand = (onHand: number) => t.db.update(discoverySet).set({ onHand });

/** Raw POST: the contract does not list the 400 a schema failure answers with. */
async function rawPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${t.baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

describe('the Discovery set', () => {
  it('needs a session', async () => {
    expect((await t.client.sets.discovery()).status).toBe(401);
  });

  it('is a product with its price, five fragrances in order, and its own availability', async () => {
    const { client } = await t.signIn(ali);
    const res = await client.sets.discovery();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body).toMatchObject({ price: 299_000, available: 10, soldOut: false });
    expect(res.body.fragrances).toHaveLength(5);
    expect(res.body.fragrances.every((f) => f.brand.length > 0)).toBe(true);
  });

  it('is not for sale until the owner has picked five fragrances', async () => {
    await t.db.delete(discoverySetItems);
    const { client } = await t.signIn(ali);
    const res = await client.sets.discovery();
    expect(res.status === 200 && res.body.fragrances.length).toBe(0);
    expect(res.status === 200 && res.body.soldOut).toBe(true);
  });

  it('goes to the cart from its own stock and never touches 10 ml stock', async () => {
    const before = await slugs(8).then((s) => Promise.all(s.map(tenMlOnHand)));
    const { client } = await t.signIn(ali);
    const res = await client.cart.addDiscovery({ body: { qty: 2 } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ kind: 'discovery_set', qty: 2, available: 10 });
    expect(res.body.quote).toMatchObject({ itemsSubtotal: 598_000 });
    expect(res.body.quote.lines[0]).toMatchObject({ unitPrice: 299_000, lineTotal: 598_000 });
    expect(await slugs(8).then((s) => Promise.all(s.map(tenMlOnHand)))).toEqual(before);
  });

  it('adds up on one line and is capped at its own on hand', async () => {
    await setOnHand(3);
    const { client } = await t.signIn(ali);
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const res = await client.cart.addDiscovery({ body: { qty: 2 } });
    expect(res.status === 200 && res.body.lines.map((l) => [l.kind, l.qty, l.limited])).toEqual([
      ['discovery_set', 3, false],
    ]);
  });

  it('refuses a sold-out set, and a line left behind stays flagged and out of the sums', async () => {
    const { client } = await t.signIn(ali);
    await client.cart.addDiscovery({ body: { qty: 1 } });
    await setOnHand(0);
    const gone = await client.cart.addDiscovery({ body: { qty: 1 } });
    expect(gone.status).toBe(409);
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.lines[0]).toMatchObject({
      kind: 'discovery_set',
      soldOut: true,
      available: 0,
    });
    expect(cart.status === 200 && cart.body.quote.itemsSubtotal).toBe(0);
  });
});

describe('the builder', () => {
  it('offers only fragrances with a 10 ml available, at the Discovery set price', async () => {
    const [a, b] = await slugs(2);
    await setTenMl(a!, 0);
    const { client } = await t.signIn(ali);
    const res = await client.sets.builder();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const offered = res.body.options.map((o) => o.slug);
    expect(offered).not.toContain(a);
    expect(offered).toContain(b);
    expect(res.body).toMatchObject({ price: 299_000, size: 5 });
  });

  it('does not offer a hidden fragrance', async () => {
    const [a] = await slugs(1);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, a!));
    const { client } = await t.signIn(ali);
    const res = await client.sets.builder();
    expect(res.status === 200 && res.body.options.map((o) => o.slug)).not.toContain(a);
  });

  it('takes five different fragrances as one set line priced by the quote', async () => {
    const five = await slugs(5);
    const { client } = await t.signIn(ali);
    const res = await client.cart.addBuilder({ body: { slugs: five, qty: 2 } });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.lines).toHaveLength(1);
    const line = res.body.lines[0]!;
    expect(line).toMatchObject({ kind: 'builder_set', qty: 2 });
    expect(line.kind === 'builder_set' && line.fragrances.every((f) => f.brand.length > 0)).toBe(
      true,
    );
    expect(line.kind === 'builder_set' && line.fragrances.map((f) => f.slug).sort()).toEqual(
      [...five].sort(),
    );
    expect(res.body.quote.itemsSubtotal).toBe(598_000);
  });

  it('adds the same five up on one line, whatever the order picked', async () => {
    const five = await slugs(5);
    const { client } = await t.signIn(ali);
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const res = await client.cart.addBuilder({ body: { slugs: [...five].reverse(), qty: 1 } });
    expect(res.status === 200 && res.body.lines.map((l) => l.qty)).toEqual([2]);
  });

  it('keeps different fives on separate lines', async () => {
    const six = await slugs(6);
    const { client } = await t.signIn(ali);
    await client.cart.addBuilder({ body: { slugs: six.slice(0, 5) } });
    const res = await client.cart.addBuilder({ body: { slugs: six.slice(1) } });
    expect(res.status === 200 && res.body.lines).toHaveLength(2);
  });

  it('refuses a fragrance whose 10 ml is not available and names it', async () => {
    const five = await slugs(5);
    await setTenMl(five[2]!, 0);
    const { client } = await t.signIn(ali);
    const res = await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: 'unavailable', slugs: [five[2]] });
    expect(await t.db.select().from(cartLines)).toHaveLength(0);
  });

  it('refuses duplicates and a wrong count', async () => {
    const six = await slugs(6);
    const { token } = await t.signIn(ali);
    const url = '/cart/sets/builder';
    expect(await rawPost(token, url, { slugs: [six[0], six[0], six[1], six[2], six[3]] })).toBe(
      400,
    );
    expect(await rawPost(token, url, { slugs: six.slice(0, 4) })).toBe(400);
    expect(await rawPost(token, url, { slugs: six })).toBe(400);
    expect(await rawPost(token, url, { slugs: [] })).toBe(400);
    expect(await t.db.select().from(cartLines)).toHaveLength(0);
  });

  it('refuses an unknown fragrance', async () => {
    const four = await slugs(4);
    const { client } = await t.signIn(ali);
    const res = await client.cart.addBuilder({ body: { slugs: [...four, 'no-such-one'] } });
    expect(res.status).toBe(404);
  });

  it('is limited by the scarcest 10 ml among its five', async () => {
    const five = await slugs(5);
    await setTenMl(five[0]!, 2);
    const { client } = await t.signIn(ali);
    const res = await client.cart.addBuilder({ body: { slugs: five, qty: 5 } });
    expect(res.status === 200 && res.body.lines[0]).toMatchObject({
      qty: 2,
      available: 2,
    });
  });

  it('goes sold out when one of its five runs out, and comes back on restock', async () => {
    const five = await slugs(5);
    const { client } = await t.signIn(ali);
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await setTenMl(five[4]!, 0);
    const out = await client.cart.get();
    expect(out.status === 200 && out.body.lines[0]).toMatchObject({ soldOut: true });
    expect(out.status === 200 && out.body.quote.itemsSubtotal).toBe(0);
    // the server names the one that is short; the client does no stock arithmetic
    const line = out.status === 200 ? out.body.lines[0] : undefined;
    expect(line?.kind === 'builder_set' && line.short).toEqual([
      { slug: five[4], name: expect.any(String), inCart: false },
    ]);
    await setTenMl(five[4]!, 4);
    const back = await client.cart.get();
    expect(back.status === 200 && back.body.lines[0]).toMatchObject({ soldOut: false, qty: 1 });
  });

  it('says a 10 ml is short only because an earlier line of the cart holds it', async () => {
    const five = await slugs(5);
    await setTenMl(five[0]!, 1);
    const { client } = await t.signIn(ali);
    await client.cart.addLine({ body: { slug: five[0]!, ml: 10, qty: 1 } });
    const res = await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const line =
      res.status === 200 ? res.body.lines.find((l) => l.kind === 'builder_set') : undefined;
    expect(line).toMatchObject({ soldOut: true });
    expect(line?.kind === 'builder_set' && line.short).toEqual([
      { slug: five[0], name: expect.any(String), inCart: true },
    ]);
    // checkout is not blocked and the line is out of the quote
    expect(res.status === 200 && res.body.lines).toHaveLength(2);
  });

  it('follows the Discovery set price when the owner changes it', async () => {
    const five = await slugs(5);
    const { client } = await t.signIn(ali);
    await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await client.cart.addDiscovery({ body: { qty: 1 } });
    const ids = (await owner.client.admin.sets.get()).body as { composition: { id: number }[] };
    const res = await owner.client.admin.sets.update({
      body: { name: MAIN_NAME, price: 250_000, composition: ids.composition.map((c) => c.id) },
    });
    expect(res.status).toBe(200);
    const cart = await client.cart.get();
    expect(cart.status === 200 && cart.body.quote.itemsSubtotal).toBe(500_000);
    const b = await client.sets.builder();
    expect(b.status === 200 && b.body.price).toBe(250_000);
  });
});

describe('admin: the Discovery set', () => {
  it('shows the set with its own on hand, reserve and available', async () => {
    const res = await manager.client.admin.sets.get();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: 299_000, onHand: 10, reserved: 0, available: 10 });
  });

  it('lets only the owner change price and composition, and audits it', async () => {
    const got = await owner.client.admin.sets.get();
    const ids = (got.body as { composition: { id: number }[] }).composition.map((c) => c.id);
    const denied = await manager.client.admin.sets.update({
      body: { name: MAIN_NAME, price: 100_000, composition: ids },
    });
    expect(denied.status).toBe(403);
    const reordered = [...ids].reverse();
    const ok = await owner.client.admin.sets.update({
      body: { name: MAIN_NAME, price: 310_000, composition: reordered },
    });
    expect(ok.status).toBe(200);
    expect(ok.status === 200 && ok.body.composition.map((c) => c.id)).toEqual(reordered);
    expect(ok.status === 200 && ok.body.isPlaceholder).toBe(false);
    const [row] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'sets.discovery_changed'));
    expect(row).toMatchObject({ actorId: owner.staff.id, targetType: 'discovery_set' });
  });

  it('keeps an https Uzum link for the set, clears it when empty, and refuses anything else', async () => {
    const got = await owner.client.admin.sets.get();
    const ids = (got.body as { composition: { id: number }[] }).composition.map((c) => c.id);
    const put = async (uzumUrl: string) =>
      (
        await fetch(`${t.baseUrl}/admin/sets/discovery`, {
          method: 'PUT',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: MAIN_NAME, price: 299_000, composition: ids, uzumUrl }),
        })
      ).status;
    const { client } = await t.signIn(ali);
    const shop = () => client.sets.discovery();
    expect((await shop()).body).toMatchObject({ uzumUrl: null });
    expect(await put('http://uzum.uz/x')).toBe(400);
    expect(await put('javascript:alert(1)')).toBe(400);
    expect(await put('  https://uzum.uz/product/lummi-discovery  ')).toBe(200);
    expect((await shop()).body).toMatchObject({
      uzumUrl: 'https://uzum.uz/product/lummi-discovery',
    });
    // a save without the field keeps the link; an empty one clears it
    const kept = await owner.client.admin.sets.update({
      body: { name: MAIN_NAME, price: 299_000, composition: ids },
    });
    expect(kept.status === 200 && kept.body.uzumUrl).toBe(
      'https://uzum.uz/product/lummi-discovery',
    );
    expect(await put('')).toBe(200);
    expect((await shop()).body).toMatchObject({ uzumUrl: null });
  });

  it('refuses a repeat, a wrong count and an unknown fragrance', async () => {
    const got = await owner.client.admin.sets.get();
    const ids = (got.body as { composition: { id: number }[] }).composition.map((c) => c.id);
    const send = async (composition: number[]) =>
      (
        await fetch(`${t.baseUrl}/admin/sets/discovery`, {
          method: 'PUT',
          headers: { cookie: owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: MAIN_NAME, price: 1000, composition }),
        })
      ).status;
    expect(await send([ids[0]!, ids[0]!, ids[1]!, ids[2]!, ids[3]!])).toBe(400);
    expect(await send(ids.slice(0, 4))).toBe(400);
    expect(await send([...ids.slice(0, 4), 999_999])).toBe(422);
  });

  it('lets a manager count the boxes, audited', async () => {
    const res = await manager.client.admin.sets.setOnHand({
      body: { onHand: 7, reason: 'Пересчёт' },
    });
    expect(res.status === 200 && res.body.onHand).toBe(7);
    const [row] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'sets.discovery_on_hand_changed'));
    expect(row).toMatchObject({ actorId: manager.staff.id });
  });
});

describe('admin: the Discovery set photo', () => {
  const upload = (as: StaffSession, body: Uint8Array, type = 'image/png') =>
    fetch(`${t.baseUrl}/admin/sets/discovery/photo`, {
      method: 'PUT',
      headers: { cookie: as.cookie, 'content-type': type },
      body: body as never,
    });
  const png = (w = 900, h = 1200) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#c8beb4' } })
      .png()
      .toBuffer();

  it('stores the 3:4 set, shows it on the set and audits', async () => {
    const res = await upload(owner, await png());
    expect(res.status).toBe(200);
    const { photo } = (await res.json()) as { photo: string };
    expect(photo).toMatch(/^[a-f0-9]{16}$/);
    expect(t.edges.files.files.has(`public/${photo}-800.webp`)).toBe(true);
    const { client } = await t.signIn(ali);
    const set = await client.sets.discovery();
    expect(set.status === 200 && set.body.photo).toBe(photo);
    const [row] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'sets.discovery_photo_uploaded'));
    expect(row).toMatchObject({ actorId: owner.staff.id });
  });

  it("is the owner's, and refuses a small or non-image file", async () => {
    expect((await upload(manager, await png())).status).toBe(403);
    expect((await upload(owner, await png(200, 260))).status).toBe(422);
    expect((await upload(owner, Buffer.from('not an image'))).status).toBe(415);
  });
});

describe('relink', () => {
  it("adds set lines to the older customer's cart and leaves none behind", async () => {
    const five = await slugs(5);
    const a = await t.signIn(ali);
    const b = await t.signIn({ id: 52, first_name: 'Vali', language_code: 'uz' });
    await a.client.cart.addDiscovery({ body: { qty: 1 } });
    await a.client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    await b.client.cart.addDiscovery({ body: { qty: 2 } });
    await b.client.cart.addBuilder({ body: { slugs: five, qty: 2 } });
    const rows = await t.db.select({ id: customers.id, tg: customers.telegramId }).from(customers);
    const idOf = (tg: number) => rows.find((r) => Number(r.tg) === tg)!.id;
    await t.db.transaction((tx) => moveCartData(tx, idOf(52), idOf(51), new Date()));
    const cart = await a.client.cart.get();
    expect(cart.status === 200 && cart.body.lines.map((l) => [l.kind, l.qty])).toEqual([
      ['discovery_set', 3],
      ['builder_set', 3],
    ]);
    expect(
      await t.db
        .select()
        .from(cartLines)
        .where(eq(cartLines.customerId, idOf(52))),
    ).toHaveLength(0);
  });
});

describe('hidden fragrances', () => {
  it('the builder answers a hidden slug like an unknown one', async () => {
    const five = await slugs(5);
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, five[1]!));
    const { client } = await t.signIn(ali);
    const hidden = await client.cart.addBuilder({ body: { slugs: five, qty: 1 } });
    const unknown = await client.cart.addBuilder({
      body: { slugs: [...five.slice(0, 4), 'no-such-one'], qty: 1 },
    });
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(unknown.body);
  });

  it('the Discovery box shows a hidden fragrance by name and attribution only, and stays on sale', async () => {
    const { client } = await t.signIn(ali);
    const before = await client.sets.discovery();
    const first = before.status === 200 ? before.body.fragrances[0]! : null;
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.slug, first!.slug!));
    const res = await client.sets.discovery();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.soldOut).toBe(false);
    expect(res.body.fragrances[0]).toEqual({
      slug: null,
      name: first!.name,
      brand: first!.brand,
      keyNotes: { ru: [], uz: [] },
    });
    expect(res.body.fragrances[1]!.slug).not.toBeNull();
    const added = await client.cart.addDiscovery({ body: { qty: 1 } });
    expect(added.status).toBe(200);
  });

  it('the admin set marks the hidden fragrance so the page can warn', async () => {
    const first = (await owner.client.admin.sets.get()).body as { composition: { id: number }[] };
    await t.db
      .update(fragrances)
      .set({ hidden: true })
      .where(eq(fragrances.id, first.composition[0]!.id));
    const res = await owner.client.admin.sets.get();
    expect(res.status === 200 && res.body.composition.map((c) => c.hidden)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('admin: the not-for-sale rule and the placeholder flag', () => {
  it('reports available 0 while the composition is not five, as the shop does', async () => {
    await t.db.delete(discoverySetItems).where(eq(discoverySetItems.position, 5));
    const res = await manager.client.admin.sets.get();
    expect(res.status === 200 && [res.body.onHand, res.body.available]).toEqual([10, 0]);
  });

  it('clears the placeholder flag on any owner save of the price, even unchanged', async () => {
    const got = await owner.client.admin.sets.get();
    expect(got.status === 200 && got.body.isPlaceholder).toBe(true);
    const ids = (got.body as { composition: { id: number }[] }).composition.map((c) => c.id);
    const res = await owner.client.admin.sets.update({
      body: { name: MAIN_NAME, price: 299_000, composition: ids },
    });
    expect(res.status === 200 && res.body.isPlaceholder).toBe(false);
  });
});

describe('relink keeps the per-line ceiling', () => {
  it('caps volume and set lines at 99 when two carts of 60 merge', async () => {
    const five = await slugs(5);
    await t.db.update(fragrances).set({ concentrateUl: 500 * FILL_UL[10] });
    await t.db.update(discoverySet).set({ onHand: 500 });
    const a = await t.signIn(ali);
    const b = await t.signIn({ id: 53, first_name: 'Sam', language_code: 'ru' });
    for (const c of [a, b]) {
      await c.client.cart.addLine({ body: { slug: five[0]!, ml: 10, qty: 60 } });
      await c.client.cart.addDiscovery({ body: { qty: 60 } });
    }
    const rows = await t.db.select({ id: customers.id, tg: customers.telegramId }).from(customers);
    const idOf = (tg: number) => rows.find((r) => Number(r.tg) === tg)!.id;
    await t.db.transaction((tx) => moveCartData(tx, idOf(53), idOf(51), new Date()));
    const cart = await a.client.cart.get();
    expect(cart.status === 200 && cart.body.lines.map((l) => l.qty)).toEqual([99, 99]);
  });
});
