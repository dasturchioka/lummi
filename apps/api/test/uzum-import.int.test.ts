import type { UzumImportApplied, UzumImportReport } from '@lummi/contracts';
import { and, auditLog, discoverySet, eq, fragrances, uzumSales, volumes } from '@lummi/db';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tashkent } from './harness/fulfilment';
import { slugs } from './harness/orders';
import { concentrateUl, FILL_UL, stockBottles } from './harness/stock';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * Seam 1 (ADR 0028): Uzum sales from an Excel file (#80). The dry run checks every row and writes
 * nothing; «Записать» records the file's sales, all or none, through the form's own writer.
 */
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADERS = [
  'Дата продажи (ГГГГ-ММ-ДД)',
  'Номер заказа Uzum',
  'Аромат или набор',
  'Объём, мл',
  'Количество, шт.',
  'Цена за 1 шт., сум',
  'Комиссия Uzum, %',
];

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
type Picked = { id: number; name: string; vol: Record<number, number> };
let A: Picked;
let B: Picked;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-19 10:00'));
  await t.reset();
  await t.seedCatalog();
  owner = await t.ownerSession();
  manager = await t.managerSession();
  const picked: Picked[] = [];
  for (const slug of await slugs(t, 2)) {
    const [f] = await t.db.select().from(fragrances).where(eq(fragrances.slug, slug));
    const vol: Record<number, number> = {};
    for (const ml of [10, 30, 50]) {
      const [v] = await t.db
        .select({ id: volumes.id })
        .from(volumes)
        .where(and(eq(volumes.fragranceId, f!.id), eq(volumes.ml, ml)));
      vol[ml] = v!.id;
    }
    // twenty 10 ml fills of ready concentrate (ADR 0043)
    await stockBottles(t, f!.id, 10, 20);
    picked.push({ id: f!.id, name: f!.name, vol });
  }
  [A, B] = picked as [Picked, Picked];
  await t.db.update(discoverySet).set({ onHand: 5 });
});

