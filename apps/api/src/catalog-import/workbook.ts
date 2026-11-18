import { CATALOG_SHEETS, type FragranceTier, type ImportIssue } from '@lummi/contracts';
import { normalizeUzbek } from '@lummi/i18n';
import ExcelJS from 'exceljs';

/**
 * `LUMMI_Katalog.xlsx`: the template of the catalog import and export (spec Changes 2026-11-07).
 * Three sheets, RU headers; one place defines the columns, the value labels and both directions
 * (read a file, write the catalog), so an export always re-imports as zero changes.
 */

/**
 * `optional`: a file without the column still imports and leaves the stored value as it is (the
 * cost columns of #75, so a file made from an older template keeps working).
 */
export type ColumnDef<K extends string> = {
  key: K;
  header: string;
  width: number;
  optional?: true;
};

export const FRAGRANCE_COLUMNS = [
  { key: 'code', header: 'Внутренний код', width: 12 },
  { key: 'name', header: 'Название', width: 24 },
  { key: 'originalBrand', header: 'Оригинальный бренд', width: 24 },
  { key: 'type', header: 'Тип', width: 12 },
  { key: 'family', header: 'Семейство', width: 24 },
  { key: 'season', header: 'Сезон', width: 14 },
  { key: 'timeOfDay', header: 'Время суток', width: 16 },
  { key: 'longevityRu', header: 'Стойкость RU', width: 16 },
  { key: 'longevityUz', header: 'Стойкость UZ', width: 16 },
  { key: 'sillage', header: 'Шлейф', width: 12 },
  { key: 'descriptionRu', header: 'Описание RU', width: 48 },
  { key: 'descriptionUz', header: 'Описание UZ', width: 48 },
  { key: 'whenToWearRu', header: 'Когда носить RU', width: 40 },
  { key: 'whenToWearUz', header: 'Когда носить UZ', width: 40 },
  { key: 'keyNotesRu', header: 'Ключевые ноты RU', width: 30 },
  { key: 'keyNotesUz', header: 'Ключевые ноты UZ', width: 30 },
  { key: 'topNotes', header: 'Верхние ноты', width: 30 },
  { key: 'heartNotes', header: 'Ноты сердца', width: 30 },
  { key: 'baseNotes', header: 'Базовые ноты', width: 30 },
  { key: 'similar', header: 'Похожие (коды)', width: 20 },
  { key: 'internalRemark', header: 'Внутренняя заметка', width: 30 },
  { key: 'aliases', header: 'Псевдонимы', width: 30 },
  { key: 'uzumUrl', header: 'Ссылка Uzum', width: 30 },
  { key: 'isHit', header: 'Хит', width: 8 },
  { key: 'isNew', header: 'Новинка', width: 10 },
  { key: 'hidden', header: 'Скрыт', width: 8 },
  // the cost model (ADR 0040): admin only, never in the Mini App
  { key: 'oilPrice', header: 'Масло, сум за 1 г (до скидки)', width: 18, optional: true },
  { key: 'tier', header: 'Категория масла', width: 16, optional: true },
  { key: 'oilSupplier', header: 'Поставщик масла', width: 22, optional: true },
  { key: 'oilInvoice', header: 'Накладная на масло', width: 24, optional: true },
] as const satisfies readonly ColumnDef<string>[];
export type FragranceKey = (typeof FRAGRANCE_COLUMNS)[number]['key'];
/** The columns a file may leave out (`ColumnDef.optional`). */
export const OPTIONAL_FRAGRANCE_KEYS = FRAGRANCE_COLUMNS.flatMap((c) =>
  'optional' in c && c.optional ? [c.key] : [],
);

export const VOLUME_COLUMNS = [
  { key: 'code', header: 'Внутренний код', width: 14 },
  { key: 'ml', header: 'Объём, мл', width: 12 },
  { key: 'price', header: 'Цена, сум', width: 14 },
  { key: 'salePrice', header: 'Цена со скидкой, сум', width: 22 },
  { key: 'saleEndsOn', header: 'Скидка до (ГГГГ-ММ-ДД)', width: 24 },
  { key: 'onHand', header: 'В наличии, шт.', width: 16 },
] as const satisfies readonly ColumnDef<string>[];
export type VolumeKey = (typeof VOLUME_COLUMNS)[number]['key'];

export const DICTIONARY_COLUMNS = [
  { key: 'familyRu', header: 'Семейство RU', width: 28 },
  { key: 'familyUz', header: 'Семейство UZ', width: 28 },
  { key: 'gap', header: '', width: 4 },
  { key: 'noteRu', header: 'Нота RU', width: 24 },
  { key: 'noteUz', header: 'Нота UZ', width: 24 },
] as const satisfies readonly ColumnDef<string>[];
export type DictionaryKey = (typeof DICTIONARY_COLUMNS)[number]['key'];

