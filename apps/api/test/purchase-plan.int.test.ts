import type { FragranceInput } from '@lummi/contracts';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the purchase planner (#78) over HTTP. The figures themselves are the
 * calculator's, held in `purchase-plan.unit.test.ts`; here: that the settings, the catalog and the
 * per-fragrance what-if reach the plan, and who may read it. Prices and names are made up.
 */
let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const input = (name: string, oilPrice: number | null): FragranceInput => ({
  name,
  originalBrand: 'Maison Test',
  type: 'unisex',
  familyId: null,
  season: 'autumn_winter',
  timeOfDay: 'evening',
  sillage: 'strong',
  longevityRu: 'до 24 часов',
  longevityUz: '24 soatgacha',
  descriptionRu: 'Тёплый аромат для вечера.',
  descriptionUz: 'Kechqurun uchun iliq ifor.',
  whenToWearRu: 'Для встреч вечером.',
  whenToWearUz: 'Kechki uchrashuvlar uchun.',
  keyNotesRu: ['Ваниль', 'Амбра', 'Кедр'],
  keyNotesUz: ['Vanil', 'Amber', 'Kedr'],
  internalRemark: null,
  aliases: [],
  uzumUrl: null,
  oilPrice,
  tier: null,
  oilSupplier: null,
  oilInvoice: null,
  isHit: false,
  isNew: false,
  hidden: false,
  notes: { top: [], heart: [], base: [] },
  similarIds: [],
  volumes: [
    { ml: 10, price: 69_000, salePrice: null, saleEndsOn: null, onHand: 0 },
    { ml: 30, price: 189_000, salePrice: null, saleEndsOn: null, onHand: 0 },
    { ml: 50, price: 249_000, salePrice: null, saleEndsOn: null, onHand: 0 },
  ],
});

async function created(name: string, oilPrice: number | null) {
  const res = await owner.client.admin.catalog.fragrances.create({ body: input(name, oilPrice) });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return res.body;
}
async function setting(key: 'buy.oilKgPerFragrance' | 'buy.soldPercent', value: number) {
  const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
  expect(res.status).toBe(200);
}
const plan = async (query = {}) => {
  const res = await owner.client.admin.purchasePlan({ query });
  if (res.status !== 200) throw new Error(`plan failed: ${res.status}`);
  return res.body;
};

describe('the purchase planner', () => {
  it('is empty without fragrances', async () => {
    const p = await plan();
    expect(p).toMatchObject({ fragranceCount: 0, rows: [], bottles: { total: 0 } });
    expect(p.investment.total).toBe(0);
  });

  it('plans from the catalog and the settings: kilograms, and a fragrance without an oil price is listed apart', async () => {
    const a = await created('Alpha', 2_000);
    const b = await created('Beta', 3_500);
    const c = await created('Gamma', null);
    await setting('buy.oilKgPerFragrance', 3);
    const p = await plan();
    expect(p.inputs.oilKgPerFragrance).toBe(3);
    expect(p.fragranceCount).toBe(2);
    expect(p.investment).toMatchObject({ oil: 5_623_800 + 9_841_650, ethanol: 2_100_000 });
    expect(p.rows.map((r) => r.fragranceId).sort()).toEqual([a.id, b.id].sort());
    expect(p.withoutOilPrice).toEqual([{ fragranceId: c.id, name: 'Gamma' }]);
  });

  it('a changed setting changes the plan', async () => {
    await created('Alpha', 2_000);
    // the default 2000 samples take 10 l of liquid: 5 kg of oil makes 16 l
    await setting('buy.oilKgPerFragrance', 5);
    const before = await plan();
    await setting('buy.soldPercent', 50);
    const after = await plan();
    expect(after.year.soldBottles).toBeLessThan(before.year.soldBottles);
    expect(after.bottles).toEqual(before.bottles);
  });

  it('a per-fragrance kg overrides the default for that fragrance only, and stores nothing', async () => {
    const a = await created('Alpha', 2_000);
    const b = await created('Beta', 2_000);
    const base = await plan({ kg: 1 });
    const own = await plan({ kg: 1, by: `${a.id}:2.5,${b.id}:0` });
    expect(own.fragranceCount).toBe(1);
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]).toMatchObject({ fragranceId: a.id, oilKg: 2.5, overridden: true });
    expect(own.rows[0]!.oilCost).toBe(Math.round(2.5 * 1_874_600));
    expect(base.rows.every((r) => !r.overridden && r.oilKg === 1)).toBe(true);
    // nothing was saved: the plain call is still the settings' default
    expect((await plan()).inputs.oilKgPerFragrance).toBe(1);
  });

  it('refuses a malformed per-fragrance list', async () => {
    const res = await fetch(`${t.baseUrl}/admin/purchase-plan?by=abc`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(400);
  });

  it("is the owner's: a manager gets 403, no session 401, on the page and the export", async () => {
    expect((await manager.client.admin.purchasePlan({ query: {} })).status).toBe(403);
    expect((await t.client.admin.purchasePlan({ query: {} })).status).toBe(401);
    const asManager = await fetch(`${t.baseUrl}/admin/purchase-plan/export`, {
      headers: { cookie: manager.cookie },
    });
    expect(asManager.status).toBe(403);
    expect((await fetch(`${t.baseUrl}/admin/purchase-plan/export`)).status).toBe(401);
  });

  it('exports the plan to Excel in the asked language', async () => {
    const a = await created('Alpha', 2_000);
    const res = await fetch(`${t.baseUrl}/admin/purchase-plan/export?by=${a.id}:2&lang=uz`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Xarid', 'Hidlar boʻyicha']);
    const rows = wb.worksheets[1]!;
    expect(rows.getRow(2).getCell(1).value).toBe('Alpha');
    expect(rows.getRow(2).getCell(3).value).toBe(2);
  });
});
