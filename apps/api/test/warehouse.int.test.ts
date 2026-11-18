import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FragranceInput, OilReceiptInput, WarehouseFragrance } from '@lummi/contracts';
import { auditLog, eq, fragrances, settings, stockMoves, volumes } from '@lummi/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { cancelByStaff, fulfilTo, pay, placeOrder } from './harness/fulfilment';
import { shopper, slugs as slugsOf } from './harness/orders';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the raw-material warehouse (#76, ADR 0041) over HTTP. Oil amounts are worked
 * out by hand from the cost settings' defaults (oil 30 %, density 1 g/ml, filling loss 3 %): a
 * 10 ml bottle takes 3.09 g of oil, 30 ml 9.27 g, 50 ml 15.45 g. Suppliers, invoices and prices
 * are made up.
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
const bottle = (id: number, lines: { ml: number; quantity: number }[], as = manager) =>
  as.client.admin.warehouse.bottle({ params: { id }, body: { lines } });
/** A new fragrance as the owner's form sends it: 10 ml counted `onHand`, 30 ml none. */
const formInput = (onHand: number, loadedOnHand?: number): FragranceInput => ({
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
    { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand, loadedOnHand },
    { ml: 30, price: 150_000, salePrice: null, saleEndsOn: null, onHand: 0, loadedOnHand: 0 },
  ],
});
const onHand = (p: WarehouseFragrance, ml: number) => p.volumes.find((v) => v.ml === ml)!.onHand;
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('an oil receipt, then a bottling', () => {
  it('adds the grams to the oil balance, then takes the oil by the formula and raises on hand', async () => {
    const id = await fragranceId();
    const before = await page(id);
    expect(before.oil).toMatchObject({ oilGrams: 0, liquidLitres: 0, level: 'zero' });

    const r = await receive(id);
    // 4 000 × 0.91 × 1.03 = 3 749.2 so'm per gram; 100 g = 374 920
    expect(r).toMatchObject({ grams: 100, landedPerGram: 3749, total: 374_920, voided: false });
    // 100 g ÷ 0.3 ÷ 1.03 = 323.6 ml of perfume
    expect((await page(id)).oil).toMatchObject({ oilGrams: 100, liquidLitres: 0.324 });

    const res = await bottle(id, [
      { ml: 10, quantity: 4 },
      { ml: 30, quantity: 2 },
      { ml: 50, quantity: 1 },
    ]);
    // 4 × 3.09 + 2 × 9.27 + 15.45 = 46.35 g of oil; ethanol 108.15 ml
    expect(res.status === 201 && res.body).toMatchObject({
      oilGrams: 46.35,
      ethanolMl: 108,
      oilLeftGrams: 53.65,
    });
    const after = await page(id);
    expect(after.oil.oilGrams).toBe(53.65);
    expect([10, 30, 50].map((ml) => onHand(after, ml) - onHand(before, ml))).toEqual([4, 2, 1]);
    expect(after.perBottle).toEqual([
      { ml: 10, oilGrams: 3.09, ethanolMl: 7.21 },
      { ml: 30, oilGrams: 9.27, ethanolMl: 21.63 },
      { ml: 50, oilGrams: 15.45, ethanolMl: 36.05 },
    ]);
  });

  it('follows the liquid settings at the time of the bottling', async () => {
    const id = await fragranceId();
    await receive(id);
    await t.db.insert(settings).values([
      { key: 'cost.liquid.oilPercent', value: 25 },
      { key: 'cost.liquid.oilDensity', value: 0.95 },
      { key: 'cost.liquid.fillingLossPercent', value: 5 },
    ]);
    // 10 ml × 1.05 × 25 % × 0.95 g/ml = 2.49375 g → 2.494 g
    const res = await bottle(id, [{ ml: 10, quantity: 1 }]);
    expect(res.status === 201 && res.body).toMatchObject({ oilGrams: 2.494, oilLeftGrams: 97.506 });
  });

  it('refuses a short balance with the shortfall and changes nothing', async () => {
    const id = await fragranceId();
    await receive(id, { grams: 10 });
    const before = await page(id);
    const res = await bottle(id, [{ ml: 50, quantity: 2 }]);
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({
      code: 'oil_short',
      neededGrams: 30.9,
      balanceGrams: 10,
      shortGrams: 20.9,
    });
    const after = await page(id);
    expect(after.oil.oilGrams).toBe(10);
    expect(after.volumes).toEqual(before.volumes);
    expect(await audits('warehouse.bottled')).toHaveLength(0);
  });

  it('lets only one of two concurrent bottlings take oil the balance holds once', async () => {
    const id = await fragranceId();
    await receive(id, { grams: 40 });
    const before = await page(id);
    const [a, b] = await Promise.all([
      bottle(id, [{ ml: 50, quantity: 2 }], owner),
      bottle(id, [{ ml: 50, quantity: 2 }], manager),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const after = await page(id);
    expect(after.oil.oilGrams).toBe(9.1);
    expect(onHand(after, 50) - onHand(before, 50)).toBe(2);
  });

  it('refuses a volume the fragrance does not have, and an empty bottling', async () => {
    const id = await fragranceId();
    await receive(id);
    const res = await bottle(id, [{ ml: 15, quantity: 1 }]);
    expect(res.status).toBe(422);
    expect(res.status === 422 && res.body).toEqual({ code: 'invalid', fields: ['lines.0.ml'] });
    const raw = await fetch(`${t.baseUrl}/admin/warehouse/fragrances/${id}/bottlings`, {
      method: 'POST',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ lines: [{ ml: 10, quantity: 0 }] }),
    });
    expect(raw.status).toBe(400);
    expect((await page(id)).oil.oilGrams).toBe(100);
  });

  it('answers 404 for a fragrance that does not exist', async () => {
    expect((await bottle(9999, [{ ml: 10, quantity: 1 }])).status).toBe(404);
    expect((await owner.client.admin.warehouse.get({ params: { id: 9999 } })).status).toBe(404);
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
    expect((await page(id)).oil.oilGrams).toBe(150);

    const voided = await owner.client.admin.warehouse.voidOilReceipt({
      params: { id: r.id },
      body: { reason: 'Накладная ошибочная' },
    });
    expect(voided.status === 200 && voided.body).toMatchObject({
      voided: true,
      voidReason: 'Накладная ошибочная',
    });
    expect((await page(id)).oil.oilGrams).toBe(0);

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

  it('refuses to take back oil that was already bottled', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    await bottle(id, [{ ml: 50, quantity: 2 }]); // 30.9 g: 69.1 g left
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
    expect((await page(id)).oil.oilGrams).toBe(69.1);
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
    expect(pa.oil).toMatchObject({ oilGrams: 0 });
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
    expect(list.body.oil.find((o) => o.fragranceId === ida)?.drafts).toBe(1);
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
    expect(p.oil.oilGrams).toBe(980);
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
    expect((await page(id)).oil.value?.oil).toBe(0);
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
  it('names the actor of every receipt, correction, void and bottling', async () => {
    const id = await fragranceId();
    const r = await receive(id);
    await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 120, reason: 'Довесили' },
    });
    await bottle(id, [{ ml: 10, quantity: 2 }]);
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
    const [bottled] = await audits('warehouse.bottled');
    expect(bottled).toMatchObject({ actorId: manager.staff.id, targetType: 'fragrance' });
    expect(bottled?.payload).toMatchObject({
      lines: [{ ml: 10, quantity: 2 }],
      oilGrams: 6.18,
      ethanolMl: 14,
    });
    const [voided] = await audits('warehouse.oil_receipt_voided');
    expect(voided?.payload).toMatchObject({ reason: 'Дубль', grams: 100, invoice: 'INV-0002' });
  });
});

