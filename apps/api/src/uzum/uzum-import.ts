import {
  MAX_PRICE,
  UZUM_ORDER_MAX,
  UZUM_SALE_LINES_MAX,
  UZUM_SALE_QTY_MAX,
  UZUM_SHEETS,
  tashkentDaySchema,
  type UzumImportIssue,
  type UzumImportSale,
  type UzumSaleLineInput,
} from '@lummi/contracts';
import ExcelJS from 'exceljs';
import { cellText, type ColumnDef } from '../catalog-import/workbook';

/**
 * `LUMMI_Uzum.xlsx` (#80): Uzum sales from a file. Uzum's own seller export is not known to us yet
 * (docs/open-questions.md), so this is our template: one row per line, the rows of one Uzum order
 * grouped into one sale. One place defines the columns, the template and the reading.
 */

export const UZUM_COLUMNS = [
  { key: 'soldOn', header: 'Дата продажи (ГГГГ-ММ-ДД)', width: 22 },
  { key: 'uzumOrder', header: 'Номер заказа Uzum', width: 20 },
  { key: 'item', header: 'Аромат или набор', width: 30 },
  { key: 'ml', header: 'Объём, мл', width: 12 },
  { key: 'qty', header: 'Количество, шт.', width: 16 },
  { key: 'price', header: 'Цена за 1 шт., сум', width: 18 },
  // empty: the setting `cost.order.uzumCommissionPercent`
  { key: 'commission', header: 'Комиссия Uzum, %', width: 18, optional: true },
] as const satisfies readonly ColumnDef<string>[];
type UzumKey = (typeof UZUM_COLUMNS)[number]['key'];
const header = (key: UzumKey) => UZUM_COLUMNS.find((c) => c.key === key)!.header;

/** What the template's second sheet lists, and what a row's «Аромат или набор» is read against. */
export interface UzumCatalogFragrance {
  id: number;
  name: string;
  code: string;
  hidden: boolean;
  volumes: { id: number; ml: number }[];
}

