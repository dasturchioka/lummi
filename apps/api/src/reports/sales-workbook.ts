import { parseLocalDate, type SalesFigures, type SalesReport } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import ExcelJS from 'exceljs';
import { MONEY, sheet } from './report-workbook';

const DAY = 'dd.mm.yyyy';
const PERCENT = '0%';
/** A row's cost or profit (#77): blank when its orders had no cost snapshot. */
const known = (n: number | null) => (n === null ? '' : n);

/**
 * The sales report as an Excel file (#42), in the admin's language: one sheet per table of the
 * page, every row (the page shows the top ten). It only lays out what `salesSummary` computed.
 * Money cells are numbers in whole so'm, days are real dates, so the owner can sum and sort.
 * Profit (#77) adds a cost and a profit column to the fragrances, Volumes and sets, and a last
 * sheet with the range's revenue, cost, profit and margin.
 */
export async function salesWorkbook(report: SalesReport, language: Language): Promise<Buffer> {
  const t = adminMessages[language].admin.reports;
  const f = t.figures;
  const wb = new ExcelJS.Workbook();
  wb.title = `${t.sales}: ${report.from} — ${report.to}`;

  const days = sheet(wb, t.byDay, [
    { header: t.day, key: 'day', width: 12, numFmt: DAY },
    { header: f.orders, key: 'orders', width: 10 },
    { header: f.itemsBeforeDiscount, key: 'itemsBeforeDiscount', width: 18, numFmt: MONEY },
    { header: f.discount, key: 'discount', width: 14, numFmt: MONEY },
    { header: f.delivery, key: 'delivery', width: 14, numFmt: MONEY },
    { header: f.refunds, key: 'refunds', width: 16, numFmt: MONEY },
    { header: f.net, key: 'net', width: 18, numFmt: MONEY },
    { header: f.averageCheck, key: 'averageCheck', width: 16, numFmt: MONEY },
  ]);
  const figures = (x: SalesFigures) => ({ ...x, averageCheck: x.averageCheck ?? '' });
  for (const d of report.days) days.addRow({ ...figures(d), day: excelDate(d.day) });
  days.addRow({ ...figures(report.totals), day: t.total }).font = { bold: true };

  const fragrances = sheet(wb, t.fragrances, [
    { header: t.excel.fragrance, key: 'name', width: 30 },
    { header: t.excel.brand, key: 'brand', width: 24 },
    { header: t.units, key: 'units', width: 10 },
    { header: t.net, key: 'net', width: 18, numFmt: MONEY },
    { header: t.excel.cost, key: 'cost', width: 16, numFmt: MONEY },
    { header: t.excel.profit, key: 'profit', width: 16, numFmt: MONEY },
  ]);
  for (const r of report.fragrances)
    fragrances.addRow({
      name: r.name[language],
      brand: r.brand ?? '',
      units: r.units,
      net: r.net,
      cost: known(r.cost),
      profit: known(r.profit),
    });

  const volumes = sheet(wb, t.volumes, [
    { header: t.excel.fragrance, key: 'name', width: 30 },
    { header: t.excel.brand, key: 'brand', width: 24 },
    { header: t.excel.ml, key: 'ml', width: 10 },
    { header: t.units, key: 'units', width: 10 },
    { header: t.net, key: 'net', width: 18, numFmt: MONEY },
    { header: t.excel.cost, key: 'cost', width: 16, numFmt: MONEY },
    { header: t.excel.profit, key: 'profit', width: 16, numFmt: MONEY },
  ]);
  for (const r of report.volumes)
    volumes.addRow({
      name: r.name[language],
      brand: r.brand ?? '',
      ml: r.ml,
      units: r.units,
      net: r.net,
      cost: known(r.cost),
      profit: known(r.profit),
    });

  const sets = sheet(wb, t.sets, [
    { header: t.excel.set, key: 'kind', width: 22 },
    { header: t.units, key: 'units', width: 10 },
    { header: t.net, key: 'net', width: 18, numFmt: MONEY },
    { header: t.excel.cost, key: 'cost', width: 16, numFmt: MONEY },
    { header: t.excel.profit, key: 'profit', width: 16, numFmt: MONEY },
  ]);
  for (const r of report.sets)
    sets.addRow({
      kind: t.setKinds[r.kind],
      units: r.units,
      net: r.net,
      cost: known(r.cost),
      profit: known(r.profit),
    });

  const p = report.profit;
  const profit = sheet(wb, t.excel.profitSheet, [
    { header: t.excel.orders, key: 'orders', width: 14 },
    { header: t.excel.uncosted, key: 'uncosted', width: 16 },
    { header: t.profit.revenue, key: 'revenue', width: 18, numFmt: MONEY },
    { header: t.profit.cost, key: 'cost', width: 18, numFmt: MONEY },
    { header: t.profit.profit, key: 'profit', width: 18, numFmt: MONEY },
    { header: t.excel.margin, key: 'margin', width: 10, numFmt: PERCENT },
  ]);
  profit.addRow({ ...p, margin: known(p.margin) });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A Tashkent day as an Excel date: the calendar day itself, no time and no zone. */
function excelDate(day: string): Date {
  const { year, month, day: d } = parseLocalDate(day);
  return new Date(Date.UTC(year, month - 1, d));
}
