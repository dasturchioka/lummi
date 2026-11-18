import type { FragranceInput, ImportReport } from '@lummi/contracts';
import { auditLog, eq, fragrances } from '@lummi/db';
import ExcelJS from 'exceljs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/catalog/seed';
import { seedOilPrices, type OilPriceEntry } from '../src/catalog/seed-oil-prices';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): the cost model (#75, ADR 0040) over HTTP. Expected unit costs are the
 * customer's calculator figures for a made-up oil price (the unit table in
 * `unit-cost.unit.test.ts`), never recomputed. Prices, suppliers and invoices here are all made up.
 */
const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.clock.set(new Date('2026-11-18T10:00:00Z'));
  await seedCatalog(t.db, { materialsDir, limit: 6 });
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const input = (over: Partial<FragranceInput> = {}): FragranceInput => ({
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
  oilPrice: 3950,
  tier: 'premium',
  oilSupplier: 'Test Oils',
  oilInvoice: 'INV-0001 от 01.11.2026',
  isHit: false,
  isNew: false,
  hidden: false,
  notes: { top: [], heart: [], base: [] },
  similarIds: [],
  volumes: [
    { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: 5 },
    { ml: 30, price: 150_000, salePrice: null, saleEndsOn: null, onHand: 5 },
  ],
  ...over,
});

async function created(over: Partial<FragranceInput> = {}) {
  const res = await owner.client.admin.catalog.fragrances.create({ body: input(over) });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return res.body;
}

/** The contract does not list the 400 a schema failure answers with, so those cases go raw. */
async function put(path: string, body: unknown) {
  const res = await fetch(`${t.baseUrl}${path}`, {
    method: 'PUT',
    headers: { cookie: owner.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

describe('oil price, tier, supplier and invoice through the admin', () => {
  it('stores them on create and reads them back', async () => {
    const f = await created();
    expect(f).toMatchObject({
      oilPrice: 3950,
      tier: 'premium',
      oilSupplier: 'Test Oils',
      oilInvoice: 'INV-0001 от 01.11.2026',
    });
    const got = await owner.client.admin.catalog.fragrances.get({ params: { id: f.id } });
    expect(got.status === 200 && got.body).toMatchObject({ oilPrice: 3950, tier: 'premium' });
  });

  it('changes and clears them, and the audit names what changed', async () => {
    const f = await created();
    const upd = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: input({ oilPrice: 4100, tier: 'premium_new', oilSupplier: null, oilInvoice: '  ' }),
    });
    expect(upd.status === 200 && upd.body).toMatchObject({
      oilPrice: 4100,
      tier: 'premium_new',
      oilSupplier: null,
      oilInvoice: null,
    });
    const [row] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'catalog.fragrance_updated'));
    expect(row).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect((row!.payload as { changed: string[] }).changed).toEqual(
      expect.arrayContaining(['oilPrice', 'tier', 'oilSupplier', 'oilInvoice']),
    );
  });

  it.each([
    ['a zero oil price', { oilPrice: 0 }],
    ['a fractional oil price', { oilPrice: 39.5 }],
    ['an unknown tier', { tier: 'gold' }],
  ])('refuses %s with 400 and changes nothing', async (_name, over) => {
    const f = await created();
    expect(await put(`/admin/catalog/fragrances/${f.id}`, { ...input(), ...over })).toBe(400);
    const got = await owner.client.admin.catalog.fragrances.get({ params: { id: f.id } });
    expect(got.status === 200 && got.body).toMatchObject({ oilPrice: 3950, tier: 'premium' });
  });
});

/** Oil at 3950 so'm/g and the calculator's P0: the unit table's figures. */
const COST_10 = { oil: 11440, ethanol: 1082, bottle: 2000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 22022, defect: 440, total: 22462 };
const COST_30 = { oil: 34321, ethanol: 3245, bottle: 6000, label: 500, spray: 0, filling: 1000, box: 5000, insert: 1000, base: 51065, defect: 1021, total: 52086 };

const costs = async (id: number, as = owner) =>
  as.client.admin.catalog.fragrances.costs({ params: { id } });

