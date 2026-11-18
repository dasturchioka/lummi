import type { ProfitabilityTable } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { fill } from '@lummi/i18n';
import ExcelJS from 'exceljs';
import { MONEY, sheet } from '../reports/report-workbook';

const PERCENT = '0%';

/**
 * The «Рентабельность» table as an Excel file (#77), in the admin's language: every row the page
 * has, with the channel and toggles the page had, sorted by name as the API lists them. It only
 * lays out what `Profitability.table` computed; money is whole so'm, the margin a real percent.
 */
export async function profitabilityWorkbook(
  table: ProfitabilityTable,
  language: Language,
): Promise<Buffer> {
  const t = adminMessages[language].admin.profitability;
  const wb = new ExcelJS.Workbook();
  const conditions = [
    t.channels[table.channel],
    ...(table.afterSetDiscount
      ? [fill(t.afterSetDiscount, { percent: String(table.afterSetDiscountPercent) })]
      : []),
    ...(table.giftSample ? [t.giftSample] : []),
  ];
  wb.title = `${t.title}: ${conditions.join(', ')}`;
  const ws = sheet(wb, t.excel.sheet[table.channel], [
    { header: t.columns.name, key: 'name', width: 32 },
    { header: t.excel.brand, key: 'brand', width: 24 },
    { header: t.excel.ml, key: 'ml', width: 10 },
    { header: t.columns.price, key: 'price', width: 14, numFmt: MONEY },
    { header: t.excel.discount, key: 'discount', width: 12, numFmt: MONEY },
    { header: t.columns.cost, key: 'unitCost', width: 16, numFmt: MONEY },
    { header: t.columns.orderCosts, key: 'orderCosts', width: 18, numFmt: MONEY },
    { header: t.columns.profit, key: 'profit', width: 14, numFmt: MONEY },
    { header: t.columns.margin, key: 'margin', width: 10, numFmt: PERCENT },
    { header: t.excel.flag, key: 'flag', width: 16 },
    { header: t.excel.hidden, key: 'hidden', width: 10 },
  ]);
  const blank = (n: number | null) => (n === null ? '' : n);
  for (const r of table.rows) {
    ws.addRow({
      name: r.kind === 'discovery_set' ? t.discoverySetFull : r.name,
      brand: r.brand ?? '',
      ml: r.ml,
      price: r.price,
      discount: r.discount,
      unitCost: blank(r.unitCost),
      orderCosts: blank(r.orderCosts),
      profit: blank(r.profit),
      margin: blank(r.margin),
      flag:
        r.flag === 'loss'
          ? t.flags.loss
          : r.flag === 'low'
            ? fill(t.flags.low, { percent: String(table.lowMarginPercent) })
            : r.unitCost === null
              ? t.noOil
              : '',
      hidden: r.hidden ? t.excel.yes : '',
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