const call = (path: string, as: StaffSession, body?: Buffer) =>
  fetch(`${t.baseUrl}/admin/uzum/import/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { cookie: as.cookie, ...(body ? { 'content-type': XLSX } : {}) },
    body: body as never,
  });
async function dryRun(file: Buffer, as = manager) {
  const res = await call('dry-run', as, file);
  expect(res.status).toBe(201);
  return (await res.json()) as UzumImportReport;
}
const apply = (file: Buffer, token: string, as = manager) => call(`apply?token=${token}`, as, file);

/** A file in the template's shape with these rows. */
async function file(rows: (string | number | null)[][], headers = HEADERS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Продажи Uzum');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/** A fragrance's ready concentrate in 10 ml fills. */
const tens = async (fragranceId: number) => (await concentrateUl(t, fragranceId)) / FILL_UL[10];

describe('the template', () => {
  it('holds the sales sheet and every fragrance with its volumes', async () => {
    const res = await call('template', manager);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const sales = wb.getWorksheet('Продажи Uzum')!;
    expect((sales.getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS);
    const names = wb
      .getWorksheet('Ароматы')!
      .getColumn(1)
      .values.slice(2)
      .map((v) => String(v));
    expect(names).toContain(A.name);
    // both Discovery sets (ADR 0042); a fragrance's 5 ml is never sold alone, so never listed
    expect(names).toEqual(
      expect.arrayContaining(['Discovery set 5 × 10 мл', 'Discovery set 5 × 5 мл']),
    );
    const rows = wb.getWorksheet('Ароматы')!.getSheetValues() as unknown[][];
    expect(rows.find((r) => r?.[1] === A.name)?.[2]).toBe('10, 30, 50');
  });
});

describe('the dry run', () => {
  it('validates every row, names the row and the column, and offers nothing to write', async () => {
    const report = await dryRun(
      await file([
        ['2026-11-18', 'UZ-1', A.name, 10, 2, 69_000, null],
        ['2026-11-18', 'UZ-1', B.name.toUpperCase(), 30, 1, '189 000', null],
        ['2026-11-18', 'UZ-2', 'Nope Parfum', 10, 1, 69_000, null],
        // a 5 ml bottle is not sold alone
        ['2026-11-18', 'UZ-3', A.name, 5, 1, 30_000, null],
        ['2026-11-25', 'UZ-4', A.name, 10, 1, 69_000, null],
        ['31.02.2026', 'UZ-5', A.name, 10, 1, 69_000, null],
        ['2026-11-18', 'UZ-6', A.name, 10, null, 69_000, null],
        ['2026-11-17', 'UZ-1', A.name, 50, 1, 249_000, null],
        ['2026-11-18', 'UZ-7', A.name, 10, 1, 69_000, '120'],
        ['2026-11-18', 'UZ-8', A.name, 10, 1, '69 000,50', null],
      ]),
    );
    expect(report.errors).toEqual([
      {
        row: 4,
        column: 'Аромат или набор',
        code: 'unknown_item',
        params: { value: 'Nope Parfum' },
      },
      { row: 5, column: 'Объём, мл', code: 'bad_ml', params: { name: A.name, value: '5' } },
      { row: 6, column: HEADERS[0], code: 'future_date', params: { value: '2026-11-25' } },
      { row: 7, column: HEADERS[0], code: 'bad_date', params: { value: '31.02.2026' } },
      { row: 8, column: 'Количество, шт.', code: 'required' },
      { row: 9, column: null, code: 'mixed_order', params: { order: 'UZ-1', first: 2 } },
      { row: 10, column: 'Комиссия Uzum, %', code: 'bad_percent', params: { value: '120' } },
      {
        row: 11,
        column: 'Цена за 1 шт., сум',
        code: 'bad_number',
        params: { min: 1, max: 100_000_000 },
      },
    ]);
    expect(report.errorTotal).toBe(8);
    expect(report.token).toBeNull();
    // the rows that are fine still group: UZ-1's two lines
    expect(report.sales).toEqual([
      {
        uzumOrder: 'UZ-1',
        soldOn: '2026-11-18',
        commissionPercent: 20.5,
        rows: [2, 3],
        units: 3,
        revenue: 327_000,
      },
    ]);
    expect(await tens(A.id)).toBe(20);
  });

  it('refuses a file whose sales the stock cannot cover', async () => {
    const report = await dryRun(
      await file([
        ['2026-11-18', 'UZ-1', A.name, 10, 15, 69_000, null],
        ['2026-11-18', 'UZ-2', A.name, 10, 6, 69_000, null],
      ]),
    );
    expect(report.errors).toEqual([
      {
        row: null,
        column: null,
        code: 'stock_short',
        params: { name: A.name, ml: 10, wanted: 21, available: 20 },
      },
    ]);
    expect(report.token).toBeNull();
  });

  it('judges two volumes of one fragrance against its one liquid, as the record does (ADR 0043)', async () => {
    // 20 × 10.3 ml = 206 ml: six 30 ml fills take 185.4 ml and leave two 10 ml fills, not three
    // (alone, the 10 ml would have twenty)
    const report = await dryRun(
      await file([
        ['2026-11-18', 'UZ-1', A.name, 30, 6, 189_000, null],
        ['2026-11-18', 'UZ-2', A.name, 10, 3, 69_000, null],
      ]),
    );
    expect(report.errors).toEqual([
      {
        row: null,
        column: null,
        code: 'stock_short',
        params: { name: A.name, ml: 10, wanted: 3, available: 2 },
      },
    ]);
    expect(report.token).toBeNull();
  });

  it('says what is wrong with a file that is not the template', async () => {
    const bad = await dryRun(Buffer.from('not a workbook'));
    expect(bad.errors).toEqual([{ row: null, column: null, code: 'not_xlsx' }]);
    const missing = await dryRun(
      await file(
        [],
        HEADERS.slice(0, 6).filter((h) => h !== 'Объём, мл'),
      ),
    );
    expect(missing.errors).toEqual([{ row: 1, column: 'Объём, мл', code: 'missing_column' }]);
  });
});

describe('applying a file', () => {
  it('records its sales, lowers on hand, and skips them when the file comes again', async () => {
    const bytes = await file([
      ['2026-11-18', 'UZ-1', A.name, 10, 2, 69_000, null],
      ['2026-11-18', 'UZ-1', B.name, 30, 1, 189_000, null],
      // a Discovery set by its bare name (the 5 × 10 ml) and by its full one, a day as Excel's
      // «ДД.ММ.ГГГГ», its own commission
      ['17.11.2026', 'UZ-2', 'Discovery set', null, 1, 299_000, '15,5'],
      ['17.11.2026', 'UZ-2', 'Discovery set 5 × 5 мл', null, 1, 99_000, '15,5'],
    ]);
    const report = await dryRun(bytes);
    expect(report).toMatchObject({ saleTotal: 2, units: 5, revenue: 725_000, skipped: 0 });
    expect(report.errors).toEqual([]);
    expect(report.token).toMatch(/^[a-f0-9]{64}$/);

    const res = await apply(bytes, report.token!);
    expect(res.status).toBe(201);
    expect((await res.json()) as UzumImportApplied).toEqual({
      recorded: 2,
      units: 5,
      revenue: 725_000,
      skipped: 0,
    });
    expect(await tens(A.id)).toBe(18);
    // 206 − 30.9 ml
    expect(await concentrateUl(t, B.id)).toBe(175_100);
    const sets = await t.db.select().from(discoverySet).orderBy(discoverySet.vialMl);
    expect(sets.map((x) => [x.vialMl, x.onHand])).toEqual([
      [5, 4],
      [10, 4],
    ]);
    const rows = await t.db.select().from(uzumSales).orderBy(uzumSales.id);
    expect(rows.map((r) => [r.uzumOrder, r.soldOn, r.commissionPercent, r.source])).toEqual([
      ['UZ-1', '2026-11-18', 20.5, 'import'],
      ['UZ-2', '2026-11-17', 15.5, 'import'],
    ]);
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'uzum.sale_recorded'));
    expect(audits.map((a) => a.payload)).toContainEqual(
      expect.objectContaining({ uzumOrder: 'UZ-1', via: 'import', rows: [2, 3] }),
    );

    // the same file again: both already recorded, nothing to write
    const again = await dryRun(bytes);
    expect(again).toMatchObject({ saleTotal: 0, skipped: 2, token: null, errors: [] });
    expect(again.warnings.map((w) => [w.row, w.code])).toEqual([
      [2, 'already_recorded'],
      [4, 'already_recorded'],
    ]);
  });

  it('writes nothing for a token of another file, and nothing for a manager-less session', async () => {
    const bytes = await file([['2026-11-18', 'UZ-1', A.name, 10, 1, 69_000, null]]);
    const other = await file([['2026-11-18', 'UZ-9', A.name, 10, 1, 69_000, null]]);
    const { token } = await dryRun(other);
    const res = await apply(bytes, token!);
    expect(res.status).toBe(409);
    expect(await tens(A.id)).toBe(20);
    const anon = await fetch(`${t.baseUrl}/admin/uzum/import/dry-run`, {
      method: 'POST',
      headers: { 'content-type': XLSX },
      body: bytes as never,
    });
    expect(anon.status).toBe(401);
  });

  it('refuses the whole file when the stock moved below it since the dry run', async () => {
    const bytes = await file([
      ['2026-11-18', 'UZ-1', B.name, 10, 1, 69_000, null],
      ['2026-11-18', 'UZ-2', A.name, 10, 5, 69_000, null],
    ]);
    const { token } = await dryRun(bytes, owner);
    await stockBottles(t, A.id, 10, 4);
    const res = await apply(bytes, token!, owner);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; report: UzumImportReport };
    expect(body.report.errors).toEqual([
      {
        row: null,
        column: null,
        code: 'stock_short',
        params: { name: A.name, ml: 10, wanted: 5, available: 4 },
      },
    ]);
    expect(await tens(B.id)).toBe(20);
    expect(await t.db.select().from(uzumSales)).toHaveLength(0);
  });
});