describe('who may do what', () => {
  it('keeps oil receipts and values to the owner; a manager bottles and reads the oil', async () => {
    const id = await fragranceId();
    const refused = await manager.client.admin.warehouse.receiveOil({
      params: { id },
      body: RECEIPT,
    });
    expect(refused.status).toBe(403);
    await receive(id);
    const seen = await page(id, manager);
    expect(seen).toMatchObject({ oilReceipts: null, oilReceiptDefaults: null });
    expect(seen.oil).toMatchObject({ oilGrams: 100, value: null });
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
    expect((await bottle(id, [{ ml: 10, quantity: 1 }], manager)).status).toBe(201);
    expect((await t.client.admin.warehouse.get({ params: { id } })).status).toBe(401);
  });

  it("gives the owner the receipts, the form's defaults and the stock value", async () => {
    const id = await fragranceId();
    await t.db
      .update(fragrances)
      .set({ oilPrice: 3950, oilSupplier: 'Test Oils' })
      .where(eq(fragrances.id, id));
    await t.db.update(volumes).set({ onHand: 2 }).where(eq(volumes.fragranceId, id));
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
    // bottles at oil 3 950 so'm/g: 2 × (22 462 + 52 086 + 78 651) = 306 398
    expect(p.oil.value).toEqual({ oil: 4_740_888, bottles: 306_398, total: 5_047_286 });
  });

  it('values the bottles at nothing known without an oil price', async () => {
    const id = await fragranceId();
    await t.db.update(fragrances).set({ oilPrice: null }).where(eq(fragrances.id, id));
    await receive(id);
    expect((await page(id)).oil.value).toEqual({ oil: 374_920, bottles: null, total: null });
  });
});

