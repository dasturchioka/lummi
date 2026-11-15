import type ExcelJS from 'exceljs';

/** Whole so'm with a thousands separator. */
export const MONEY = '#,##0';

export type Column = { header: string; key: string; width: number; numFmt?: string };

/** A sheet with its columns, a bold header row frozen at the top. */
export function sheet(wb: ExcelJS.Workbook, name: string, columns: Column[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(({ numFmt, ...c }) => ({ ...c, style: numFmt ? { numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}
