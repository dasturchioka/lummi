import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLog, discoverySet, eq, fragrances, settings, sql, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { reservedByVolume } from '../src/catalog/catalog.service';
import { seedCatalog } from '../src/catalog/seed';
import { reservedDiscovery } from '../src/sets/sets';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf, tenMl } from './harness/orders';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-11T10:00:00Z'));
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const ali: TestUser = { id: 71, first_name: 'Ali', language_code: 'ru' };
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

/** One page of the stock list, as the panel asks for it. */
async function page(as: StaffSession = manager, query: Record<string, string> = {}) {
  const res = await as.client.admin.stock.list({ query });
  if (res.status !== 200) throw new Error(`stock ${res.status}`);
  return res.body;
}
/** Every page of it, merged: most tests care about the rows, not the paging. */
async function list(as: StaffSession = manager, query: Record<string, string> = {}) {
  const first = await page(as, { ...query, pageSize: '50', page: '1' });
  const rows = [...first.rows];
  for (let p = 2; (p - 1) * 50 < first.total; p++) {
    rows.push(...(await page(as, { ...query, pageSize: '50', page: String(p) })).rows);
  }
  return { ...first, rows };
}
async function volumeRow(slug: string, ml: number, as: StaffSession = manager) {
  const { id } = await tenMl(t, slug);
  const rows = (await list(as)).rows;
  return { id, row: rows.find((r) => r.volumeId === id && r.ml === ml)! };
}
async function discoveryRow() {
  return (await list()).rows.find((r) => r.kind === 'discovery')!;
}

/** Reserves `qty` of a fragrance's 10 ml for a shopper. */
async function reserve(slug: string, qty: number, user: TestUser = ali) {
  const client = await shopper(t, user, `99890${user.id}0000`.slice(0, 12));
  await client.cart.addLine({ body: { slug, ml: 10, qty } });
  const point = await samarkandPoint(t);
  const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
  if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
  const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
  if (res.status !== 201) throw new Error(`order ${res.status}`);
  return client;
}

describe('who may open the stock page', () => {
  it('refuses a signed-out caller and a shopper session, allows owner and manager', async () => {
    expect((await t.client.admin.stock.list({ query: {} })).status).toBe(401);
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/stock`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect((await owner.client.admin.stock.list({ query: {} })).status).toBe(200);
    expect((await manager.client.admin.stock.list({ query: {} })).status).toBe(200);
  });

  it('refuses an on-hand edit from a shopper session', async () => {
    const [slug] = await slugsOf(t, 1);
    const { id } = await tenMl(t, slug!);
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/volumes/${id}/on-hand`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ onHand: 99 }),
    });
    expect(res.status).toBe(401);
    expect((await volumeRow(slug!, 10)).row.onHand).toBe(20);
  });
});

describe('the rows', () => {
  it('has one row per volume plus the Discovery set, with the same reserve checkout uses', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 2);
    const { rows, lowThreshold } = await list();
    expect(lowThreshold).toBe(3);
    const count = await t.db.select().from(volumes);
    expect(rows.filter((r) => r.kind === 'volume')).toHaveLength(count.length);
    expect(rows.filter((r) => r.kind === 'discovery')).toHaveLength(1);

    const reserved = await reservedByVolume(
      t.db,
      count.map((v) => v.id),
    );
    for (const r of rows.filter((x) => x.kind === 'volume')) {
      expect(r.reserved).toBe(reserved.get(r.volumeId!));
      expect(r.available).toBe(Math.max(0, r.onHand - r.reserved));
    }
    const { id } = await tenMl(t, slug!);
    expect(rows.find((r) => r.volumeId === id)).toMatchObject({
      reserved: 2,
      onHand: 20,
      available: 18,
    });
    expect((await discoveryRow()).reserved).toBe(await reservedDiscovery(t.db));
  });

  it("reports the Discovery set's own reserve, not a 10 ml one", async () => {
    await t.db.update(discoverySet).set({ onHand: 5 });
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error('checkout');
    await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
    expect(await discoveryRow()).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
  });
});