/** The Discovery set as a file names it: «Discovery set», «Discovery», «Набор Discovery». */
export const DISCOVERY_NAME = 'Discovery set';
const isDiscovery = (folded: string) =>
  /^(набор\s+)?discovery(\s+(set|набор|to'plami?))?$/.test(folded);

/** Case, spaces and apostrophe spellings never make two names differ. */
const fold = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘ʻʼ`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFCFC6B8' },
};

/** The template: the sales sheet with its headers, and every fragrance with its volumes to copy from. */
export async function writeUzumTemplate(catalog: readonly UzumCatalogFragrance[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LUMMI.';
  const ws = wb.addWorksheet(UZUM_SHEETS.sales, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = UZUM_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  // the order number and the date are text: Excel must not turn «00123» into 123
  ws.getColumn(1).numFmt = '@';
  ws.getColumn(2).numFmt = '@';
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.eachCell((cell) => (cell.fill = HEADER_FILL));

  const items = wb.addWorksheet(UZUM_SHEETS.items, { views: [{ state: 'frozen', ySplit: 1 }] });
  items.columns = [
    { header: header('item'), key: 'name', width: 34 },
    { header: header('ml'), key: 'ml', width: 16 },
  ];
  items.getRow(1).font = { bold: true };
  items.getRow(1).eachCell((cell) => (cell.fill = HEADER_FILL));
  for (const f of [...catalog].sort((a, b) => a.name.localeCompare(b.name)))
    items.addRow([f.name, f.volumes.map((v) => v.ml).join(', ')]);
  items.addRow([DISCOVERY_NAME, null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface UzumRawRow {
  row: number;
  cells: Record<UzumKey, string>;
}

/** Reads the sales sheet into raw cell text. Throws if the bytes are not a workbook. */
export async function readUzumWorkbook(
  bytes: Buffer,
  maxRows: number,
): Promise<{ rows: UzumRawRow[]; issues: UzumImportIssue[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const issues: UzumImportIssue[] = [];
  const ws = wb.getWorksheet(UZUM_SHEETS.sales);
  if (!ws) {
    issues.push({
      row: null,
      column: null,
      code: 'missing_sheet',
      params: { name: UZUM_SHEETS.sales },
    });
    return { rows: [], issues };
  }
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, n) => {
    const t = fold(cellText(cell).text);
    if (t && !headers.has(t)) headers.set(t, n);
  });
  const found = new Map<UzumKey, number>();
  for (const c of UZUM_COLUMNS) {
    const n = headers.get(fold(c.header));
    if (n !== undefined) found.set(c.key, n);
    else if (!('optional' in c && c.optional))
      issues.push({ row: 1, column: c.header, code: 'missing_column' });
  }
  if (issues.length) return { rows: [], issues };
  if (ws.rowCount - 1 > maxRows) {
    issues.push({ row: null, column: null, code: 'too_many_rows', params: { max: maxRows } });
    return { rows: [], issues };
  }
  const rows: UzumRawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = {} as Record<UzumKey, string>;
    for (const c of UZUM_COLUMNS) {
      const at = found.get(c.key);
      if (at === undefined) {
        cells[c.key] = '';
        continue;
      }
      const { text, bad } = cellText(row.getCell(at));
      if (bad) issues.push({ row: r, column: c.header, code: bad });
      cells[c.key] = text;
    }
    if (Object.values(cells).every((v) => v === '')) continue;
    rows.push({ row: r, cells });
  }
  return { rows, issues };
}

/** A sale the plan will record: the writer's input plus the rows it came from. */
export interface PlannedUzumSale {
  soldOn: string;
  uzumOrder: string;
  /** Null: the setting. */
  commissionPercent: number | null;
  rows: number[];
  lines: UzumSaleLineInput[];
}

export interface UzumPlan {
  /** To record (already recorded ones are left out). */
  sales: PlannedUzumSale[];
  /** Orders the file holds that a standing sale already has. */
  skipped: number;
  errors: UzumImportIssue[];
  warnings: UzumImportIssue[];
}

/** A whole number from a cell: «69 000», «69000», «69000.00»; null when it is not one. */
function wholeNumber(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(/,00$|\.00?$/, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** A percent from a cell: «20,5», «20.5», «20.5 %»; null when it is not one from 0 to 100 with two decimals at most. */
function percent(text: string): number | null {
  const t = text.replace(/[\s%]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= 100 ? n : null;
}

/** A day as `YYYY-MM-DD` from «2026-11-18» or «18.11.2026»; null when it is no calendar day. */
function day(text: string): string | null {
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const iso = dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : text;
  return tashkentDaySchema.safeParse(iso).success ? iso : null;
}

/**
 * Checks every row and groups the rows by Uzum order number into sales. A row is one line; the
 * rows of one order must agree on the day and the commission. An order a standing sale already
 * has is skipped with a warning, so a file can be imported again as it grows. Pure.
 */
export function planUzumImport(
  rows: readonly UzumRawRow[],
  catalog: readonly UzumCatalogFragrance[],
  ctx: { today: string; standing: ReadonlySet<string> },
): UzumPlan {
  const errors: UzumImportIssue[] = [];
  const warnings: UzumImportIssue[] = [];
  const byName = new Map<string, UzumCatalogFragrance>();
  for (const f of catalog) {
    byName.set(fold(f.name), f);
    byName.set(fold(f.code), f);
  }
  const issue = (
    row: number,
    key: UzumKey,
    code: UzumImportIssue['code'],
    params?: UzumImportIssue['params'],
  ) => errors.push({ row, column: header(key), code, ...(params ? { params } : {}) });

  const groups = new Map<string, PlannedUzumSale>();
  for (const { row, cells } of rows) {
    const before = errors.length;
    const required = (key: UzumKey) => {
      if (cells[key] !== '') return true;
      issue(row, key, 'required');
      return false;
    };

    let soldOn: string | null = null;
    if (required('soldOn')) {
      soldOn = day(cells.soldOn);
      if (!soldOn) issue(row, 'soldOn', 'bad_date', { value: cells.soldOn });
      else if (soldOn > ctx.today) issue(row, 'soldOn', 'future_date', { value: soldOn });
    }
    const uzumOrder = cells.uzumOrder;
    if (required('uzumOrder') && uzumOrder.length > UZUM_ORDER_MAX)
      issue(row, 'uzumOrder', 'too_long', { max: UZUM_ORDER_MAX });

    let line: UzumSaleLineInput | null = null;
    const qty = cells.qty === '' ? null : wholeNumber(cells.qty);
    if (required('qty') && (qty === null || qty < 1 || qty > UZUM_SALE_QTY_MAX))
      issue(row, 'qty', 'bad_number', { min: 1, max: UZUM_SALE_QTY_MAX });
    const price = cells.price === '' ? null : wholeNumber(cells.price);
    if (required('price') && (price === null || price < 1 || price > MAX_PRICE))
      issue(row, 'price', 'bad_number', { min: 1, max: MAX_PRICE });
    if (required('item')) {
      const name = fold(cells.item);
      if (isDiscovery(name)) {
        line = { kind: 'discovery_set', qty: qty ?? 1, price: price ?? 1 };
      } else {
        const f = byName.get(name);
        if (!f) issue(row, 'item', 'unknown_item', { value: cells.item });
        else if (required('ml')) {
          const ml = wholeNumber(cells.ml);
          const v = f.volumes.find((x) => x.ml === ml);
          if (!v) issue(row, 'ml', 'bad_ml', { name: f.name, value: cells.ml });
          else line = { kind: 'volume', volumeId: v.id, qty: qty ?? 1, price: price ?? 1 };
        }
      }
    }
    let commission: number | null = null;
    if (cells.commission !== '') {
      commission = percent(cells.commission);
      if (commission === null) issue(row, 'commission', 'bad_percent', { value: cells.commission });
    }
    if (errors.length > before || !line || !soldOn) continue;

    const sale = groups.get(uzumOrder);
    if (!sale) {
      groups.set(uzumOrder, {
        soldOn,
        uzumOrder,
        commissionPercent: commission,
        rows: [row],
        lines: [line],
      });
      continue;
    }
    if (sale.soldOn !== soldOn || sale.commissionPercent !== commission) {
      errors.push({
        row,
        column: null,
        code: 'mixed_order',
        params: { order: uzumOrder, first: sale.rows[0]! },
      });
      continue;
    }
    sale.rows.push(row);
    sale.lines.push(line);
    if (sale.lines.length === UZUM_SALE_LINES_MAX + 1)
      errors.push({
        row,
        column: null,
        code: 'too_many_lines',
        params: { order: uzumOrder, max: UZUM_SALE_LINES_MAX },
      });
  }

  let skipped = 0;
  const sales: PlannedUzumSale[] = [];
  for (const s of groups.values()) {
    if (ctx.standing.has(s.uzumOrder)) {
      skipped += 1;
      warnings.push({
        row: s.rows[0]!,
        column: header('uzumOrder'),
        code: 'already_recorded',
        params: { order: s.uzumOrder },
      });
    } else sales.push(s);
  }
  return { sales, skipped, errors, warnings };
}

/** The report's view of a planned sale. */
export function saleSummary(s: PlannedUzumSale, defaultCommission: number): UzumImportSale {
  return {
    uzumOrder: s.uzumOrder,
    soldOn: s.soldOn,
    commissionPercent: s.commissionPercent ?? defaultCommission,
    rows: s.rows,
    units: s.lines.reduce((sum, l) => sum + l.qty, 0),
    revenue: s.lines.reduce((sum, l) => sum + l.qty * l.price, 0),
  };
}