export const headerOf = (cols: readonly ColumnDef<string>[], key: string) =>
  cols.find((c) => c.key === key)?.header ?? key;

/** What staff read in the file for each stored value; the import also accepts the stored code. */
export const LABELS = {
  type: { homme: 'Мужской', femme: 'Женский', unisex: 'Унисекс' },
  sillage: { medium: 'Средний', noticeable: 'Заметный', strong: 'Сильный' },
  season: {
    spring_summer: 'Весна–лето',
    autumn_winter: 'Осень–зима',
    all_year: 'Круглый год',
    spring_autumn: 'Весна–осень',
  },
  timeOfDay: {
    day: 'Днём',
    evening: 'Вечер',
    day_evening: 'День и вечер',
    everyday: 'На каждый день',
  },
  tier: { top: 'TOP', premium: 'PREMIUM', premium_new: 'PREMIUM NEW' },
} as const satisfies Record<string, Record<string, string>> & {
  tier: Record<FragranceTier, string>;
};
export const YES = 'да';
export const NO = 'нет';

const dashes = (s: string) => s.replace(/[-‐‑‒—−]/g, '–');
const fold = (s: string) => dashes(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** The stored value of an enum cell: the label, case-insensitively, or the stored code itself. */
export function parseLabel<K extends keyof typeof LABELS>(
  field: K,
  text: string,
): keyof (typeof LABELS)[K] | null {
  const map = LABELS[field] as Record<string, string>;
  const t = fold(text);
  for (const [code, label] of Object.entries(map)) {
    if (t === fold(label) || t === code) return code as keyof (typeof LABELS)[K];
  }
  return null;
}
export const labelsOf = (field: keyof typeof LABELS) => Object.values(LABELS[field]) as string[];

export function parseYesNo(text: string): boolean | null {
  // every apostrophe spelling of yoʻq (yo'q, yo`q, yo’q …) reads the same
  const t = normalizeUzbek(text.trim().toLowerCase());
  if (t === '') return false;
  if (['да', 'yes', 'ha', 'true', '1', 'x', '✓', '+'].includes(t)) return true;
  if (['нет', 'no', normalizeUzbek("yo'q"), 'yoq', 'false', '0', '-'].includes(t)) return false;
  return null;
}

export const splitList = (text: string, sep: RegExp): string[] =>
  text
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
export const KEY_NOTE_SEP = ' · ';

// ---- the data a workbook carries ----

export interface FragranceDraft {
  code: string;
  name: string;
  originalBrand: string;
  type: keyof typeof LABELS.type;
  /** Family RU name (the dictionary key), or null. */
  family: string | null;
  season: keyof typeof LABELS.season;
  timeOfDay: keyof typeof LABELS.timeOfDay;
  sillage: keyof typeof LABELS.sillage;
  longevityRu: string;
  longevityUz: string;
  descriptionRu: string;
  descriptionUz: string;
  whenToWearRu: string;
  whenToWearUz: string;
  keyNotesRu: string[];
  keyNotesUz: string[];
  /** Note RU names per level, in order. */
  topNotes: string[];
  heartNotes: string[];
  baseNotes: string[];
  /** Internal codes of the curated similar fragrances, in order. */
  similar: string[];
  internalRemark: string;
  aliases: string[];
  uzumUrl: string;
  isHit: boolean;
  isNew: boolean;
  hidden: boolean;
  /** So'm per gram before the supplier discount; null: not known. */
  oilPrice: number | null;
  tier: FragranceTier | null;
  /** '' for none, like `internalRemark`. */
  oilSupplier: string;
  oilInvoice: string;
}
export interface VolumeDraft {
  ml: 10 | 30 | 50;
  price: number;
  salePrice: number | null;
  /** Tashkent calendar day `YYYY-MM-DD`. */
  saleEndsOn: string | null;
  onHand: number;
}
export interface DictionaryDraft {
  nameRu: string;
  nameUz: string;
}
export interface CatalogData {
  families: DictionaryDraft[];
  notes: DictionaryDraft[];
  fragrances: { draft: FragranceDraft; volumes: VolumeDraft[] }[];
}

// ---- writing ----

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFCFC6B8' },
};

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: readonly ColumnDef<string>[],
  rows: (string | number | null)[][],
) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.eachCell((cell) => (cell.fill = HEADER_FILL));
  for (const r of rows) ws.addRow(r);
  return ws;
}

