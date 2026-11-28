import { auditLog, eq, fragrances } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shownCount } from '../src/catalog/catalog.service';
import { FILL_UL, setConcentrateUl, stockBottles, type FillMl } from './harness/stock';
import { createTestApp, type TestApp } from './harness/test-app';

/** #83: the count the shop shows customers («В наличии: N шт.»). */

describe('shownCount (the rule)', () => {
  const rule = { own: null, fallback: 7, max: 10 };
  it('uses the default when the fragrance has no number of its own', () => {
    expect(shownCount(20, rule)).toBe(7);
  });
  it('uses the fragrance own number', () => {
    expect(shownCount(20, { ...rule, own: 4 })).toBe(4);
  });
  it('never goes above the maximum, even for a stale own number or default', () => {
    expect(shownCount(50, { ...rule, own: 15 })).toBe(10);
    expect(shownCount(50, { own: null, fallback: 12, max: 10 })).toBe(10);
  });
  it('never goes above the real available', () => {
    expect(shownCount(3, rule)).toBe(3);
    expect(shownCount(2, { ...rule, own: 9 })).toBe(2);
  });
  it('is 0 when nothing is available', () => {
    expect(shownCount(0, rule)).toBe(0);
    expect(shownCount(-1, rule)).toBe(0);
  });
});

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await t.seedCatalog();
});

async function fragranceId(slug: string) {
  const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
  return f!.id;
}
/** Exactly `bottles` fills of `ml` of the fragrance's concentrate (ADR 0043): its volumes share it. */
const setOnHand = (slug: string, ml: FillMl, bottles: number) => stockBottles(t, slug, ml, bottles);
/** The volume cards of the product page, as a customer gets them. */
async function shownOf(slug: string) {
  const { client } = await t.signIn();
  const res = await client.catalog.fragrance({ params: { slug } });
  if (res.status !== 200) throw new Error(`card ${res.status}`);
  return Object.fromEntries(res.body.volumes.map((v) => [v.ml, v.shown]));
}
async function shownInList(slug: string) {
  const { client } = await t.signIn();
  const res = await client.catalog.list({ query: { limit: 100 } as never });
  if (res.status !== 200) throw new Error(`list ${res.status}`);
  const item = res.body.items.find((i) => i.slug === slug)!;
  return Object.fromEntries(item.volumes.map((v) => [v.ml, v.shown]));
}

describe('the shown count on the card', () => {
  it('is the default (7) capped by the real available, 0 when sold out', async () => {
    // one liquid fills every volume (ADR 0043): just under two 50 ml fills is nine 10 ml, three
    // 30 ml and one 50 ml
    await setConcentrateUl(t, 'symphony', 2 * FILL_UL[50] - 1);
    expect(await shownOf('symphony')).toEqual({ 10: 7, 30: 3, 50: 1 });
    expect(await shownInList('symphony')).toEqual({ 10: 7, 30: 3, 50: 1 });
    // just under one 50 ml: four 10 ml, one 30 ml, no 50 ml
    await setConcentrateUl(t, 'symphony', FILL_UL[50] - 1);
    expect(await shownOf('symphony')).toEqual({ 10: 4, 30: 1, 50: 0 });
    expect(await shownInList('symphony')).toEqual({ 10: 4, 30: 1, 50: 0 });
  });

  it('follows the fragrance own number and the settings', async () => {
    await setOnHand('symphony', 10, 20);
    const owner = await t.ownerSession();
    const id = await fragranceId('symphony');
    expect(
      (await owner.client.admin.shownCount.set({ params: { id }, body: { shownCount: 4 } })).status,
    ).toBe(200);
    expect((await shownOf('symphony'))[10]).toBe(4);
    // another fragrance keeps the default
    await setOnHand('tygar', 10, 20);
    expect((await shownOf('tygar'))[10]).toBe(7);
    // the default is a setting
    await owner.client.admin.settings.update({
      params: { key: 'stock.shownDefault' },
      body: { value: 9 },
    });
    expect((await shownOf('tygar'))[10]).toBe(9);
    // lowering the max clamps both
    await owner.client.admin.settings.update({
      params: { key: 'stock.shownMax' },
      body: { value: 3 },
    });
    expect((await shownOf('tygar'))[10]).toBe(3);
    expect((await shownOf('symphony'))[10]).toBe(3);
  });
});

describe('PATCH /admin/fragrances/:id/shown-count', () => {
  it('lets the owner and the manager set it and clear it, audited with the actor', async () => {
    const id = await fragranceId('symphony');
    const owner = await t.ownerSession();
    const manager = await t.managerSession();
    const set = await manager.client.admin.shownCount.set({
      params: { id },
      body: { shownCount: 5 },
    });
    expect(set.status === 200 && set.body.shownCount).toBe(5);
    expect(set.status === 200 && [set.body.shownDefault, set.body.shownMax]).toEqual([7, 10]);
    const clear = await owner.client.admin.shownCount.set({
      params: { id },
      body: { shownCount: null },
    });
    expect(clear.status === 200 && clear.body.shownCount).toBeNull();
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'catalog.shown_count_changed'))
      .orderBy(auditLog.id);
    expect(rows.map((r) => r.payload)).toMatchObject([
      { name: 'Symphony', shownCount: [null, 5] },
      { shownCount: [5, null] },
    ]);
    expect(rows.map((r) => r.actorId)).toEqual([manager.staff.id, owner.staff.id]);
  });

  it('refuses a number above the maximum setting and an unknown fragrance', async () => {
    const id = await fragranceId('symphony');
    const owner = await t.ownerSession();
    const put = (shownCount: number | null, fid = id) =>
      owner.client.admin.shownCount.set({ params: { id: fid }, body: { shownCount } });
    expect((await put(11)).status).toBe(422);
    expect((await put(10)).status).toBe(200);
    await owner.client.admin.settings.update({
      params: { key: 'stock.shownMax' },
      body: { value: 12 },
    });
    expect((await put(11)).status).toBe(200);
    expect((await put(3, 999_999)).status).toBe(404);
  });

  it('is refused without a staff session', async () => {
    const { client } = await t.signIn();
    const res = await (client as never as TestApp['client']).admin.shownCount.set({
      params: { id: 1 },
      body: { shownCount: 3 },
    });
    expect([401, 403]).toContain(res.status);
  });

  it('shows on the stock page for the fragrances of the page', async () => {
    const id = await fragranceId('symphony');
    const manager = await t.managerSession();
    await manager.client.admin.shownCount.set({ params: { id }, body: { shownCount: 6 } });
    const res = await manager.client.admin.stock.list({
      query: { q: 'symphony', page: '1', pageSize: '50' } as never,
    });
    if (res.status !== 200) throw new Error(`stock ${res.status}`);
    expect(res.body.shown).toMatchObject({ default: 7, max: 10 });
    expect(res.body.shown.own).toEqual([{ fragranceId: id, shownCount: 6 }]);
  });
});
