import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StockFragranceRow } from '@lummi/contracts';
import { auditLog, discoverySet, eq, fragrances, settings, sql, stockMoves } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { readLiquidStock } from '../src/catalog/catalog.service';
import { reservedDiscovery } from '../src/sets/sets';
import { orderBody, samarkandPoint, shopper, slugs as slugsOf } from './harness/orders';
import {
  concentrateUl,
  FILL_UL,
  fragranceIdOf,
  setConcentrateUl,
  stockBottles,
} from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';
import type { TestUser } from './harness/sign-init-data';

/**
 * Seam 1 (ADR 0028): the stock page (#27) in liquid (ADR 0043): a row per fragrance with its ready
 * concentrate, what orders hold of it, what is free, the bottles that fills, and its oil; the
 * Discovery sets' own boxes. A 10 ml fill is 10.3 ml at the default filling loss.
 */
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
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
  owner = await t.ownerSession();
  manager = await t.managerSession();
  // a first order would carry a 5 ml gift sample from whichever fragrance has the most; the
  // reserves here are each order's own bottles
  await t.db.insert(settings).values({ key: 'giftSample.enabled', value: false });
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
  const rows = [...first.fragrances];
  for (let p = 2; (p - 1) * 50 < first.total; p++) {
    rows.push(...(await page(as, { ...query, pageSize: '50', page: String(p) })).fragrances);
  }
  return { ...first, fragrances: rows };
}
async function fragranceRow(slug: string, as: StaffSession = manager): Promise<StockFragranceRow> {
  const id = await fragranceIdOf(t, slug);
  return (await list(as)).fragrances.find((r) => r.fragranceId === id)!;
}
/** The 5 × 10 ml set's row (its key is the one it had before the 5 × 5 ml set). */
async function discoveryRow() {
  return (await list()).sets.find((r) => r.key === 'discovery')!;
}
const count = (id: number, ml: number, expectedMl?: number, as = manager) =>
  as.client.admin.warehouse.countConcentrate({
    params: { id },
    body: { ml, reason: 'Пересчёт', ...(expectedMl === undefined ? {} : { expectedMl }) },
  });

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

  it('refuses a concentrate count from a shopper session', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    const { token } = await t.signIn(ali);
    const res = await fetch(`${t.baseUrl}/admin/warehouse/fragrances/${id}/concentrate`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ml: 99, reason: 'x' }),
    });
    expect(res.status).toBe(401);
    expect((await fragranceRow(slug!)).concentrateMl).toBe(1000);
  });
});

describe('the rows', () => {
  it('has one row per fragrance plus the Discovery sets, with the same reserve checkout uses', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 2);
    const { fragrances: rows, sets, lowThreshold, lowConcentrateMl, lowOilMl } = await list();
    expect([lowThreshold, lowConcentrateMl, lowOilMl]).toEqual([3, 300, 300]);
    const all = await t.db.select().from(fragrances);
    expect(rows).toHaveLength(all.length);
    // both Discovery sets (ADR 0042), each with its own row
    expect(sets.map((r) => r.vialMl)).toEqual([10, 5]);

    const stock = await readLiquidStock(
      t.db,
      all.map((f) => f.id),
    );
    for (const r of rows) {
      expect(r.reservedMl * 1000).toBe(stock.of(r.fragranceId).reservedUl);
      expect(r.availableMl).toBe(Math.max(0, r.concentrateMl - r.reservedMl));
    }
    const id = await fragranceIdOf(t, slug!);
    // two 10 ml fills held: 20.6 of 1 000 ml
    expect(rows.find((r) => r.fragranceId === id)).toMatchObject({
      concentrateMl: 1000,
      reservedMl: 20.6,
      availableMl: 979.4,
      belowReserve: false,
      level: 'ok',
      bottles: [
        { ml: 10, available: 95 },
        { ml: 30, available: 31 },
        { ml: 50, available: 19 },
      ],
    });
    expect((await discoveryRow()).reserved).toBe(await reservedDiscovery(t.db, 'discovery'));
  });

  it('shows the oil in grams and in ml by the density, with its own level', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    await t.db.update(fragrances).set({ oilMg: 190_000 }).where(eq(fragrances.id, id));
    await t.db.insert(settings).values({ key: 'cost.liquid.oilDensity', value: 0.95 });
    // 190 g ÷ 0.95 g/ml = 200 ml: at or under 300 ml, «Мало масла»
    expect(await fragranceRow(slug!)).toMatchObject({ oilGrams: 190, oilMl: 200, oilLevel: 'low' });
    await t.db.insert(settings).values({ key: 'stock.lowOilMl', value: 100 });
    expect((await fragranceRow(slug!)).oilLevel).toBe('ok');
  });

  it("reports the Discovery set's own reserve, not a fragrance's", async () => {
    await t.db.update(discoverySet).set({ onHand: 5 });
    const client = await shopper(t, ali, '998901234567');
    await client.cart.addDiscovery({ body: { qty: 2 } });
    const point = await samarkandPoint(t);
    const checkout = await client.checkout.get({ query: { regionId: point.regionId } });
    if (checkout.status !== 200) throw new Error('checkout');
    await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
    expect(await discoveryRow()).toMatchObject({ onHand: 5, reserved: 2, available: 3 });
    expect((await list()).fragrances.every((r) => r.reservedMl === 0)).toBe(true);
  });

  it('values the stock at cost for the owner only: the oil at its receipts, the concentrate at its oil price', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    await setConcentrateUl(t, id, 100_000);
    await t.db.update(fragrances).set({ oilPrice: 3950 }).where(eq(fragrances.id, id));
    // 100 ml at (3 950 × 0.91 × 1.03 × 30 % + 150 × 70 %) = 1 215.7005 so'm per ml
    expect((await fragranceRow(slug!, owner)).value).toEqual({
      oil: 0,
      concentrate: 121_570,
      total: 121_570,
    });
    expect((await fragranceRow(slug!, manager)).value).toBeNull();
    // without an oil price the concentrate has no value, and neither has the total
    await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, id));
    expect((await fragranceRow(slug!, owner)).value).toEqual({
      oil: 0,
      concentrate: null,
      total: null,
    });
  });
});