function listValidation(ws: ExcelJS.Worksheet, col: number, options: string[], rows = 1000) {
  const formula = `"${options.join(',')}"`;
  for (let r = 2; r <= rows; r++) {
    ws.getCell(r, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
    };
  }
}

export async function writeWorkbook(data: CatalogData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LUMMI.';
  const fragranceRows = data.fragrances.map(({ draft: d }) => [
    d.code,
    d.name,
    d.originalBrand,
    LABELS.type[d.type],
    d.family,
    LABELS.season[d.season],
    LABELS.timeOfDay[d.timeOfDay],
    d.longevityRu,
    d.longevityUz,
    LABELS.sillage[d.sillage],
    d.descriptionRu,
    d.descriptionUz,
    d.whenToWearRu,
    d.whenToWearUz,
    d.keyNotesRu.join(KEY_NOTE_SEP),
    d.keyNotesUz.join(KEY_NOTE_SEP),
    d.topNotes.join(', '),
    d.heartNotes.join(', '),
    d.baseNotes.join(', '),
    d.similar.join(', '),
    d.internalRemark || null,
    d.aliases.join(', ') || null,
    d.uzumUrl || null,
    d.isHit ? YES : NO,
    d.isNew ? YES : NO,
    d.hidden ? YES : NO,
    d.oilPrice,
    d.tier ? LABELS.tier[d.tier] : null,
    d.oilSupplier || null,
    d.oilInvoice || null,
  ]);
  const fs = addSheet(wb, CATALOG_SHEETS.fragrances, FRAGRANCE_COLUMNS, fragranceRows);
  // The code is text: Excel must not turn «007» into 7 (the import also accepts 7).
  fs.getColumn(1).numFmt = '@';
  const col = (key: FragranceKey) => FRAGRANCE_COLUMNS.findIndex((c) => c.key === key) + 1;
  listValidation(fs, col('type'), labelsOf('type'));
  listValidation(fs, col('season'), labelsOf('season'));
  listValidation(fs, col('timeOfDay'), labelsOf('timeOfDay'));
  listValidation(fs, col('sillage'), labelsOf('sillage'));
  for (const k of ['isHit', 'isNew', 'hidden'] as const) listValidation(fs, col(k), [YES, NO]);
  listValidation(fs, col('tier'), labelsOf('tier'));

  const volumeRows = data.fragrances.flatMap(({ draft, volumes }) =>
    volumes.map((v) => [draft.code, v.ml, v.price, v.salePrice, v.saleEndsOn, v.onHand]),
  );
  const vs = addSheet(wb, CATALOG_SHEETS.volumes, VOLUME_COLUMNS, volumeRows);
  vs.getColumn(1).numFmt = '@';
  vs.getColumn(5).numFmt = '@';
  listValidation(vs, 2, ['10', '30', '50']);

  const n = Math.max(data.families.length, data.notes.length);
  const dictRows = Array.from({ length: n }, (_, i) => [
    data.families[i]?.nameRu ?? null,
    data.families[i]?.nameUz ?? null,
    null,
    data.notes[i]?.nameRu ?? null,
    data.notes[i]?.nameUz ?? null,
  ]);
  addSheet(wb, CATALOG_SHEETS.dictionary, DICTIONARY_COLUMNS, dictRows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- reading ----

export interface RawRow<K extends string> {
  /** The Excel row number. */
  row: number;
  cells: Record<K, string>;
}
export interface RawWorkbook {
  fragrances: RawRow<FragranceKey>[];
  /** Optional «Ароматы» columns the file does not have: their stored values stay. */
  absent: FragranceKey[];
  volumes: RawRow<VolumeKey>[];
  families: RawRow<'nameRu' | 'nameUz'>[];
  notes: RawRow<'nameRu' | 'nameUz'>[];
  /** File-level and header problems; with any, the rows are not to be trusted. */
  issues: ImportIssue[];
}

const fold1 = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A cell's text, or why it cannot be trusted: a formula (its stored result may be stale) or an error value. */
function cellText(cell: ExcelJS.Cell): { text: string; bad?: 'formula_cell' | 'error_cell' } {
  const v = cell.value;
  if (v === null || v === undefined) return { text: '' };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10) };
  if (typeof v === 'number') return { text: String(v) };
  if (typeof v === 'boolean') return { text: v ? YES : NO };
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { text: '', bad: 'formula_cell' };
    if ('error' in v) return { text: '', bad: 'error_cell' };
    // rich text, hyperlinks: the displayed text
    return { text: cell.text.trim() };
  }
  const text = String(v).trim();
  return /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)$/.test(text)
    ? { text: '', bad: 'error_cell' }
    : { text };
}