describe('the history', () => {
  it('lists receipts, corrections, bottlings, counts, sales at handover and returns, newest first', async () => {
    await importBtsPoints(t.db, snapshot);
    const [slug] = await slugsOf(t, 1);
    const id = await fragranceId(slug);
    const r = await receive(id);
    await owner.client.admin.warehouse.correctOilReceipt({
      params: { id: r.id },
      body: { ...RECEIPT, grams: 110, reason: 'Довесили' },
    });
    await bottle(id, [{ ml: 10, quantity: 3 }]);
    const ten = (await page(id)).volumes.find((v) => v.ml === 10)!;
    const counted = await manager.client.admin.onHand.set({
      params: { id: ten.volumeId },
      body: { onHand: ten.onHand - 1, expected: ten.onHand, reason: 'Разбился флакон' },
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
    await cancelByStaff(t, order.number);

    const { history } = await page(id);
    expect(history.map((m) => [m.kind, m.oilGrams, m.bottles])).toEqual([
      ['returned', 0, [{ ml: 10, change: 2 }]],
      ['sale', 0, [{ ml: 10, change: -2 }]],
      ['correction', 0, [{ ml: 10, change: -1 }]],
      ['bottling', -9.27, [{ ml: 10, change: 3 }]],
      ['oil_receipt_corrected', 10, []],
      ['oil_receipt', 100, []],
    ]);
    expect(history[0]).toMatchObject({ orderNumber: order.number, actorName: manager.staff.name });
    expect(history[2]).toMatchObject({
      reason: 'Разбился флакон',
      source: 'stock',
      actorName: manager.staff.name,
    });
    expect(history[4]).toMatchObject({
      reason: 'Довесили',
      invoice: 'INV-0001',
      supplier: 'Test Oils',
      actorName: owner.staff.name,
    });
    // the moves add up to the balance
    const moves = await t.db.select().from(stockMoves).where(eq(stockMoves.fragranceId, id));
    expect(moves.reduce((a, m) => a + m.oilMg, 0)).toBe(100_730);
    expect((await page(id)).oil.oilGrams).toBe(100.73);
  });

  it("records the fragrance form's counts as counts from the form", async () => {
    const created = await owner.client.admin.catalog.fragrances.create({ body: formInput(5) });
    if (created.status !== 201) throw new Error(`create ${created.status}`);
    const f = created.body;
    const updated = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: formInput(8, 5),
    });
    expect(updated.status).toBe(200);
    const { history } = await page(f.id);
    expect(history.map((m) => [m.kind, m.source, m.bottles, m.actorName])).toEqual([
      ['correction', 'form', [{ ml: 10, change: 3 }], owner.staff.name],
      ['correction', 'form', [{ ml: 10, change: 5 }], owner.staff.name],
    ]);
  });
});