describe('a concentrate count', () => {
  it('changes what is free, is a history line from the stock page and is audited with the actor', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 2);
    const id = await fragranceIdOf(t, slug!);
    const res = await count(id, 123.6, 1000);
    expect(res.status === 200 && res.body.stock).toMatchObject({
      concentrateMl: 123.6,
      reservedMl: 20.6,
      availableMl: 103,
      belowReserve: false,
    });
    expect(await fragranceRow(slug!)).toMatchObject({ concentrateMl: 123.6, availableMl: 103 });
    const [row] = await audits('warehouse.concentrate_corrected');
    expect(row).toMatchObject({ actorType: 'staff', actorId: manager.staff.id });
    expect(row?.payload).toMatchObject({ concentrateMl: [1000, 123.6], reason: 'Пересчёт' });
    expect(res.status === 200 && res.body.history[0]).toMatchObject({
      kind: 'correction',
      concentrateMl: -876.4,
      source: 'stock',
      reason: 'Пересчёт',
      actorName: manager.staff.name,
    });
  });

  it('is allowed below the reserve and says so', async () => {
    const [slug] = await slugsOf(t, 1);
    await reserve(slug!, 3);
    const id = await fragranceIdOf(t, slug!);
    const res = await count(id, 10, 1000, owner);
    expect(res.status === 200 && res.body.stock).toMatchObject({
      concentrateMl: 10,
      reservedMl: 30.9,
      availableMl: 0,
      belowReserve: true,
      level: 'zero',
    });
    expect(await fragranceRow(slug!)).toMatchObject({ concentrateMl: 10, belowReserve: true });
  });

  it('answers 409 with the current ml when it moved meanwhile, and writes nothing', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    expect((await count(id, 800, undefined, owner)).status).toBe(200);
    const res = await count(id, 500, 1000);
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({ code: 'changed', currentMl: 800 });
    expect((await fragranceRow(slug!)).concentrateMl).toBe(800);
    expect(await audits('warehouse.concentrate_corrected')).toHaveLength(1);
    // the editor retries from the value it was shown
    expect((await count(id, 500, 800)).status).toBe(200);
  });

  it('lets exactly one of two counts from the same value win', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    const [a, b] = await Promise.all([count(id, 700, 1000, owner), count(id, 900, 1000)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? 700 : 900;
    expect((await fragranceRow(slug!)).concentrateMl).toBe(winner);
    expect(await audits('warehouse.concentrate_corrected')).toHaveLength(1);
    expect(await t.db.select().from(stockMoves).where(eq(stockMoves.fragranceId, id))).toHaveLength(
      1,
    );
  });

  it('still takes a count without `expectedMl`; one that changes nothing writes nothing', async () => {
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceIdOf(t, slug!);
    expect((await count(id, 1000)).status).toBe(200);
    expect(await audits('warehouse.concentrate_corrected')).toHaveLength(0);
    expect((await count(id, 4)).status).toBe(200);
    expect(await concentrateUl(t, id)).toBe(4000);
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

    const ok = await manager.client.admin.sets.setOnHand({
      body: { onHand: 10, expected: 5, reason: 'Пересчёт' },
    });
    expect(ok.status === 200 && ok.body).toMatchObject({ onHand: 10, reserved: 2, available: 8 });
    expect(await discoveryRow()).toMatchObject({ onHand: 10, available: 8, belowReserve: false });

    const stale = await owner.client.admin.sets.setOnHand({
      body: { onHand: 20, expected: 5, reason: 'Пересчёт' },
    });
    expect(stale.status).toBe(409);
    expect(stale.status === 409 && stale.body).toEqual({ code: 'on_hand_changed', current: 10 });
    expect((await discoveryRow()).onHand).toBe(10);

    const below = await owner.client.admin.sets.setOnHand({
      body: { onHand: 1, expected: 10, reason: 'Пересчёт' },
    });
    expect(below.status).toBe(200);
    expect(await discoveryRow()).toMatchObject({ onHand: 1, reserved: 2, belowReserve: true });
    const rows = await audits('sets.discovery_on_hand_changed');
    expect(rows.map((r) => r.actorId)).toEqual([manager.staff.id, owner.staff.id]);
  });
});