describe('the cost of each volume on the catalog page', () => {
  it('breaks each volume down at the default settings, against its price', async () => {
    const f = await created();
    const res = await costs(f.id);
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    // 3950 × 0.91 × 1.03 = 3702.3
    expect(res.body).toMatchObject({ oilPrice: 3950, landedOilPrice: 3702 });
    const [ten, thirty] = res.body.volumes;
    expect(ten).toMatchObject({
      ml: 10,
      price: 70_000,
      markdownPrice: null,
      cost: COST_10,
      profit: 47_538,
      markdownProfit: null,
      markdownMargin: null,
    });
    expect(ten!.margin).toBeCloseTo(47_538 / 70_000, 6);
    expect(thirty).toMatchObject({ ml: 30, price: 150_000, cost: COST_30, profit: 97_914 });
    expect(thirty!.margin).toBeCloseTo(97_914 / 150_000, 6);
  });

  it('follows the settings: with no defect percent the total is the base', async () => {
    const f = await created();
    const set = await owner.client.admin.settings.update({
      params: { key: 'cost.packaging.defectPercent' },
      body: { value: 0 },
    });
    expect(set.status).toBe(200);
    const res = await costs(f.id);
    expect(res.status === 200 && res.body.volumes.map((v) => v.cost?.total)).toEqual([22_022, 51_065]);
  });

  it('shows the profit at an active markdown too, and not at an ended one', async () => {
    const f = await created({
      volumes: [
        { ml: 10, price: 70_000, salePrice: 60_000, saleEndsOn: null, onHand: 5 },
        { ml: 30, price: 150_000, salePrice: 120_000, saleEndsOn: '2026-11-17', onHand: 5 },
      ],
    });
    const res = await costs(f.id);
    if (res.status !== 200) throw new Error(String(res.status));
    const [ten, thirty] = res.body.volumes;
    expect(ten).toMatchObject({ markdownPrice: 60_000, markdownProfit: 37_538 });
    expect(ten!.markdownMargin).toBeCloseTo(37_538 / 60_000, 6);
    expect(thirty).toMatchObject({ markdownPrice: null, markdownProfit: null });
  });

  it('has no cost while the oil price is unknown', async () => {
    const f = await created({ oilPrice: null, tier: null });
    const res = await costs(f.id);
    expect(res.status === 200 && res.body).toMatchObject({
      oilPrice: null,
      landedOilPrice: null,
      volumes: [
        { ml: 10, price: 70_000, cost: null, profit: null, margin: null },
        { ml: 30, price: 150_000, cost: null, profit: null, margin: null },
      ],
    });
  });

  it('is the owner\'s: a manager gets 403, an unknown fragrance 404', async () => {
    const f = await created();
    expect((await costs(f.id, manager)).status).toBe(403);
    expect((await costs(999_999)).status).toBe(404);
  });
});

describe('the cost settings (liquid, packaging, order costs)', () => {
  it('start at the calculator values and round-trip, fractions included, each change audited', async () => {
    const list = async () => {
      const res = await owner.client.admin.settings.list();
      if (res.status !== 200) throw new Error(String(res.status));
      return new Map(res.body.map((r) => [r.key, r.value]));
    };
    const before = await list();
    expect([
      before.get('cost.liquid.oilPercent'),
      before.get('cost.liquid.ethanolPerLitre'),
      before.get('cost.packaging.box30Ml'),
      before.get('cost.order.uzumCommissionPercent'),
    ]).toEqual([30, 150_000, 5000, 20.5]);

    const changes = [
      ['cost.liquid.oilDensity', 0.95],
      ['cost.packaging.box30Ml', 6500],
      ['cost.order.uzumCommissionPercent', 18.5],
    ] as const;
    for (const [key, value] of changes) {
      const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
      expect(res.status).toBe(200);
    }
    const after = await list();
    for (const [key, value] of changes) expect(after.get(key)).toBe(value);
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, 'setting.changed'));
    expect(audit.map((a) => [a.targetId, a.payload])).toEqual(
      expect.arrayContaining([
        ['cost.liquid.oilDensity', { old: 1, new: 0.95 }],
        ['cost.packaging.box30Ml', { old: 5000, new: 6500 }],
        ['cost.order.uzumCommissionPercent', { old: 20.5, new: 18.5 }],
      ]),
    );
  });

  it.each([
    ['cost.liquid.oilPercent', 101],
    ['cost.liquid.oilDensity', 0],
    ['cost.packaging.bottle10Ml', 1999.5],
    ['cost.packaging.label', -1],
    ['cost.order.giftSampleMl', 6],
  ])('refuses %s = %s and stores nothing', async (key, value) => {
    const res = await owner.client.admin.settings.update({ params: { key }, body: { value } });
    expect(res.status).toBe(400);
    const list = await owner.client.admin.settings.list();
    const row = list.status === 200 ? list.body.find((r) => r.key === key) : null;
    expect(row?.updatedAt).toBeNull();
  });
});