describe('the stock page', () => {
  it("shows each fragrance's oil, warns from the low-oil setting, and filters by it", async () => {
    const [a, b] = await slugsOf(t, 2);
    const low = await fragranceId(a);
    const ok = await fragranceId(b);
    await receive(low, { grams: 200 }); // 0.647 l
    await receive(ok, { grams: 400 }); // 1.294 l
    const res = await manager.client.admin.stock.list({ query: { q: '' } });
    if (res.status !== 200) throw new Error('stock');
    expect(res.body.lowOilLitres).toBe(1);
    const oilOf = (fid: number) => res.body.oil.find((o) => o.fragranceId === fid);
    expect(oilOf(low)).toMatchObject({
      oilGrams: 200,
      liquidLitres: 0.647,
      level: 'low',
      value: null,
    });
    expect(oilOf(ok)).toMatchObject({ oilGrams: 400, liquidLitres: 1.294, level: 'ok' });

    const filtered = await manager.client.admin.stock.list({
      query: { filter: 'oilLow', pageSize: 50 },
    });
    if (filtered.status !== 200) throw new Error('stock');
    const ids = new Set(filtered.body.rows.map((r) => r.fragranceId));
    expect(ids.has(low)).toBe(true);
    expect(ids.has(ok)).toBe(false);
    expect(ids.has(null)).toBe(false); // the Discovery set has no oil
  });

  it('asks a reason for an on-hand edit', async () => {
    const id = await fragranceId();
    const ten = (await page(id)).volumes.find((v) => v.ml === 10)!;
    const res = await fetch(`${t.baseUrl}/admin/volumes/${ten.volumeId}/on-hand`, {
      method: 'PATCH',
      headers: { cookie: manager.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ onHand: 3 }),
    });
    expect(res.status).toBe(400);
    const done = await manager.client.admin.onHand.set({
      params: { id: ten.volumeId },
      body: { onHand: 3, reason: 'Пересчёт' },
    });
    expect(done.status).toBe(200);
    const [row] = await audits('catalog.on_hand_changed');
    expect(row?.payload).toMatchObject({ reason: 'Пересчёт' });
  });
});

describe('the Excel export', () => {
  it('has a row per fragrance with its oil and bottles, values for the owner, and the history', async () => {
    const id = await fragranceId();
    await receive(id);
    await bottle(id, [{ ml: 30, quantity: 1 }]);
    const name = (await page(id)).name;

    const res = await fetch(`${t.baseUrl}/admin/warehouse/export?lang=ru`, {
      headers: { cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const stock = wb.worksheets[0]!;
    const header = (stock.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Аромат',
      'Масло, г',
      'Жидкость, л',
      '10 мл, шт.',
      '30 мл, шт.',
      '50 мл, шт.',
      'Масло по себестоимости',
      'Флаконы по себестоимости',
      'Всего',
    ]);
    const row = stock.getSheetValues().find((v) => Array.isArray(v) && v[1] === name) as
      unknown[] | undefined;
    expect(row?.slice(2, 4)).toEqual([90.73, 0.294]);

    const history = wb.worksheets[1]!;
    expect(history.rowCount).toBe(3); // header, receipt, bottling

    // a manager's file has no values
    const theirs = await fetch(`${t.baseUrl}/admin/warehouse/export?lang=uz`, {
      headers: { cookie: manager.cookie },
    });
    expect(theirs.status).toBe(200);
    const mb = new ExcelJS.Workbook();
    await mb.xlsx.load(await theirs.arrayBuffer());
    expect((mb.worksheets[0]!.getRow(1).values as unknown[]).slice(1)).toHaveLength(6);
    // nor the invoice and supplier in the history sheet: the document cell of the oil receipt is empty
    const theirHistory = mb.worksheets[1]!;
    const documentColumn = (theirHistory.getRow(1).values as unknown[]).indexOf('Hujjat');
    expect(documentColumn).toBeGreaterThan(0);
    const cells = [2, 3].map((n) => theirHistory.getRow(n).getCell(documentColumn).value ?? '');
    expect(cells).toEqual(['', '']);
    expect(await audits('warehouse.exported')).toHaveLength(2);
  });
});