describe('paging (by fragrance)', () => {
  const fragranceCount = async () => (await t.db.select().from(fragrances)).length;
  const ids = (rows: { fragranceId: number }[]) => rows.map((r) => r.fragranceId);

  it('holds fragrances, the Discovery sets on page 1 only, and nothing twice', async () => {
    const total = await fragranceCount();
    const one = await page(manager, { pageSize: '5' });
    expect(one).toMatchObject({ total, page: 1, pageSize: 5 });
    expect(one.sets.map((r) => r.key)).toEqual(['discovery', 'discovery-5']);
    expect(ids(one.fragrances)).toHaveLength(5);
    const two = await page(manager, { pageSize: '5', page: '2' });
    expect(two.sets).toEqual([]);
    expect(ids(two.fragrances).filter((id) => ids(one.fragrances).includes(id))).toEqual([]);
    // the last page holds the remainder; past the end is empty but still says how many there are
    const lastPage = Math.ceil(total / 5);
    expect(
      (await page(manager, { pageSize: '5', page: String(lastPage) })).fragrances,
    ).toHaveLength(total - (lastPage - 1) * 5);
    const past = await page(manager, { pageSize: '5', page: String(lastPage + 1) });
    expect(past).toMatchObject({ fragrances: [], sets: [], total });
  });

  it('filters and searches cover every page: only matching fragrances count, wherever they sort', async () => {
    const all = await t.db
      .select({ id: fragrances.id })
      .from(fragrances)
      .orderBy(sql`lower(${fragrances.name})`);
    const spread = [all[0]!.id, all[30]!.id, all[60]!.id];
    for (const id of spread) await setConcentrateUl(t, id, 100_000);
    const one = await page(manager, { filter: 'low', pageSize: '2' });
    expect(one.total).toBe(3);
    expect(ids(one.fragrances)).toEqual([spread[0], spread[1]]);
    expect(one.fragrances.every((r) => r.level !== 'ok')).toBe(true);
    const two = await page(manager, { filter: 'low', pageSize: '2', page: '2' });
    expect(ids(two.fragrances)).toEqual([spread[2]]);
    // a hidden fragrance deep in the list is on page 1 of the hidden filter
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, all[60]!.id));
    const hidden = await page(manager, { visibility: 'hidden', pageSize: '2' });
    expect(hidden.total).toBe(1);
    expect(ids(hidden.fragrances)).toEqual([all[60]!.id]);
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
    const fa = await fragranceIdOf(t, a!);
    const fb = await fragranceIdOf(t, b!);
    const fc = await fragranceIdOf(t, c!);
    await setConcentrateUl(t, fa, 250_000); // low: at or under 300 ml
    await stockBottles(t, fb, 5, 1); // zero: a 5 ml fill can't fill a 10 ml bottle
    await t.db.update(fragrances).set({ hidden: true }).where(eq(fragrances.id, fc));
    await t.db.update(fragrances).set({ oilMg: 0 });
    await t.db.update(fragrances).set({ oilMg: 500_000 }).where(eq(fragrances.id, fa));
    return { fa, fb, fc };
  }

  it('low includes zero, zero is only zero', async () => {
    const { fa, fb } = await arrange();
    const low = (await list(manager, { filter: 'low' })).fragrances;
    expect(low.map((r) => r.fragranceId).sort()).toEqual([fa, fb].sort());
    const zero = (await list(manager, { filter: 'zero' })).fragrances;
    expect(zero.map((r) => r.fragranceId)).toEqual([fb]);
  });

  it('«Мало масла» reads the oil: none and low, a fragrance with plenty left out', async () => {
    const { fa } = await arrange();
    const oilLow = await list(manager, { filter: 'oilLow' });
    expect(oilLow.fragrances.map((r) => r.fragranceId)).not.toContain(fa);
    expect(oilLow.fragrances.every((r) => r.oilLevel !== 'ok')).toBe(true);
    expect(oilLow.sets).toEqual([]);
  });

  it('carries the level the server decided, for fragrances and the Discovery set', async () => {
    const { fa, fb } = await arrange();
    const rows = (await list()).fragrances;
    const level = (id: number) => rows.find((r) => r.fragranceId === id)?.level;
    expect([level(fa), level(fb)]).toEqual(['low', 'zero']);
    expect((await list()).sets.find((r) => r.key === 'discovery')?.level).toBe('ok');
    await t.db.update(discoverySet).set({ onHand: 0 });
    expect((await discoveryRow()).level).toBe('zero');
    // the Discovery page reports the same warning flag as the stock page
    const set = await manager.client.admin.sets.get();
    expect(set.status === 200 && set.body.belowReserve).toBe(false);
  });

  it('follows the threshold settings', async () => {
    const { fa } = await arrange();
    await t.db.insert(settings).values({ key: 'stock.lowConcentrateMl', value: 200 });
    const body = await list(manager, { filter: 'low' });
    expect(body.lowConcentrateMl).toBe(200);
    expect(body.fragrances.map((r) => r.fragranceId)).not.toContain(fa);
    await t.db.update(discoverySet).set({ onHand: 2 });
    expect((await discoveryRow()).level).toBe('low');
    await t.db.insert(settings).values({ key: 'stock.lowAvailableThreshold', value: 1 });
    expect((await discoveryRow()).level).toBe('ok');
  });

  it('hidden fragrances only, or visible only', async () => {
    const { fc } = await arrange();
    const hidden = await list(manager, { visibility: 'hidden' });
    expect(hidden.fragrances.map((r) => r.fragranceId)).toEqual([fc]);
    expect(hidden.fragrances.every((r) => r.hidden)).toBe(true);
    expect(hidden.sets).toEqual([]);
    const visible = await list(manager, { visibility: 'visible' });
    expect(visible.fragrances.some((r) => r.hidden)).toBe(false);
    expect(visible.sets.length).toBe(2);
  });

  it('searches by fragrance name, ignoring case, and finds the Discovery set', async () => {
    const [slug] = await slugsOf(t, 1);
    const [f] = await t.db
      .select({ name: fragrances.name })
      .from(fragrances)
      .where(eq(fragrances.slug, slug!));
    const rows = (await list(manager, { q: f!.name.toUpperCase() })).fragrances;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.name.toLowerCase().includes(f!.name.toLowerCase()))).toBe(true);
    const sets = await list(manager, { q: 'discovery' });
    expect([sets.sets.map((r) => r.key), sets.fragrances]).toEqual([
      ['discovery', 'discovery-5'],
      [],
    ]);
    const none = await list(manager, { q: 'zzzzqqq' });
    expect([none.fragrances, none.sets]).toEqual([[], []]);
  });

  it('ignores apostrophe variants on both sides', async () => {
    const [slug] = await slugsOf(t, 1);
    await t.db
      .update(fragrances)
      .set({ name: 'Devil’s Intrigue' })
      .where(eq(fragrances.slug, slug!));
    for (const q of ['Devil’s', "Devil's", 'Devils', 'devilʻs int']) {
      const rows = (await list(manager, { q })).fragrances;
      expect(
        rows.map((r) => r.name),
        q,
      ).toContain('Devil’s Intrigue');
    }
    await t.db.update(fragrances).set({ name: "Bal d'Afrique" }).where(eq(fragrances.slug, slug!));
    expect(
      (await list(manager, { q: 'Bal d’Afrique' })).fragrances.some(
        (r) => r.name === "Bal d'Afrique",
      ),
    ).toBe(true);
  });
});

describe('the bottles a fragrance still fills', () => {
  it('are whole fills of the free concentrate per sold volume, the 5 ml left out', async () => {
    const [slug] = await slugsOf(t, 1);
    await stockBottles(t, slug!, 50, 1);
    expect((await fragranceRow(slug!)).bottles).toEqual([
      { ml: 10, available: 5 },
      { ml: 30, available: 1 },
      { ml: 50, available: 1 },
    ]);
    await setConcentrateUl(t, slug!, FILL_UL[50] - 1);
    expect((await fragranceRow(slug!)).bottles.map((b) => b.available)).toEqual([4, 1, 0]);
  });
});
