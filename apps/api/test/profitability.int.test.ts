import { and, discoverySet, discoverySetItems, eq, fragrances, volumes } from '@lummi/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the «Рентабельность» page (#77) over HTTP, as the owner opens it. Expected
 * profits are the customer's calculator figures for the unit table's made-up oil prices
 * (`profitability.unit.test.ts`), never recomputed; prices are its `P0`.
 */
let t: TestApp;
let owner: StaffSession;
let ids: number[];

const OIL = [3950, 2150, 9150, 2650, 2750];
const PRICES: Record<number, number> = { 10: 69_000, 30: 189_000, 50: 249_000 };

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(new Date('2026-11-19T05:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  owner = await t.ownerSession();
  const rows = await t.db.select({ id: fragrances.id }).from(fragrances).orderBy(fragrances.name);
  ids = rows.map((r) => r.id);
  // every fragrance but the first five has no oil price
  await t.db.update(fragrances).set({ oilPrice: null });
  for (const [i, oil] of OIL.entries())
    await t.db.update(fragrances).set({ oilPrice: oil }).where(eq(fragrances.id, ids[i]!));
  for (const id of ids)
    for (const ml of [10, 30, 50])
      await t.db
        .update(volumes)
        .set({ price: PRICES[ml]!, salePrice: null, saleEndsAt: null })
        .where(and(eq(volumes.fragranceId, id), eq(volumes.ml, ml)));
  await t.db
    .insert(discoverySet)
    .values({ id: true, price: 299_000 })
    .onConflictDoUpdate({ target: discoverySet.id, set: { price: 299_000 } });
  await t.db.delete(discoverySetItems);
  await t.db
    .insert(discoverySetItems)
    .values(ids.slice(0, 5).map((fragranceId, i) => ({ position: i + 1, fragranceId })));
});

const table = (query: Record<string, string> = {}, who: StaffSession = owner) =>
  who.client.admin.profitability.table({ query });