describe('an on-hand edit', () => {
  it('changes available and is audited with the actor', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 2);
    const { id } = await volumeRow(slug!, 10);
    const res = await manager.client.admin.onHand.set({
      params: { id },
      body: { onHand: 12, expected: 20 },
    });
    expect(res.status === 200 && res.body).toMatchObject({
      onHand: 12,
      reserved: 2,
      available: 10,
      belowReserve: false,
    });
    expect((await volumeRow(slug!, 10)).row).toMatchObject({ onHand: 12, available: 10 });
    const [row] = await audits('catalog.on_hand_changed');
    expect(row).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
    expect(row?.payload).toMatchObject({ ml: 10, onHand: [20, 12] });
  });

  it('is allowed below the reserve and says so', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 3);
    const { id } = await volumeRow(slug!, 10);
    const res = await owner.client.admin.onHand.set({
      params: { id },
      body: { onHand: 1, expected: 20 },
    });
    expect(res.status === 200 && res.body).toMatchObject({
      onHand: 1,
      reserved: 3,
      available: 0,
      belowReserve: true,
    });
    expect((await volumeRow(slug!, 10)).row).toMatchObject({ onHand: 1, belowReserve: true });
  });

  it('answers 409 with the current count when it moved meanwhile, and writes nothing', async () => {
    const [slug] = await slugsOf(t, 1);
    const { id } = await volumeRow(slug!, 10);
    await owner.client.admin.onHand.set({ params: { id }, body: { onHand: 8 } });
    const res = await manager.client.admin.onHand.set({
      params: { id },
      body: { onHand: 15, expected: 20 },
    });
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({ code: 'on_hand_changed', current: 8 });
    expect((await volumeRow(slug!, 10)).row.onHand).toBe(8);
    expect(await audits('catalog.on_hand_changed')).toHaveLength(1);
    // the editor retries from the value it was shown
    const retry = await manager.client.admin.onHand.set({
      params: { id },
      body: { onHand: 15, expected: 8 },
    });
    expect(retry.status).toBe(200);
  });

  it('lets exactly one of two edits from the same count win', async () => {
    const [slug] = await slugsOf(t, 1);
    const { id } = await volumeRow(slug!, 10);
    const [a, b] = await Promise.all([
      owner.client.admin.onHand.set({ params: { id }, body: { onHand: 7, expected: 20 } }),
      manager.client.admin.onHand.set({ params: { id }, body: { onHand: 9, expected: 20 } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? 7 : 9;
    expect((await volumeRow(slug!, 10)).row.onHand).toBe(winner);
    expect(await audits('catalog.on_hand_changed')).toHaveLength(1);
  });

  it('still takes an edit without `expected` (the older callers)', async () => {
    const [slug] = await slugsOf(t, 1);
    const { id } = await volumeRow(slug!, 10);
    const res = await manager.client.admin.onHand.set({ params: { id }, body: { onHand: 4 } });
    expect(res.status).toBe(200);
  });
});

describe('the Discovery set follows the same rules', () => {
  it('changes available, flags below reserve, audits, and 409s on a stale count', async () => {
    await t.db.update(discoverySet).set({ onHand: 5 });
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error('checkout');
    await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });

    const ok = await manager.client.admin.sets.setOnHand({ body: { onHand: 10, expected: 5 } });
    expect(ok.status === 200 && ok.body).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
    expect(await discoveryRow()).toMatchObject({ onHand: 10, available: 8, belowReserve: false });

    const stale = await owner.client.admin.sets.setOnHand({ body: { onHand: 20, expected: 5 } });
    expect(stale.status).toBe(409);
    expect(stale.status === 409 && stale.body).toEqual({ code: 'on_hand_changed', current: 10 });
    expect((await discoveryRow()).onHand).toBe(10);

    const below = await owner.client.admin.sets.setOnHand({ body: { onHand: 1, expected: 10 } });
    expect(below.status).toBe(200);
    expect(await discoveryRow()).toMatchObject({ onHand: 1, reserved: 2, belowReserve: true });
    const rows = await audits('sets.discovery_on_hand_changed');
    expect(rows.map((r) => r.actorId)).toEqual([manager.staff.id, owner.staff.id]);
  });
});