/**
 * A technical guard against decompression bombs, not a shop rule (so not a setting): the unpacked
 * size of an xlsx may be this many times the upload cap (a real catalog file unpacks to about 10x).
 */
export const UNPACK_RATIO = 20;

/** The sum of the uncompressed sizes in a zip's central directory, read without unpacking; null if unreadable. */
export function zipUnpackedBytes(b: Buffer): number | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || b.readUInt32LE(at) !== 0x02014b50) return null;
    const size = b.readUInt32LE(at + 24);
    total += size === 0xffffffff ? Number.MAX_SAFE_INTEGER : size;
    at += 46 + b.readUInt16LE(at + 28) + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return total;
}

function readTable(
  ws: ExcelJS.Worksheet,
  cols: readonly ColumnDef<string>[],
  sheet: 'fragrances' | 'volumes' | 'dictionary',
  maxRows: number,
  issues: ImportIssue[],
): {
  found: Map<string, number>;
  absent: string[];
  rows: { row: number; get: (key: string) => string }[];
} | null {
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, n) => {
    const t = fold1(cellText(cell).text);
    if (t && !headers.has(t)) headers.set(t, n);
  });
  const found = new Map<string, number>();
  const absent: string[] = [];
  let missing = false;
  for (const c of cols) {
    if (!c.header) continue;
    const n = headers.get(fold1(c.header));
    if (n === undefined && c.optional) absent.push(c.key);
    else if (n === undefined) {
      issues.push({ sheet, row: 1, column: c.header, code: 'missing_column' });
      missing = true;
    } else found.set(c.key, n);
  }
  if (missing) return null;
  if (ws.rowCount - 1 > maxRows) {
    issues.push({ sheet, row: null, column: null, code: 'too_many_rows', params: { max: maxRows } });
    return null;
  }
  const rows: { row: number; get: (key: string) => string }[] = [];
  const flagged = new Set<string>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (key: string) => {
      const at = found.get(key);
      if (at === undefined) return ''; // an optional column the file does not have
      const { text, bad } = cellText(row.getCell(at));
      if (bad) {
        const column = cols.find((c) => c.key === key)!.header;
        const id = `${r}|${column}`;
        if (!flagged.has(id)) {
          flagged.add(id);
          issues.push({ sheet, row: r, column, code: bad });
        }
      }
      return text;
    };
    if ([...found.keys()].every((k) => get(k) === '')) continue;
    rows.push({ row: r, get });
  }
  return { found, absent, rows };
}

/** Reads the three sheets into raw cell text. Throws if the bytes are not a workbook. */
export async function readWorkbook(
  bytes: Buffer,
  limits: { maxRows: number },
): Promise<RawWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const out: RawWorkbook = {
    fragrances: [],
    absent: [],
    volumes: [],
    families: [],
    notes: [],
    issues: [],
  };

  for (const sheet of ['fragrances', 'volumes', 'dictionary'] as const) {
    const ws = wb.getWorksheet(CATALOG_SHEETS[sheet]);
    if (!ws) {
      out.issues.push({
        sheet: 'file',
        row: null,
        column: null,
        code: 'missing_sheet',
        params: { name: CATALOG_SHEETS[sheet] },
      });
      continue;
    }
    if (sheet === 'fragrances') {
      const t = readTable(ws, FRAGRANCE_COLUMNS, sheet, limits.maxRows, out.issues);
      out.absent = (t?.absent ?? []) as FragranceKey[];
      for (const r of t?.rows ?? []) {
        out.fragrances.push({
          row: r.row,
          cells: Object.fromEntries(FRAGRANCE_COLUMNS.map((c) => [c.key, r.get(c.key)])) as Record<
            FragranceKey,
            string
          >,
        });
      }
    } else if (sheet === 'volumes') {
      const t = readTable(ws, VOLUME_COLUMNS, sheet, limits.maxRows, out.issues);
      for (const r of t?.rows ?? []) {
        out.volumes.push({
          row: r.row,
          cells: Object.fromEntries(VOLUME_COLUMNS.map((c) => [c.key, r.get(c.key)])) as Record<
            VolumeKey,
            string
          >,
        });
      }
    } else {
      const t = readTable(ws, DICTIONARY_COLUMNS, sheet, limits.maxRows, out.issues);
      for (const r of t?.rows ?? []) {
        const f = { nameRu: r.get('familyRu'), nameUz: r.get('familyUz') };
        const n = { nameRu: r.get('noteRu'), nameUz: r.get('noteUz') };
        if (f.nameRu || f.nameUz) out.families.push({ row: r.row, cells: f });
        if (n.nameRu || n.nameUz) out.notes.push({ row: r.row, cells: n });
      }
    }
  }
  return out;
}