describe('the table', () => {
  it("is the owner's: a manager gets 403", async () => {
    expect((await table({}, await t.managerSession())).status).toBe(403);
    const quote = await (
      await t.managerSession()
    ).client.admin.profitability.quote({
      body: {
        channel: 'miniapp',
        afterSetDiscount: false,
        giftSample: false,
        lines: [{ item: { kind: 'discovery_set' }, qty: 1 }],
      },
    });
    expect(quote.status).toBe(403);
  });

  it("each sale's profit is the calculator's, on both channels and with the toggles", async () => {
    const row = async (q: Record<string, string>, fragranceId: number, ml: number) => {
      const res = await table(q);
      if (res.status !== 200) throw new Error(String(res.status));
      return res.body.rows.find((r) => r.fragranceId === fragranceId && r.ml === ml)!;
    };
    const [a, , c] = ids as [number, number, number];
    expect(await row({}, a, 30)).toMatchObject({
      price: 189_000,
      discount: 0,
      unitCost: 52_086,
      profit: 130_024,
      flag: null,
    });
    expect((await row({ channel: 'uzum' }, a, 30)).profit).toBe(93_279);
    expect((await row({ afterSetDiscount: '1' }, a, 30)).profit).toBe(92_602);
    // Uzum after the set's discount: a loss, flagged
    expect(await row({ channel: 'uzum', afterSetDiscount: '1' }, c, 50)).toMatchObject({
      discount: 49_800,
      profit: -2087,
      flag: 'loss',
    });
    // C 10 ml on Uzum with a gift sample: 2 119 of 69 000, under the 15 % floor
    expect(await row({ channel: 'uzum', giftSample: '1' }, c, 10)).toMatchObject({
      profit: 2119,
      flag: 'low',
    });
  });

  it('a fragrance without an oil price has no cost; the Discovery set comes last', async () => {
    const res = await table();
    if (res.status !== 200) throw new Error(String(res.status));
    const unknown = res.body.rows.find((r) => r.fragranceId === ids[6]);
    expect(unknown).toMatchObject({ unitCost: null, profit: null, margin: null, flag: null });
    expect(res.body.rows.at(-1)).toMatchObject({
      kind: 'discovery_set',
      price: 299_000,
      unitCost: 90_490,
      profit: 175_520,
    });
    expect(res.body).toMatchObject({ afterSetDiscountPercent: 20, lowMarginPercent: 15 });
    expect(res.body.giftSampleCost).toBe(11_222);
  });

  it('exports the same rows to Excel, in the asked language', async () => {
    const res = await fetch(`${t.baseUrl}/admin/profitability/export?channel=uzum&lang=uz`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('Uzum');
    const api = await table({ channel: 'uzum' });
    if (api.status !== 200) throw new Error(String(api.status));
    expect(ws.rowCount).toBe(api.body.rows.length + 1);
    const profits = ws
      .getSheetValues()
      .slice(2)
      .map((r) => (r as unknown[])[8]);
    expect(profits).toEqual(api.body.rows.map((r) => r.profit ?? ''));
    const manager = await t.managerSession();
    const refused = await fetch(`${t.baseUrl}/admin/profitability/export`, {
      headers: { cookie: manager.cookie },
    });
    expect(refused.status).toBe(403);
  });
});

describe('the calculator and the order simulator', () => {
  it('one bottle: the unit cost part by part and the order costs', async () => {
    const res = await owner.client.admin.profitability.quote({
      body: {
        channel: 'miniapp',
        afterSetDiscount: true,
        giftSample: false,
        lines: [{ item: { kind: 'volume', fragranceId: ids[0]!, ml: 30 }, qty: 1 }],
      },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.lines[0]!.unitCost).toMatchObject({
      oil: 34_321,
      ethanol: 3245,
      total: 52_086,
    });
    expect(res.body).toMatchObject({
      itemsSubtotal: 189_000,
      discount: 37_800,
      deliveryFee: 25_000,
    });
    expect(res.body.profit?.profit).toBe(92_602);
  });

  it('several lines: delivery from the threshold, and fragrances without an oil price named', async () => {
    const res = await owner.client.admin.profitability.quote({
      body: {
        channel: 'miniapp',
        afterSetDiscount: false,
        giftSample: false,
        lines: [
          { item: { kind: 'volume', fragranceId: ids[0]!, ml: 50 }, qty: 1 },
          { item: { kind: 'volume', fragranceId: ids[1]!, ml: 10 }, qty: 1 },
        ],
      },
    });
    expect(res.status === 200 && res.body).toMatchObject({
      itemsSubtotal: 318_000,
      deliveryFee: 0,
      amountToFreeDelivery: 0,
      profit: { goods: 78_651 + 17_145, profit: 189_024 },
      missing: [],
    });
    const [noOil] = await t.db.select().from(fragrances).where(eq(fragrances.id, ids[6]!));
    const unknown = await owner.client.admin.profitability.quote({
      body: {
        channel: 'miniapp',
        afterSetDiscount: false,
        giftSample: false,
        lines: [{ item: { kind: 'volume', fragranceId: ids[6]!, ml: 10 }, qty: 2 }],
      },
    });
    expect(unknown.status === 200 && unknown.body).toMatchObject({
      itemsSubtotal: 138_000,
      profit: null,
      missing: [noOil!.name],
    });
  });

  it('404 for a fragrance or a volume that does not exist', async () => {
    const ask = (fragranceId: number, ml: number) =>
      owner.client.admin.profitability.quote({
        body: {
          channel: 'uzum',
          afterSetDiscount: false,
          giftSample: false,
          lines: [{ item: { kind: 'volume', fragranceId, ml }, qty: 1 }],
        },
      });
    expect((await ask(999_999, 10)).status).toBe(404);
    expect((await ask(ids[0]!, 20)).status).toBe(404);
  });
});