// ---- the Excel template (#26): four optional columns at the end of «Ароматы»
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const H = {
  oilPrice: 'Масло, сум за 1 г (до скидки)',
  tier: 'Категория масла',
  supplier: 'Поставщик масла',
  invoice: 'Накладная на масло',
};
const call = (path: string, body?: Buffer) =>
  fetch(`${t.baseUrl}/admin/catalog/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: owner.cookie, ...(body ? { 'content-type': XLSX } : {}) },
    body: body as never,
  });
const exportBytes = async () => Buffer.from(await (await call('export')).arrayBuffer());
const dryRun = async (file: Buffer) => (await (await call('import/dry-run', file)).json()) as ImportReport;
async function editSheet(bytes: Buffer, fn: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  fn(wb.getWorksheet('Ароматы')!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function colOf(ws: ExcelJS.Worksheet, header: string): number {
  let found = 0;
  ws.getRow(1).eachCell((c, n) => {
    if (c.text === header) found = n;
  });
  if (!found) throw new Error(`no column ${header}`);
  return found;
}
/** Row of the fragrance with this internal code on «Ароматы». */
function rowOf(ws: ExcelJS.Worksheet, code: string): ExcelJS.Row {
  let at = 0;
  ws.eachRow((r, n) => {
    if (r.getCell(1).text.trim() === code) at = n;
  });
  if (!at) throw new Error(`no row ${code}`);
  return ws.getRow(at);
}
const stored = async (code: string) =>
  (
    await t.db
      .select({
        oilPrice: fragrances.oilPrice,
        tier: fragrances.tier,
        oilSupplier: fragrances.oilSupplier,
        oilInvoice: fragrances.oilInvoice,
      })
      .from(fragrances)
      .where(eq(fragrances.code, code))
  )[0];

/** A made-up oil price list in a temp file, as the server keeps the real one. */
async function listFile(entries: OilPriceEntry[]): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'oil-prices-')), 'oil-prices.json');
  await writeFile(file, JSON.stringify(entries));
  return file;
}
const entry = (name: string, oilPrice: number, tier: OilPriceEntry['tier'] = 'top'): OilPriceEntry => ({
  name,
  tier,
  oilPrice,
  supplier: 'Test Oils',
  invoice: 'INV-0001',
});
const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (l: string) => void lines.push(l) };
};

describe('oil prices from the file at OIL_PRICES_FILE (seed and staging deploy)', () => {
  it('skips with one log line when the variable is unset or the file is missing', async () => {
    expect(process.env.OIL_PRICES_FILE).toBeUndefined();
    const a = quiet();
    expect(await seedOilPrices(t.db, undefined, a.log)).toEqual({ skipped: 'unset' });
    const b = quiet();
    expect(await seedOilPrices(t.db, '/nonexistent/oil-prices.json', b.log)).toEqual({ skipped: 'missing' });
    expect([a.lines.length, b.lines.length]).toEqual([1, 1]);
    expect(await stored('001')).toEqual({ oilPrice: null, tier: null, oilSupplier: null, oilInvoice: null });
  });

  it('fills by brand + name, only what is empty, and a second run changes nothing', async () => {
    await t.db.update(fragrances).set({ oilPrice: 7777 }).where(eq(fragrances.code, '002'));
    const file = await listFile([
      entry('Amouage Guidance', 1234),
      entry('Antonio Banderas Blue Seduction', 1357, 'premium'),
      entry('By Kilian Good Girl Gone Bad', 1468, 'premium_new'),
      entry('Some Fragrance We Do Not Sell', 1579),
    ]);
    const q = quiet();
    const res = await seedOilPrices(t.db, file, q.log);
    expect(res).toMatchObject({ filled: 3, unmatchedList: ['Some Fragrance We Do Not Sell'] });
    expect(q.lines).toHaveLength(1);
    expect(await stored('001')).toEqual({
      oilPrice: 1234,
      tier: 'top',
      oilSupplier: 'Test Oils',
      oilInvoice: 'INV-0001',
    });
    // the owner's 7777 stays; the empty rest is filled
    expect(await stored('002')).toEqual({
      oilPrice: 7777,
      tier: 'premium',
      oilSupplier: 'Test Oils',
      oilInvoice: 'INV-0001',
    });
    expect(await stored('006')).toMatchObject({ oilPrice: 1468, tier: 'premium_new' });
    expect(await stored('003')).toEqual({ oilPrice: null, tier: null, oilSupplier: null, oilInvoice: null });
    expect(await seedOilPrices(t.db, file, quiet().log)).toMatchObject({ filled: 0 });
  });
});

describe('oil price and tier in the Excel import and export', () => {
  beforeEach(async () => {
    await seedOilPrices(t.db, await listFile([entry('Amouage Guidance', 1234)]), quiet().log);
  });

  it('the seed workbook leaves them empty; the export carries what is stored', async () => {
    expect(await stored('002')).toEqual({ oilPrice: null, tier: null, oilSupplier: null, oilInvoice: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await exportBytes()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Ароматы')!;
    const cells = (code: string) =>
      [H.oilPrice, H.tier, H.supplier, H.invoice].map((h) => rowOf(ws, code).getCell(colOf(ws, h)).value);
    expect(cells('001')).toEqual([1234, 'TOP', 'Test Oils', 'INV-0001']);
    expect(cells('002')).toEqual([null, null, null, null]);
  });

  it('a changed file lists the change, and «Применить» writes it with the audit', async () => {
    const file = await editSheet(await exportBytes(), (ws) => {
      const row = rowOf(ws, '001');
      row.getCell(colOf(ws, H.oilPrice)).value = '2 400';
      row.getCell(colOf(ws, H.tier)).value = 'premium new';
      row.getCell(colOf(ws, H.supplier)).value = null;
    });
    const report = await dryRun(file);
    expect(report.errors).toEqual([]);
    const change = report.changes.find((c) => c.code === '001');
    expect(change?.fields).toEqual(
      expect.arrayContaining([
        { field: 'oilPrice', before: 1234, after: 2400 },
        { field: 'tier', before: 'top', after: 'premium_new' },
        { field: 'oilSupplier', before: 'Test Oils', after: '' },
      ]),
    );
    expect((await call(`import/apply?token=${report.token}`, file)).status).toBe(201);
    expect(await stored('001')).toEqual({
      oilPrice: 2400,
      tier: 'premium_new',
      oilSupplier: null,
      oilInvoice: 'INV-0001',
    });
    const [log] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'catalog.fragrance_updated'));
    expect(log).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect((log!.payload as { changed: string[] }).changed).toEqual(
      expect.arrayContaining(['oilPrice', 'tier', 'oilSupplier']),
    );
  });

  it('reports a bad oil price or tier on its row and column, and gives no token', async () => {
    const file = await editSheet(await exportBytes(), (ws) => {
      rowOf(ws, '001').getCell(colOf(ws, H.oilPrice)).value = 'дорого';
      rowOf(ws, '002').getCell(colOf(ws, H.oilPrice)).value = 0;
      rowOf(ws, '003').getCell(colOf(ws, H.tier)).value = 'GOLD';
    });
    const report = await dryRun(file);
    expect(report.token).toBeNull();
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'fragrances', row: 2, column: H.oilPrice, code: 'bad_number' }),
        expect.objectContaining({ sheet: 'fragrances', row: 3, column: H.oilPrice, code: 'bad_number' }),
        expect.objectContaining({
          sheet: 'fragrances',
          row: 4,
          column: H.tier,
          code: 'bad_option',
          params: { value: 'GOLD', options: 'TOP, PREMIUM, PREMIUM NEW' },
        }),
      ]),
    );
  });

  it('a file from the older template, without the four columns, keeps the stored values', async () => {
    const file = await editSheet(await exportBytes(), (ws) => {
      for (const h of [H.invoice, H.supplier, H.tier, H.oilPrice]) ws.spliceColumns(colOf(ws, h), 1);
    });
    const report = await dryRun(file);
    expect(report.errors).toEqual([]);
    expect(report.counts.fragrances).toMatchObject({ new: 0, changed: 0, unchanged: 6 });
  });

  it('the seed run again never clears or overwrites an oil price the owner set', async () => {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.code, '002'));
    await t.db.update(fragrances).set({ oilPrice: 9999, tier: 'premium' }).where(eq(fragrances.id, f!.id));
    await seedCatalog(t.db, { materialsDir, limit: 6 });
    expect(await stored('001')).toMatchObject({ oilPrice: 1234, tier: 'top' });
    expect(await stored('002')).toMatchObject({ oilPrice: 9999, tier: 'premium' });
  });
});
