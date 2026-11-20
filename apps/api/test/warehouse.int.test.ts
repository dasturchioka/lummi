import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FragranceInput, OilReceiptInput, WarehouseFragrance } from '@lummi/contracts';
import {
  auditLog,
  consumables,
  discoverySet,
  discoverySetItems,
  and,
  eq,
  fragrances,
  settings,
  stockMoves,
} from '@lummi/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { readComposition } from '../src/sets/sets';
import { cancelByStaff, fulfilTo, pay, placeOrder } from './harness/fulfilment';
import { shopper, slugs as slugsOf } from './harness/orders';
import { concentrateUl, consumable, setConcentrateUl, setConsumable } from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the warehouse (#76, ADR 0041, 0043) over HTTP. Amounts are worked out by hand
 * from the cost settings' defaults (oil 30 %, ethanol 70 %, density 1 g/ml, filling loss 3 %): a
 * ml of concentrate takes 0.3 g of oil and 0.7 ml of ethanol; a 10 ml bottle is a 10.3 ml fill.
 * Suppliers, invoices and prices are made up.
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
  t.edges.clock.set(new Date('2026-11-18T10:00:00Z'));
  await t.reset();
  await t.seedCatalog();
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const RECEIPT: OilReceiptInput = {
  supplier: 'Test Oils',
  invoice: 'INV-0001',
  receivedOn: '2026-11-17',
  grams: 100,
  pricePerGram: 4000,
  discountPercent: 9,
  importPercent: 3,
};

async function fragranceId(slug?: string) {
  const s = slug ?? (await slugsOf(t, 1))[0]!;
  const [f] = await t.db
    .select({ id: fragrances.id })
    .from(fragrances)
    .where(eq(fragrances.slug, s));
  return f!.id;
}
async function page(id: number, as: StaffSession = owner): Promise<WarehouseFragrance> {
  const res = await as.client.admin.warehouse.get({ params: { id } });
  if (res.status !== 200) throw new Error(`warehouse ${res.status}`);
  return res.body;
}
async function receive(id: number, over: Partial<OilReceiptInput> = {}) {
  const res = await owner.client.admin.warehouse.receiveOil({
    params: { id },
    body: { ...RECEIPT, ...over },
  });
  if (res.status !== 201) throw new Error(`receipt ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const mix = (id: number, ml: number, as = manager) =>
  as.client.admin.warehouse.mix({ params: { id }, body: { ml } });
const assemble = (vialMl: 5 | 10, quantity: number, as = manager) =>
  as.client.admin.warehouse.assembleSet({ params: { vialMl }, body: { quantity } });
/** The spirit on hand, ml. */
async function setEthanol(ml: number) {
  await setConsumable(t, (await consumable(t, 'ethanol')).id, ml);
}
/** A new fragrance as the owner's form sends it, with its concentrate counted. */
const formInput = (concentrateMl: number, loadedConcentrateMl?: number): FragranceInput => ({
  name: 'Nuit Blanche',
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
  oilPrice: null,
  tier: null,
  oilSupplier: null,
  oilInvoice: null,
  isHit: false,
  isNew: false,
  hidden: false,
  notes: { top: [], heart: [], base: [] },
  similarIds: [],
  volumes: [
    { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null },
    { ml: 30, price: 150_000, salePrice: null, saleEndsOn: null },
  ],
  concentrateMl,
  loadedConcentrateMl,
});
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));
const setOnHand = async (vialMl: number) =>
  (await t.db.select().from(discoverySet).where(eq(discoverySet.vialMl, vialMl)))[0]!.onHand;

describe('an oil receipt, then a mixing', () => {
  it('adds the grams to the oil, then takes the oil and spirit of the ml made into concentrate', async () => {
    const id = await fragranceId();
    await setConcentrateUl(t, id, 0);
    const before = await page(id);
    expect(before.stock).toMatchObject({
      oilGrams: 0,
      oilMl: 0,
      oilLevel: 'zero',
      concentrateMl: 0,
      level: 'zero',
    });

    const r = await receive(id);
    // 4 000 × 0.91 × 1.03 = 3 749.2 so'm per gram; 100 g = 374 920
    expect(r).toMatchObject({ grams: 100, landedPerGram: 3749, total: 374_920, voided: false });
    // 100 g at 1 g/ml = 100 ml of oil: at or under 300 ml, «Мало масла»
    expect((await page(id)).stock).toMatchObject({ oilGrams: 100, oilMl: 100, oilLevel: 'low' });

    await setEthanol(1000);
    const res = await mix(id, 200);
    // 200 ml: 30 % oil = 60 g, 70 % spirit = 140 ml, no filling loss
    expect(res.status === 201 && res.body).toEqual({
      oilGrams: 60,
      ethanolMl: 140,
      oilLeftGrams: 40,
      concentrateMl: 200,
    });
    const after = await page(id);
    expect(after.stock).toMatchObject({ oilGrams: 40, concentrateMl: 200, availableMl: 200 });
    expect(after.ethanol).toEqual({ id: (await consumable(t, 'ethanol')).id, onHandMl: 860 });
    // the form's preview: what a ml takes, and each bottle's fill (5 ml too, ADR 0042)
    expect(after.perMl).toEqual({ oilGrams: 0.3, ethanolMl: 0.7 });
    expect(after.fills).toEqual([
      { ml: 5, fillMl: 5.15 },
      { ml: 10, fillMl: 10.3 },
      { ml: 30, fillMl: 30.9 },
      { ml: 50, fillMl: 51.5 },
    ]);
    expect(after.stock.bottles).toEqual([
      { ml: 10, available: 19 },
      { ml: 30, available: 6 },
      { ml: 50, available: 3 },
    ]);
  });

  it('follows the liquid settings at the time of the mixing, never the filling loss', async () => {
    const id = await fragranceId();
    await receive(id);
    await setEthanol(1000);
    await t.db.insert(settings).values([
      { key: 'cost.liquid.oilPercent', value: 25 },
      { key: 'cost.liquid.ethanolPercent', value: 75 },
      { key: 'cost.liquid.oilDensity', value: 0.95 },
      { key: 'cost.liquid.fillingLossPercent', value: 5 },
    ]);
    // 10 ml × 25 % × 0.95 g/ml = 2.375 g; 10 ml × 75 % = 7.5 ml → 8 ml
    const res = await mix(id, 10);
    expect(res.status === 201 && res.body).toMatchObject({
      oilGrams: 2.375,
      ethanolMl: 8,
      oilLeftGrams: 97.625,
    });
    expect((await page(id)).fills.find((f) => f.ml === 10)?.fillMl).toBe(10.5);
  });

  it('refuses short oil or short spirit with the shortfall, and changes nothing', async () => {
    const id = await fragranceId();
    const start = await concentrateUl(t, id);
    await receive(id, { grams: 10 });
    await setEthanol(1000);
    const oil = await mix(id, 100);
    expect(oil.status).toBe(409);
    expect(oil.status === 409 && oil.body).toEqual({
      code: 'oil_short',
      neededGrams: 30,
      balanceGrams: 10,
      shortGrams: 20,
    });

    await receive(id, { grams: 100, invoice: 'INV-0002' });
    await setEthanol(50);
    const spirit = await mix(id, 100);
    expect(spirit.status === 409 && spirit.body).toEqual({
      code: 'ethanol_short',
      neededMl: 70,
      balanceMl: 50,
      shortMl: 20,
    });
    // an archived spirit is none at all
    await t.db.update(consumables).set({ archived: true }).where(eq(consumables.use, 'ethanol'));
    const none = await mix(id, 1);
    expect(none.status === 409 && none.body).toMatchObject({ code: 'ethanol_short', balanceMl: 0 });
    expect((await page(id)).ethanol).toBeNull();

    expect(await concentrateUl(t, id)).toBe(start);
    expect((await page(id)).stock.oilGrams).toBe(110);
    expect(await audits('warehouse.mixed')).toHaveLength(0);
  });

  it('lets only one of two concurrent mixings take oil the balance holds once', async () => {
    const id = await fragranceId();
    await setConcentrateUl(t, id, 0);
    await receive(id, { grams: 40 });
    await setEthanol(1000);
    const [a, b] = await Promise.all([mix(id, 100, owner), mix(id, 100, manager)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const after = await page(id);
    expect(after.stock).toMatchObject({ oilGrams: 10, concentrateMl: 100 });
    expect(after.ethanol?.onHandMl).toBe(930);
  });

  it('refuses no ml or a fraction past the microlitre, and answers 404 for no such fragrance', async () => {
    const id = await fragranceId();
    await receive(id);
    for (const ml of [0, -5, 1.0005]) {
      const raw = await fetch(`${t.baseUrl}/admin/warehouse/fragrances/${id}/mixings`, {
        method: 'POST',
        headers: { cookie: manager.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ml }),
      });
      expect(raw.status, String(ml)).toBe(400);
    }
    expect((await page(id)).stock.oilGrams).toBe(100);
    expect((await mix(9999, 10)).status).toBe(404);
    expect((await owner.client.admin.warehouse.get({ params: { id: 9999 } })).status).toBe(404);
    // bottling into volumes is gone: bottles are filled when they ship
    const old = await fetch(`${t.baseUrl}/admin/warehouse/fragrances/${id}/bottlings`, {
      method: 'POST',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ ml: 10, quantity: 1 }] }),
    });
    expect(old.status).toBe(404);
  });
});

describe('correcting and voiding a receipt', () => {
  it('moves the balance by the change in grams, and a void takes the receipt off', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    const fixed = await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 150, pricePerGram: 4100, reason: 'Опечатка в граммах' },
    });
    expect(fixed.status === 200 && fixed.body).toMatchObject({ grams: 150, pricePerGram: 4100 });
    expect((await page(id)).stock.oilGrams).toBe(150);

    const voided = await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: r.id },
      body: { reason: 'Накладная ошибочная' },
    });
    expect(voided.status === 200 && voided.body).toMatchObject({
      voided: true,
      voidReason: 'Накладная ошибочная',
    });
    expect((await page(id)).stock.oilGrams).toBe(0);

    // a voided receipt stays voided
    const again = await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: r.id },
      body: { reason: 'Ещё раз' },
    });
    expect(again.status === 409 && again.body).toEqual({ code: 'voided' });
    const late = await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, reason: 'Поздно' },
    });
    expect(late.status === 409 && late.body).toEqual({ code: 'voided' });
  });

  it('refuses to take back oil that already went into concentrate', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    await setEthanol(1000);
    expect((await mix(id, 103)).status).toBe(201); // 30.9 g: 69.1 g left
    const voided = await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: r.id },
      body: { reason: 'Накладная ошибочная' },
    });
    expect(voided.status === 409 && voided.body).toEqual({
      code: 'oil_short',
      neededGrams: 100,
      balanceGrams: 69.1,
      shortGrams: 30.9,
    });
    const fixed = await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 20, reason: 'Опечатка' },
    });
    expect(fixed.status === 409 && fixed.body).toEqual({
      code: 'oil_short',
      neededGrams: 80,
      balanceGrams: 69.1,
      shortGrams: 10.9,
    });
    expect((await page(id)).stock.oilGrams).toBe(69.1);
  });

  it('needs a reason', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    const res = await fetch(`${t.baseUrl}/admin/warehouse/oil-receipts/${r.id}/void`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '  ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('draft receipts from the purchase plan (#78)', () => {
  async function drafts(lines: { fragranceId: number; grams: number }[], as = owner) {
    return as.client.admin.warehouse.draftOilReceipts({ body: { lines } });
  }

  it("creates drafts at the fragrance's oil price and the settings' percents, touching no balance", async () => {
    const [a, b] = await slugsOf(t, 2);
    const ida = await fragranceId(a);
    const idb = await fragranceId(b);
    await t.db
      .update(fragrances)
      .set({ oilPrice: 3950, oilSupplier: 'Test Oils' })
      .where(eq(fragrances.id, ida));
    await t.db
      .update(fragrances)
      .set({ oilPrice: 2150, oilSupplier: null })
      .where(eq(fragrances.id, idb));
    const res = await drafts([
      { fragranceId: ida, grams: 1000 },
      { fragranceId: idb, grams: 2500 },
    ]);
    expect(res.status === 201 && res.body).toEqual({ created: 2 });

    const pa = await page(ida);
    expect(pa.stock).toMatchObject({ oilGrams: 0 });
    expect(pa.oilReceipts).toEqual([
      expect.objectContaining({
        draft: true,
        grams: 1000,
        supplier: 'Test Oils',
        invoice: '',
        receivedOn: '2026-11-18',
        pricePerGram: 3950,
        discountPercent: 9,
        importPercent: 3,
        voided: false,
      }),
    ]);
    expect(pa.history).toEqual([]);
    expect((await page(idb)).oilReceipts?.[0]).toMatchObject({
      draft: true,
      supplier: '',
      grams: 2500,
    });
    // the stock page says a draft waits
    const list = await owner.client.admin.stock.list({ query: { pageSize: 50 } });
    if (list.status !== 200) throw new Error('stock');
    expect(list.body.fragrances.find((o) => o.fragranceId === ida)?.drafts).toBe(1);
    const [audit] = await audits('warehouse.oil_receipt_drafts_created');
    expect(audit).toMatchObject({ actorId: owner.staff.id });
    expect(audit?.payload).toMatchObject({ count: 2, grams: 3500 });
  });

  it('confirms a draft as the invoice reads: the oil joins the balance', async () => {
    const id = await fragranceId();
    await t.db.update(fragrances).set({ oilPrice: 3950 }).where(eq(fragrances.id, id));
    await drafts([{ fragranceId: id, grams: 1000 }]);
    const draft = (await page(id)).oilReceipts![0]!;
    const done = await owner.client.admin.warehouse.confirmOilReceipt({
      params: { id: draft.id },
      body: { ...RECEIPT, grams: 980 },
    });
    expect(done.status === 200 && done.body).toMatchObject({
      draft: false,
      grams: 980,
      invoice: 'INV-0001',
    });
    const p = await page(id);
    expect(p.stock.oilGrams).toBe(980);
    expect(p.history.map((m) => [m.kind, m.oilGrams, m.invoice])).toEqual([
      ['oil_receipt', 980, 'INV-0001'],
    ]);
    const [received] = await audits('warehouse.oil_received');
    expect(received?.payload).toMatchObject({ grams: 980, fromDraft: true });

    const again = await owner.client.admin.warehouse.confirmOilReceipt({
      params: { id: draft.id },
      body: RECEIPT,
    });
    expect(again.status === 409 && again.body).toEqual({ code: 'not_draft' });
  });

  it('discards a draft, and keeps drafts out of corrections, voids and values', async () => {
    const id = await fragranceId();
    await t.db.update(fragrances).set({ oilPrice: 3950 }).where(eq(fragrances.id, id));
    await drafts([{ fragranceId: id, grams: 1000 }]);
    const draft = (await page(id)).oilReceipts![0]!;
    expect((await page(id)).stock.value?.oil).toBe(0);
    const fixed = await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: draft.id },
      body: { ...RECEIPT, reason: 'x' },
    });
    expect(fixed.status === 409 && fixed.body).toEqual({ code: 'draft' });
    const voided = await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: draft.id },
      body: { reason: 'x' },
    });
    expect(voided.status === 409 && voided.body).toEqual({ code: 'draft' });

    const gone = await owner.client.admin.warehouse.discardOilReceipt({ params: { id: draft.id } });
    expect(gone.status === 200 && gone.body).toEqual({ discarded: true });
    expect((await page(id)).oilReceipts).toEqual([]);
    expect(await audits('warehouse.oil_receipt_draft_discarded')).toHaveLength(1);

    const real = await receive(id);
    const keep = await owner.client.admin.warehouse.discardOilReceipt({ params: { id: real.id } });
    expect(keep.status === 409 && keep.body).toEqual({ code: 'not_draft' });
  });

  it('refuses a fragrance without an oil price or that does not exist, and a manager', async () => {
    const id = await fragranceId();
    await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, id));
    const res = await drafts([
      { fragranceId: id, grams: 1000 },
      { fragranceId: 9999, grams: 1000 },
    ]);
    expect(res.status === 422 && res.body).toEqual({
      code: 'invalid',
      fields: ['lines.0.fragranceId', 'lines.1.fragranceId'],
    });
    expect((await page(id)).oilReceipts).toEqual([]);
    expect((await drafts([{ fragranceId: id, grams: 1 }], manager)).status).toBe(403);
  });
});

describe('the audit', () => {
  it('names the actor of every receipt, correction, void and mixing', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 120, reason: 'Довесили' },
    });
    await setEthanol(1000);
    expect((await mix(id, 20.6)).status).toBe(201);
    await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: (await receive(id, { invoice: 'INV-0002' })).id },
      body: { reason: 'Дубль' },
    });

    const [received] = await audits('warehouse.oil_received');
    expect(received).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect(received?.payload).toMatchObject({
      grams: 100,
      invoice: 'INV-0001',
      supplier: 'Test Oils',
    });
    const [corrected] = await audits('warehouse.oil_receipt_corrected');
    expect(corrected).toMatchObject({ actorId: owner.staff.id, targetType: 'oil_receipt' });
    expect(corrected?.payload).toMatchObject({ reason: 'Довесили', grams: [100, 120] });
    const [mixed] = await audits('warehouse.mixed');
    expect(mixed).toMatchObject({
      actorId: manager.staff.id,
      targetType: 'fragrance',
      targetId: String(id),
    });
    // 20.6 ml: 6.18 g of oil, 14.42 ml of spirit → 14
    expect(mixed?.payload).toMatchObject({
      ml: 20.6,
      oilGrams: 6.18,
      ethanolMl: 14,
      oilPercent: 30,
      ethanolPercent: 70,
      oilDensity: 1,
    });
    const [voided] = await audits('warehouse.oil_receipt_voided');
    expect(voided?.payload).toMatchObject({ reason: 'Дубль', grams: 100, invoice: 'INV-0002' });
  });
});

describe('who may do what', () => {
  it('keeps oil receipts and values to the owner; a manager mixes, counts and reads the stock', async () => {
    const id = await fragranceId();
    const refused = await manager.client.admin.warehouse.receiveOil({
      params: { id },
      body: RECEIPT,
    });
    expect(refused.status).toBe(403);
    await receive(id);
    const seen = await page(id, manager);
    expect(seen).toMatchObject({ oilReceipts: null, oilReceiptDefaults: null });
    expect(seen.stock).toMatchObject({ oilGrams: 100, value: null, drafts: 0 });
    // the history says oil came in, but not from whom or on which invoice
    expect(seen.history[0]).toMatchObject({
      kind: 'oil_receipt',
      oilGrams: 100,
      invoice: null,
      supplier: null,
    });
    expect((await page(id)).history[0]).toMatchObject({
      invoice: 'INV-0001',
      supplier: 'Test Oils',
    });
    await setEthanol(100);
    expect((await mix(id, 10, manager)).status).toBe(201);
    expect(
      (
        await manager.client.admin.warehouse.countConcentrate({
          params: { id },
          body: { ml: 5, reason: 'Пересчёт' },
        })
      ).status,
    ).toBe(200);
    expect((await t.client.admin.warehouse.get({ params: { id } })).status).toBe(401);
  });

  it("gives the owner the receipts, the form's defaults and the stock value", async () => {
    const id = await fragranceId();
    await t.db
      .update(fragrances)
      .set({ oilPrice: 3950, oilSupplier: 'Test Oils' })
      .where(eq(fragrances.id, id));
    await setConcentrateUl(t, id, 100_000);
    await receive(id, { grams: 1000 });
    await receive(id, { grams: 500, pricePerGram: 2150, discountPercent: 10, importPercent: 2.5 });
    const p = await page(id);
    expect(p.oilReceipts?.map((r) => r.grams)).toEqual([500, 1000]);
    expect(p.oilReceiptDefaults).toEqual({
      supplier: 'Test Oils',
      pricePerGram: 3950,
      discountPercent: 9,
      importPercent: 3,
    });
    // oil: 1 000 g at 3 749.2 + 500 g at 1 983.375 = 4 740 887.5 for 1 500 g, all of it left;
    // concentrate at oil 3 950 so'm/g: 100 ml × (3 702.335 × 30 % + 105) = 121 570
    expect(p.stock.value).toEqual({ oil: 4_740_888, concentrate: 121_570, total: 4_862_458 });
  });

  it('values the concentrate at nothing known without an oil price, and none at 0', async () => {
    const id = await fragranceId();
    await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, id));
    await receive(id);
    expect((await page(id)).stock.value).toEqual({ oil: 374_920, concentrate: null, total: null });
    await setConcentrateUl(t, id, 0);
    expect((await page(id)).stock.value).toEqual({
      oil: 374_920,
      concentrate: 0,
      total: 374_920,
    });
  });
});

describe('the history', () => {
  it('lists receipts, corrections, mixings, counts, bottles filled at handover and returns, newest first', async () => {
    await importBtsPoints(t.db, snapshot);
    await t.db.insert(settings).values({ key: 'giftSample.enabled', value: false });
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceId(slug);
    await setConcentrateUl(t, id, 0);
    const flacon = await consumable(t, 'flacon', 10);
    const box = await consumable(t, 'box', 10);
    await setConsumable(t, flacon.id, 10);
    await setConsumable(t, box.id, 10);
    await setEthanol(1000);
    const r = await receive(id);
    await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 110, reason: 'Довесили' },
    });
    expect((await mix(id, 30.9)).status).toBe(201);
    const counted = await manager.client.admin.warehouse.countConcentrate({
      params: { id },
      body: { ml: 20.6, expectedMl: 30.9, reason: 'Пролили' },
    });
    expect(counted.status).toBe(200);

    const client = await shopper(
      t,
      { id: 71, first_name: 'Ali', language_code: 'ru' },
      '998901234567',
    );
    await client.cart.addLine({ body: { slug: slug!, ml: 10, qty: 2 } });
    const order = await placeOrder(t, client);
    await pay(t, order.number);
    await fulfilTo(t, order.number, 'handed_to_bts');
    await cancelByStaff(t, order.number, 'not_collected_at_bts');

    const { history } = await page(id);
    expect(history.map((m) => [m.kind, m.oilGrams, m.concentrateMl, m.bottles])).toEqual([
      ['returned', 0, 20.6, [{ ml: 10, change: 2 }]],
      ['sale', 0, -20.6, [{ ml: 10, change: -2 }]],
      ['correction', 0, -10.3, []],
      ['mixing', -9.27, 30.9, []],
      ['oil_receipt_corrected', 10, 0, []],
      ['oil_receipt', 100, 0, []],
    ]);
    expect(history[0]).toMatchObject({
      orderNumber: order.number,
      actorName: manager.staff.name,
      consumables: [
        expect.objectContaining({ consumableId: flacon.id, change: 2 }),
        expect.objectContaining({ consumableId: box.id, change: 2 }),
      ],
    });
    expect(history[1]!.consumables.map((c) => c.change)).toEqual([-2, -2]);
    expect(history[2]).toMatchObject({
      reason: 'Пролили',
      source: 'stock',
      actorName: manager.staff.name,
    });
    expect(history[3]!.consumables).toEqual([
      expect.objectContaining({ nameRu: 'Спирт', unit: 'ml', change: -22 }),
    ]);
    expect(history[4]).toMatchObject({
      reason: 'Довесили',
      invoice: 'INV-0001',
      supplier: 'Test Oils',
      actorName: owner.staff.name,
    });
    // the moves add up to the balances
    const moves = await t.db.select().from(stockMoves).where(eq(stockMoves.fragranceId, id));
    expect(moves.reduce((a, m) => a + m.oilMg, 0)).toBe(100_730);
    expect((await page(id)).stock.oilGrams).toBe(100.73);
    expect(moves.reduce((a, m) => a + m.concentrateUl, 0)).toBe(await concentrateUl(t, id));
  });

  it("records the fragrance form's counts as counts from the form", async () => {
    const created = await owner.client.admin.catalog.fragrances.create({ body: formInput(51.5) });
    if (created.status !== 201) throw new Error(`create ${created.status}`);
    const f = created.body;
    const updated = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: formInput(82.4, 51.5),
    });
    expect(updated.status).toBe(200);
    const { history } = await page(f.id);
    expect(history.map((m) => [m.kind, m.source, m.concentrateMl, m.actorName])).toEqual([
      ['correction', 'form', 30.9, owner.staff.name],
      ['correction', 'form', 51.5, owner.staff.name],
    ]);
  });
});

describe('the stock page', () => {
  it("shows each fragrance's oil in ml, warns from the low-oil setting, and filters by it", async () => {
    const [a, b] = await slugsOf(t, 2);
    const low = await fragranceId(a);
    const ok = await fragranceId(b);
    await receive(low, { grams: 200 });
    await receive(ok, { grams: 400 });
    const res = await manager.client.admin.stock.list({ query: { pageSize: 50 } });
    if (res.status !== 200) throw new Error('stock');
    expect(res.body.lowOilMl).toBe(300);
    const oilOf = (fid: number) => res.body.fragrances.find((o) => o.fragranceId === fid);
    expect(oilOf(low)).toMatchObject({ oilGrams: 200, oilMl: 200, oilLevel: 'low', value: null });
    expect(oilOf(ok)).toMatchObject({ oilGrams: 400, oilMl: 400, oilLevel: 'ok' });

    const filtered = await manager.client.admin.stock.list({
      query: { filter: 'oilLow', pageSize: 50 },
    });
    if (filtered.status !== 200) throw new Error('stock');
    const ids = new Set(filtered.body.fragrances.map((r) => r.fragranceId));
    expect(ids.has(low)).toBe(true);
    expect(ids.has(ok)).toBe(false);
    expect(filtered.body.sets).toEqual([]); // the Discovery sets have no oil
  });

  it('asks a reason for a concentrate count', async () => {
    const id = await fragranceId();
    const res = await fetch(`${t.baseUrl}/admin/warehouse/fragrances/${id}/concentrate`, {
      method: 'PUT',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ml: 3 }),
    });
    expect(res.status).toBe(400);
    const done = await manager.client.admin.warehouse.countConcentrate({
      params: { id },
      body: { ml: 3, reason: 'Пересчёт' },
    });
    expect(done.status).toBe(200);
    const [row] = await audits('warehouse.concentrate_corrected');
    expect(row?.payload).toMatchObject({ reason: 'Пересчёт', concentrateMl: [1000, 3] });
  });
});

describe('set assembly (ADR 0043)', () => {
  it("packs boxes from the five fragrances' concentrate, a flacon per vial, a move per fragrance", async () => {
    const five = await readComposition(t.db, 10);
    expect(five).toHaveLength(5);
    const flacon = await consumable(t, 'flacon', 10);
    await setConsumable(t, flacon.id, 20);
    const before = await setOnHand(10);
    const res = await assemble(10, 2);
    // two vials of 10 ml from each: 2 × 10.3 = 20.6 ml; ten flacons in all
    expect(res.status === 201 && res.body).toEqual({
      concentrateMl: 20.6,
      flacons: 10,
      onHand: before + 2,
    });
    for (const f of five) expect(await concentrateUl(t, f.id)).toBe(1_000_000 - 20_600);
    expect((await consumable(t, 'flacon', 10)).onHand).toBe(10);
    const moves = await t.db.select().from(stockMoves).where(eq(stockMoves.kind, 'set_assembly'));
    expect(moves.map((m) => m.fragranceId).sort()).toEqual(five.map((f) => f.id).sort());
    expect(moves[0]).toMatchObject({
      concentrateUl: -20_600,
      bottles: { 10: -2 },
      consumables: { [flacon.id]: -2 },
      details: { set: { vialMl: 10, quantity: 2 } },
      actorId: manager.staff.id,
    });
    expect((await page(five[0]!.id)).history[0]).toMatchObject({
      kind: 'set_assembly',
      set: { vialMl: 10, quantity: 2 },
    });
    const [audit] = await audits('warehouse.set_assembled');
    expect(audit).toMatchObject({ actorId: manager.staff.id, targetId: 'discovery' });
    expect(audit?.payload).toMatchObject({
      vialMl: 10,
      quantity: 2,
      onHand: [before, before + 2],
      concentrateMl: 20.6,
      flacons: 10,
    });
  });

  it('refuses when a fragrance is short of free concentrate, naming the first in the set; the reserve stays', async () => {
    await importBtsPoints(t.db, snapshot);
    await t.db.insert(settings).values({ key: 'giftSample.enabled', value: false });
    const five = await readComposition(t.db, 10);
    // the third holds 15 ml
    await setConcentrateUl(t, five[2]!.id, 15_000);
    const before = await setOnHand(10);
    const res = await assemble(10, 2);
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({
      code: 'concentrate_short',
      fragrance: five[2]!.name,
      neededMl: 20.6,
      balanceMl: 15,
      shortMl: 5.6,
    });
    expect(await setOnHand(10)).toBe(before);
    expect(await concentrateUl(t, five[0]!.id)).toBe(1_000_000);
    expect(await audits('warehouse.set_assembled')).toHaveLength(0);

    // an order holding a 10 ml of the first leaves 20.6 of its 30.9 ml free: two boxes, not three
    await setConcentrateUl(t, five[2]!.id, 1_000_000);
    await setConcentrateUl(t, five[0]!.id, 30_900);
    const client = await shopper(
      t,
      { id: 71, first_name: 'Ali', language_code: 'ru' },
      '998901234567',
    );
    await client.cart.addLine({ body: { slug: five[0]!.slug, ml: 10, qty: 1 } });
    await placeOrder(t, client);
    const three = await assemble(10, 3, owner);
    expect(three.status === 409 && three.body).toMatchObject({
      code: 'concentrate_short',
      fragrance: five[0]!.name,
      balanceMl: 20.6,
    });
    expect((await assemble(10, 2, owner)).status).toBe(201);
  });

  it('never stops for short flacons: the count stops at zero and asks for a recount', async () => {
    const flacon = await consumable(t, 'flacon', 5);
    await setConsumable(t, flacon.id, 3);
    const res = await assemble(5, 1);
    expect(res.status === 201 && res.body).toMatchObject({ concentrateMl: 5.15, flacons: 3 });
    const after = await consumable(t, 'flacon', 5);
    expect([after.onHand, after.needsRecount]).toEqual([0, true]);
    const moves = await t.db.select().from(stockMoves).where(eq(stockMoves.kind, 'set_assembly'));
    const short = moves.filter((m) => (m.details as { short?: unknown }).short);
    expect(short).toHaveLength(2);
    expect(short[0]!.details).toMatchObject({ short: { consumables: { [flacon.id]: 1 } } });
  });

  it('is refused while the set is not five (422)', async () => {
    await t.db
      .delete(discoverySetItems)
      .where(and(eq(discoverySetItems.vialMl, 5), eq(discoverySetItems.position, 1)));
    const res = await assemble(5, 1);
    expect(res.status === 422 && res.body).toMatchObject({ code: 'invalid' });
    const raw = await fetch(`${t.baseUrl}/admin/warehouse/sets/10/assemblies`, {
      method: 'POST',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 0 }),
    });
    expect(raw.status).toBe(400);
  });
});

describe('consumables (ADR 0043)', () => {
  const items = async (as = manager) => {
    const res = await as.client.admin.consumables.list();
    if (res.status !== 200) throw new Error(`consumables ${res.status}`);
    return res.body.items;
  };

  it('lists the seeded flacons and boxes by ml, then the spirit', async () => {
    const list = await items();
    expect(list.map((i) => [i.use, i.ml, i.unit, i.nameRu, i.nameUz])).toEqual([
      ['flacon', 5, 'pcs', 'Флакон 5 мл', 'Flakon 5 ml'],
      ['flacon', 10, 'pcs', 'Флакон 10 мл', 'Flakon 10 ml'],
      ['flacon', 30, 'pcs', 'Флакон 30 мл', 'Flakon 30 ml'],
      ['flacon', 50, 'pcs', 'Флакон 50 мл', 'Flakon 50 ml'],
      ['box', 10, 'pcs', 'Коробка 10 мл', 'Quti 10 ml'],
      ['box', 30, 'pcs', 'Коробка 30 мл', 'Quti 30 ml'],
      ['box', 50, 'pcs', 'Коробка 50 мл', 'Quti 50 ml'],
      ['ethanol', null, 'ml', 'Спирт', 'Spirt'],
    ]);
    expect(list.every((i) => i.onHand === 0 && i.level === 'zero' && !i.needsRecount)).toBe(true);
  });

  it('adds, renames and archives an item, all audited; a use and ml is one active item', async () => {
    const tape = await owner.client.admin.consumables.create({
      body: {
        nameRu: 'Лента',
        nameUz: 'Lenta',
        unit: 'pcs',
        use: 'other',
        ml: null,
        lowThreshold: 5,
      },
    });
    expect(tape.status === 201 && tape.body).toMatchObject({
      nameRu: 'Лента',
      onHand: 0,
      lowThreshold: 5,
      level: 'zero',
      archived: false,
    });
    const flacon = {
      nameRu: 'Флакон 10 мл (новый)',
      nameUz: 'Flakon 10 ml',
      unit: 'pcs',
      use: 'flacon',
      ml: 10,
      lowThreshold: 10,
    } as const;
    const twice = await manager.client.admin.consumables.create({ body: flacon });
    expect(twice.status === 409 && twice.body).toEqual({ code: 'link_taken', fields: ['ml'] });

    const old = await consumable(t, 'flacon', 10);
    const archived = await manager.client.admin.consumables.update({
      params: { id: old.id },
      body: { nameRu: old.nameRu, nameUz: old.nameUz, lowThreshold: 0, archived: true },
    });
    expect(archived.status === 200 && archived.body.archived).toBe(true);
    const fresh = await manager.client.admin.consumables.create({ body: flacon });
    expect(fresh.status).toBe(201);
    // the archived one can't come back while the new one is active
    const back = await manager.client.admin.consumables.update({
      params: { id: old.id },
      body: { nameRu: old.nameRu, nameUz: old.nameUz, lowThreshold: 0, archived: false },
    });
    expect(back.status === 409 && back.body.code).toBe('link_taken');
    // archived items list last
    expect((await items()).at(-1)).toMatchObject({ id: old.id, archived: true });

    expect((await audits('consumable.created')).map((a) => a.actorId)).toEqual([
      owner.staff.id,
      manager.staff.id,
    ]);
    const [updated] = await audits('consumable.updated');
    expect(updated?.payload).toMatchObject({ archived: [false, true], lowThreshold: [20, 0] });

    // the link must fit the use (the schema)
    for (const body of [
      { ...flacon, ml: null },
      { ...flacon, ml: 15 },
      { ...flacon, use: 'box', ml: 5 },
      {
        nameRu: 'Спирт 2',
        nameUz: 'Spirt 2',
        unit: 'pcs',
        use: 'ethanol',
        ml: null,
        lowThreshold: 0,
      },
      { nameRu: 'X', nameUz: 'X', unit: 'pcs', use: 'other', ml: 10, lowThreshold: 0 },
    ]) {
      const res = await fetch(`${t.baseUrl}/admin/consumables`, {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('receives and counts with a reason; a stale count is 409; the history keeps notes and reasons', async () => {
    const box = await consumable(t, 'box', 30);
    const got = await manager.client.admin.consumables.receive({
      params: { id: box.id },
      body: { quantity: 100, note: 'Поставщик А' },
    });
    expect(got.status === 201 && got.body).toMatchObject({ onHand: 100, level: 'ok' });
    const counted = await manager.client.admin.consumables.count({
      params: { id: box.id },
      body: { onHand: 20, expected: 100, reason: 'Пересчёт' },
    });
    // at the threshold (20): low
    expect(counted.status === 200 && counted.body).toMatchObject({ onHand: 20, level: 'low' });
    const stale = await owner.client.admin.consumables.count({
      params: { id: box.id },
      body: { onHand: 50, expected: 100, reason: 'Пересчёт' },
    });
    expect(stale.status === 409 && stale.body).toEqual({ code: 'changed', current: 20 });

    const history = await owner.client.admin.consumables.history({ params: { id: box.id } });
    if (history.status !== 200) throw new Error('history');
    expect(history.body.item).toMatchObject({ id: box.id, onHand: 20 });
    expect(
      history.body.moves.map((m) => [
        m.kind,
        m.fragranceId,
        m.consumables[0]?.change,
        m.reason,
        m.note,
      ]),
    ).toEqual([
      ['consumable_corrected', null, -80, 'Пересчёт', null],
      ['consumable_received', null, 100, null, 'Поставщик А'],
    ]);
    const [received] = await audits('consumable.received');
    expect(received).toMatchObject({ actorId: manager.staff.id, targetType: 'consumable' });
    expect(received?.payload).toMatchObject({
      quantity: 100,
      onHand: [0, 100],
      note: 'Поставщик А',
    });
    const [fixed] = await audits('consumable.corrected');
    expect(fixed?.payload).toMatchObject({ onHand: [100, 20], reason: 'Пересчёт' });
  });

  it('a count that changes nothing clears «Пересчитайте» and moves nothing', async () => {
    const flacon = await consumable(t, 'flacon', 50);
    await t.db.update(consumables).set({ needsRecount: true }).where(eq(consumables.id, flacon.id));
    const res = await manager.client.admin.consumables.count({
      params: { id: flacon.id },
      body: { onHand: 0, reason: 'Пересчитали, ноль' },
    });
    expect(res.status === 200 && res.body).toMatchObject({ onHand: 0, needsRecount: false });
    expect(await t.db.select().from(stockMoves)).toEqual([]);
    expect(await audits('consumable.corrected')).toHaveLength(1);
  });

  it('needs a session, a reason and a known item', async () => {
    expect((await t.client.admin.consumables.list()).status).toBe(401);
    const box = await consumable(t, 'box', 10);
    const noReason = await fetch(`${t.baseUrl}/admin/consumables/${box.id}/counts`, {
      method: 'POST',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ onHand: 3, reason: ' ' }),
    });
    expect(noReason.status).toBe(400);
    const zero = await fetch(`${t.baseUrl}/admin/consumables/${box.id}/receipts`, {
      method: 'POST',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 0 }),
    });
    expect(zero.status).toBe(400);
    const missing = { params: { id: 9999 } };
    expect(
      (await manager.client.admin.consumables.receive({ ...missing, body: { quantity: 1 } }))
        .status,
    ).toBe(404);
    expect(
      (
        await manager.client.admin.consumables.count({
          ...missing,
          body: { onHand: 1, reason: 'x' },
        })
      ).status,
    ).toBe(404);
    expect((await manager.client.admin.consumables.history(missing)).status).toBe(404);
    expect(
      (
        await manager.client.admin.consumables.update({
          ...missing,
          body: { nameRu: 'x', nameUz: 'x', lowThreshold: 0, archived: false },
        })
      ).status,
    ).toBe(404);
  });
});

describe('the Excel export', () => {
  it('has the stock, the consumables and the whole history; values for the owner only', async () => {
    const id = await fragranceId();
    await setConcentrateUl(t, id, 0);
    await receive(id);
    await setEthanol(1000);
    expect((await mix(id, 30.9)).status).toBe(201);
    const name = (await page(id)).name;

    const res = await fetch(`${t.baseUrl}/admin/warehouse/export?lang=ru`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Склад', 'Расходники', 'История']);
    const stock = wb.worksheets[0]!;
    expect((stock.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Аромат',
      'Масло, г',
      'Масло, мл',
      'Концентрат, мл',
      'В резерве, мл',
      'Свободно, мл',
      'Масло по себестоимости',
      'Концентрат по себестоимости',
      'Всего',
    ]);
    const row = stock.getSheetValues().find((v) => Array.isArray(v) && v[1] === name) as
      unknown[] | undefined;
    // 100 − 9.27 g of oil; 30.9 ml of concentrate, none held
    expect(row?.slice(2, 7)).toEqual([90.73, 90.73, 30.9, 0, 30.9]);

    const items = wb.worksheets[1]!;
    expect((items.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Расходник',
      'Ед.',
      'На складе',
      'Мало при',
      'Состояние',
    ]);
    expect(items.rowCount).toBe(9);
    const spirit = items.getSheetValues().find((v) => Array.isArray(v) && v[1] === 'Спирт') as
      unknown[] | undefined;
    // 30.9 ml takes 21.63 ml of spirit → 22
    expect(spirit?.slice(1, 5)).toEqual(['Спирт', 'мл', 978, 1000]);

    const history = wb.worksheets[2]!;
    expect(history.rowCount).toBe(3); // header, the mixing, the receipt
    const headers = (history.getRow(1).values as unknown[]).slice(1);
    const mixing = (history.getRow(2).values as unknown[]).slice(1);
    expect(mixing[headers.indexOf('Операция')]).toBe('Приготовлен концентрат');
    expect(mixing[headers.indexOf('Концентрат, мл')]).toBe(30.9);
    expect(mixing[headers.indexOf('Расходники')]).toBe('Спирт -22');

    // a manager's file has no values
    const theirs = await fetch(`${t.baseUrl}/admin/warehouse/export?lang=uz`, {
      headers: { cookie: manager.cookie },
    });
    expect(theirs.status).toBe(200);
    const mb = new ExcelJS.Workbook();
    await mb.xlsx.load(await theirs.arrayBuffer());
    expect((mb.worksheets[0]!.getRow(1).values as unknown[]).slice(1)).toHaveLength(6);
    // nor the invoice and supplier in the history sheet: the document cell of the oil receipt is empty
    const theirHistory = mb.worksheets[2]!;
    const documentColumn = (theirHistory.getRow(1).values as unknown[]).indexOf('Hujjat');
    expect(documentColumn).toBeGreaterThan(0);
    const cells = [2, 3].map((n) => theirHistory.getRow(n).getCell(documentColumn).value ?? '');
    expect(cells).toEqual(['', '']);
    expect(await audits('warehouse.exported')).toHaveLength(2);
  });
});