describe('paging (by fragrance)', () => {
  const fragranceCount = async () => (await t.db.select().from(fragrances)).length;
  const ids = (rows: { fragranceId: number | null }[]) => [
    ...new Set(rows.map((r) => r.fragranceId).filter((id) => id !== null)),
  ];

  it('holds whole fragrances, the Discovery set first on page 1 only, and nothing twice', async () => {
    const total = await fragranceCount();
    const one = await page(manager, { pageSize: '5' });
    expect(one).toMatchObject({ total, page: 1, pageSize: 5 });
    expect(one.rows[0]?.kind).toBe('discovery');
    const volumesOnPage = one.rows.filter((r) => r.kind === 'volume');
    expect(ids(volumesOnPage)).toHaveLength(5);
    expect(volumesOnPage).toHaveLength(15); // every volume of those five, none split off
    const two = await page(manager, { pageSize: '5', page: '2' });
    expect(two.rows.some((r) => r.kind === 'discovery')).toBe(false);
    expect(ids(two.rows).filter((id) => ids(volumesOnPage).includes(id))).toEqual([]);
    // the last page holds the remainder; past the end is empty but still says how many there are
    const lastPage = Math.ceil(total / 5);
    expect(ids((await page(manager, { pageSize: '5', page: String(lastPage) })).rows)).toHaveLength(
      total - (lastPage - 1) * 5,
    );
    const past = await page(manager, { pageSize: '5', page: String(lastPage + 1) });
    expect(past).toMatchObject({ rows: [], total });
  });

  it('filters and searches cover every page: only matching fragrances count, wherever they sort', async () => {
    const all = await t.db
      .select({ id: fragrances.id })
      .from(fragrances)
      .orderBy(sql`lower(${fragrances.name})`);
    const spread = [all[0]!.id, all[30]!.id, all[60]!.id];
    for (const id of spread) {
      await t.db.update(volumes).set({ onHand: 1 }).where(eq(volumes.fragranceId, id));
    }
    const one = await page(manager, { filter: 'low', pageSize: '2' });
    expect(one.total).toBe(3);
    expect(ids(one.rows)).toEqual([spread[0], spread[1]]);
    expect(one.rows.every((r) => r.level !== 'ok')).toBe(true);
    const two = await page(manager, { filter: 'low', pageSize: '2', page: '2' });
    expect(ids(two.rows)).toEqual([spread[2]]);
    // a hidden fragrance deep in the list is on page 1 of the hidden filter
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, all[60]!.id));
    const hidden = await page(manager, { visibility: 'hidden', pageSize: '2' });
    expect(hidden.total).toBe(1);
    expect(ids(hidden.rows)).toEqual([all[60]!.id]);
  });

  it('refuses a page size above the maximum', async () => {
    const res = await fetch(`${t.baseUrl}/admin/stock?pageSize=500`, {
      headers: { cookie: manager.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe('filters and search', () => {
  async function arrange() {
    const [a, b, c] = await slugsOf(t, 3);
    const va = await tenMl(t, a!);
    const vb = await tenMl(t, b!);
    const vc = await tenMl(t, c!);
    await t.db.update(volumes).set({ onHand: 2 }).where(eq(volumes.id, va.id)); // low
    await t.db.update(volumes).set({ onHand: 0 }).where(eq(volumes.id, vb.id)); // zero
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, vc.fragranceId));
    return { va, vb, vc, names: [a!, b!, c!] };
  }

  it('low includes zero, zero is only zero', async () => {
    const { va, vb } = await arrange();
    const low = (await list(manager, { filter: 'low' })).rows.filter((r) => r.kind === 'volume');
    expect(low.map((r) => r.volumeId).sort()).toEqual([va.id, vb.id].sort());
    const zero = (await list(manager, { filter: 'zero' })).rows;
    expect(zero.map((r) => r.volumeId)).toEqual([vb.id]);
  });

  it('carries the level the server decided, for volumes and the Discovery set', async () => {
    const { va, vb } = await arrange();
    const rows = (await list()).rows;
    const level = (id: number) => rows.find((r) => r.volumeId === id)?.level;
    expect([level(va.id), level(vb.id)]).toEqual(['low', 'zero']);
    expect(rows.find((r) => r.kind === 'discovery')?.level).toBe('ok');
    await t.db.update(discoverySet).set({ onHand: 0 });
    expect((await discoveryRow()).level).toBe('zero');
    // the Discovery page reports the same warning flag as the stock page
    const set = await manager.client.admin.sets.get();
    expect(set.status === 200 && set.body.belowReserve).toBe(false);
  });

  it('follows the threshold setting', async () => {
    const { va } = await arrange();
    await t.db.insert(settings).values({ key: 'stock.lowAvailableThreshold', value: 1 });
    const body = await list(manager, { filter: 'low' });
    expect(body.lowThreshold).toBe(1);
    expect(body.rows.map((r) => r.volumeId)).not.toContain(va.id);
  });

  it('hidden fragrances only, or visible only', async () => {
    const { vc } = await arrange();
    const hidden = (await list(manager, { visibility: 'hidden' })).rows;
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((r) => r.hidden && r.kind === 'volume')).toBe(true);
    expect(hidden.some((r) => r.volumeId === vc.id)).toBe(true);
    const visible = (await list(manager, { visibility: 'visible' })).rows;
    expect(visible.some((r) => r.hidden)).toBe(false);
    expect(visible.some((r) => r.kind === 'discovery')).toBe(true);
  });

  it('searches by fragrance name, ignoring case, and finds the Discovery set', async () => {
    const [slug] = await slugsOf(t, 1);
    const [f] = await t.db
      .select({ name: fragrances.name })
      .from(fragrances)
      .where(eq(fragrances.slug, slug!));
    const rows = (await list(manager, { q: f!.name.toUpperCase() })).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every((r) => r.name === null || r.name.toLowerCase().includes(f!.name.toLowerCase())),
    ).toBe(true);
    expect((await list(manager, { q: 'discovery' })).rows.map((r) => r.kind)).toEqual([
      'discovery',
    ]);
    expect((await list(manager, { q: 'zzzzqqq' })).rows).toEqual([]);
  });

  it('ignores apostrophe variants on both sides', async () => {
    const [slug] = await slugsOf(t, 1);
    await t.db
      .update(fragrances)
      .set({ name: 'Devil’s Intrigue' })
      .where(eq(fragrances.slug, slug!));
    for (const q of ['Devil’s', "Devil's", 'Devils', 'devilʻs int']) {
      const rows = (await list(manager, { q })).rows.filter((r) => r.kind === 'volume');
      expect(
        rows.map((r) => r.name),
        q,
      ).toContain('Devil’s Intrigue');
    }
    await t.db.update(fragrances).set({ name: "Bal d'Afrique" }).where(eq(fragrances.slug, slug!));
    expect(
      (await list(manager, { q: 'Bal d’Afrique' })).rows.some((r) => r.name === "Bal d'Afrique"),
    ).toBe(true);
  });
});
