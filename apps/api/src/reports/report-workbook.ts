import { utcToTashkent } from '@lummi/contracts';
import type ExcelJS from 'exceljs';

/** An instant as the Tashkent wall clock in an Excel date cell (Excel dates carry no zone). */
export function tashkentWallClock(instant: Date): Date {
  const t = utcToTashkent(instant);
  return new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
}

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
