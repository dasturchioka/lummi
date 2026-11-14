import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SalesReport } from '@lummi/contracts';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import {
  EXPECTED_DAYS,
  EXPECTED_FRAGRANCES,
  EXPECTED_SETS,
  EXPECTED_TOTALS,
  EXPECTED_VOLUMES,
  placeTwentyOrders,
  RANGE,
  type FixtureCatalog,
} from './fixtures/sales-report-orders';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

/**
 * The TZ §10 acceptance gate (ADR 0028): «цифры отчёта совпадают с ручным расчётом» over 20 test
 * orders. The orders go through the real doors (checkout, payment, fulfilment, cancel, return,
 * refund); the expected figures are the hand calculation in `fixtures/sales-report-orders.ts`.
 * Any mismatch fails CI.
 */

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
let catalog: FixtureCatalog;
let owner: StaffSession;

beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  await seedCatalog(t.db, { materialsDir });
  await importBtsPoints(t.db, snapshot);
  ({ catalog } = await placeTwentyOrders(t));
  owner = await t.ownerSession();
}, 300_000);
afterAll(() => t?.close());

async function report(query: { from: string; to: string }): Promise<SalesReport> {
  const res = await owner.client.admin.reports.sales({ query });
  if (res.status !== 200) throw new Error(`report ${res.status}`);
  return res.body;
}

describe('the 20-order report gate (TZ §10)', () => {
  it('matches the hand calculation day by day and over the range', async () => {
    const r = await report(RANGE);
    expect(r.days).toEqual(EXPECTED_DAYS);
    expect(r.totals).toEqual(EXPECTED_TOTALS);
  });

  it('matches it for the top fragrances, Volumes and sets', async () => {
    const r = await report(RANGE);
    expect(
      r.fragrances.map(({ fragranceId, units, net }) => ({ fragranceId, units, net })),
    ).toEqual(
      EXPECTED_FRAGRANCES.map(({ f, units, net }) => ({
        fragranceId: catalog.fragranceId[f],
        units,
        net,
      })),
    );
    expect(
      r.volumes.map(({ volumeId, fragranceId, ml, units, net }) => ({
        volumeId,
        fragranceId,
        ml,
        units,
        net,
      })),
    ).toEqual(
      EXPECTED_VOLUMES.map(({ f, ml, units, net }) => ({
        volumeId: catalog.volumeId[`${f}${ml}`],
        fragranceId: catalog.fragranceId[f],
        ml,
        units,
        net,
      })),
    );
    expect(r.sets).toEqual(EXPECTED_SETS);
  });

  it('counts an order on its delivery day, so the days around the range hold the rest', async () => {
    // order 1 (delivered 9 Nov): C30 120 000 + B10 60 000, delivery 25 000; its refund is 11 Nov
    expect((await report({ from: '2026-11-09', to: '2026-11-09' })).totals).toEqual({
      orders: 1,
      itemsBeforeDiscount: 180_000,
      discount: 0,
      delivery: 25_000,
      refunds: 0,
      net: 180_000,
      averageCheck: 180_000,
    });
    // order 19 (delivered 15 Nov): C10 50 000, delivery 25 000
    expect((await report({ from: '2026-11-15', to: '2026-11-15' })).totals).toEqual({
      orders: 1,
      itemsBeforeDiscount: 50_000,
      discount: 0,
      delivery: 25_000,
      refunds: 0,
      net: 50_000,
      averageCheck: 50_000,
    });
  });

  it('exports the same figures to Excel', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/sales/export?from=${RANGE.from}&to=${RANGE.to}`,
      { headers: { cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const [days, fragrances, volumes, sets] = wb.worksheets;
    expect(wb.worksheets.map((s) => s.name)).toEqual(['По дням', 'Ароматы', 'Объёмы', 'Наборы']);
    const rows = (ws: ExcelJS.Worksheet) =>
      ws
        .getSheetValues()
        .slice(2)
        .map((row) => (row as unknown[]).slice(1));
    const day = (d: string) => new Date(`${d}T00:00:00Z`);
    const figures = (e: (typeof EXPECTED_DAYS)[number] | typeof EXPECTED_TOTALS) => [
      e.orders,
      e.itemsBeforeDiscount,
      e.discount,
      e.delivery,
      e.refunds,
      e.net,
      e.averageCheck ?? '',
    ];
    expect(days!.getRow(1).values).toEqual([
      undefined,
      'День',
      'Заказов',
      'Товары до скидки',
      'Скидки',
      'Доставка',
      'Возвраты денег',
      'Чистые продажи',
      'Средний чек',
    ]);
    expect(rows(days!)).toEqual([
      ...EXPECTED_DAYS.map((e) => [day(e.day), ...figures(e)]),
      ['Итого', ...figures(EXPECTED_TOTALS)],
    ]);
    expect(rows(fragrances!).map((r) => r.slice(2))).toEqual(
      EXPECTED_FRAGRANCES.map((e) => [e.units, e.net]),
    );
    expect(rows(volumes!).map((r) => r.slice(2))).toEqual(
      EXPECTED_VOLUMES.map((e) => [e.ml, e.units, e.net]),
    );
    expect(rows(sets!)).toEqual([
      ['Discovery set', 2, 557_143],
      ['Свой набор', 3, 840_000],
    ]);
  });

  it('writes the Excel headers in Uzbek when asked', async () => {
    const res = await fetch(
      `${t.baseUrl}/admin/reports/sales/export?from=${RANGE.from}&to=${RANGE.to}&lang=uz`,
      { headers: { cookie: owner.cookie } },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual([
      'Kunlar boʻyicha',
      'Atirlar',
      'Hajmlar',
      'Toʻplamlar',
    ]);
    expect(wb.worksheets[0]!.getRow(1).getCell(7).value).toBe('Sof savdo');
  });
});
