import type { PurchasePlan } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import ExcelJS from 'exceljs';
import { MONEY, sheet } from '../reports/report-workbook';

/**
 * The purchase plan as an Excel file (#78), in the admin's language: the figures of the page on
 * one sheet and the per-fragrance table on another. It only lays out what `planPurchase`
 * computed. Money cells are numbers in whole so'm, so the owner can sum and sort.
 */
export async function purchasePlanWorkbook(
  plan: PurchasePlan,
  language: Language,
): Promise<Buffer> {
  const t = adminMessages[language].admin.purchase;
  const wb = new ExcelJS.Workbook();
  wb.title = t.title;

  const figures = sheet(wb, t.sheet, [
    { header: t.figure, key: 'label', width: 56 },
    { header: t.value, key: 'value', width: 20, numFmt: MONEY },
  ]);
  const row = (label: string, value: number | string, numFmt?: string) => {
    const r = figures.addRow({ label, value });
    if (numFmt) r.getCell('value').numFmt = numFmt;
  };
  const percent = '0.0%';
  row(t.defaultKg, plan.inputs.oilKgPerFragrance, '0.###');
  row(t.oil, plan.investment.oil);
  row(t.ethanol, plan.investment.ethanol);
  row(t.liquidTotal, plan.investment.total);
  row(`${t.perfume}, ml`, plan.liquid.perfumeMl);
  row(
    `${t.giftLiquid.replace('{count}', String(plan.inputs.giftSampleCount)).replace('{ml}', String(plan.inputs.giftSampleMl))}, ml`,
    plan.liquid.giftMl,
  );
  row(t.bottles10, plan.bottles.ml10, '#,##0');
  row(t.bottles30, plan.bottles.ml30, '#,##0');
  row(t.bottles50, plan.bottles.ml50, '#,##0');
  row(t.bottlesTotal, plan.bottles.total, '#,##0');
  row(t.revenueFull, plan.revenue.full);
  row(
    t.discount.replace('{percent}', String(plan.inputs.avgDiscountPercent)),
    -plan.revenue.discount,
  );
  row(t.revenueNet, plan.revenue.net);
  row(t.giftCost, -plan.gift.total);
  row(t.profit, plan.profit);
  row(t.margin, plan.margin ?? '', percent);
  row(t.soldBottles, plan.year.soldBottles, '#,##0');
  row(t.yearRevenue, plan.year.revenue);
  row(t.yearProfit, plan.year.profit);
  row(t.fixedCosts.replace('{month}', String(plan.inputs.fixedPerMonth)), -plan.year.fixedCosts);
  row(t.yearNet, plan.year.net);
  row(`${t.yearNet}, ${t.perMonth}`, plan.year.netPerMonth);
  row(t.stockAtCost, plan.year.stockAtCost);
  row(t.paybackUnits, plan.payback.units ?? t.neverPaysBack, '#,##0');
  row(t.paybackShare, plan.payback.share ?? '', percent);

  const table = sheet(wb, t.sheetTable, [
    { header: t.fragrance, key: 'name', width: 34 },
    { header: t.brand, key: 'brand', width: 24 },
    { header: t.oilKg, key: 'oilKg', width: 12, numFmt: '0.###' },
    { header: t.oilCost, key: 'oilCost', width: 16, numFmt: MONEY },
    { header: t.bottles, key: 'bottles', width: 12, numFmt: '#,##0' },
    { header: t.revenue, key: 'revenue', width: 16, numFmt: MONEY },
    { header: t.rowProfit, key: 'profit', width: 16, numFmt: MONEY },
  ]);
  for (const r of plan.rows) table.addRow(r);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
