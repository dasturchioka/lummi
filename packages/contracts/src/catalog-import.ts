/**
 * Excel catalog import (ticket #26, spec Changes 2026-11-07). The upload and the xlsx download sit
 * outside the ts-rest contract (raw bodies); this file is the shape of the report they answer with.
 * Texts are not in the report: the admin renders each `code` in the staff member's language.
 */
export const CATALOG_IMPORT_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The template's sheets, in order (their names are the RU titles of the file). */
export const CATALOG_SHEETS = {
  fragrances: 'Ароматы',
  volumes: 'Объёмы',
  dictionary: 'Справочник',
} as const;
export type ImportSheet = keyof typeof CATALOG_SHEETS | 'file';

/** A problem in the file. `row` is the Excel row number, `column` the header as written in the file. */
export interface ImportIssue {
  sheet: ImportSheet;
  row: number | null;
  column: string | null;
  code: string;
  params?: Record<string, string | number>;
}

/** A fragrance's ready concentrate the file counts (ADR 0043), ml. */
export interface ImportStockRow {
  /** The Excel row on «Ароматы». */
  row: number;
  code: string;
  name: string;
  /** null for a fragrance the file adds. */
  concentrateMl: number | null;
  newConcentrateMl: number;
  reservedMl: number;
  /** newConcentrateMl − reservedMl; negative is a warning (ADR 0010). */
  availableMl: number;
  negative: boolean;
}

export interface ImportCounts {
  fragrances: { new: number; changed: number; unchanged: number; notInFile: number };
  volumes: { new: number; changed: number; unchanged: number };
  families: { new: number; changed: number };
  notes: { new: number; changed: number };
}

/** One value of a change; arrays are lists (notes, key notes, aliases, similar codes). */
export type ImportValue = string | number | boolean | null | string[];
export interface ImportChangeField {
  /** `price`, `salePrice`, `saleEndsOn`, `concentrateMl`, or a fragrance column key (`descriptionRu`, `topNotes` …). */
  field: string;
  before: ImportValue;
  after: ImportValue;
}
/** Something «Применить» will write, by name: prices and markdowns first, then stock, then content. */
export interface ImportChange {
  kind: 'new' | 'changed';
  group: 'price' | 'stock' | 'content';
  /** The Excel row (on «Объёмы» for a volume, on «Ароматы» for a fragrance and its concentrate). */
  row: number;
  code: string;
  name: string;
  /** Null for a change to the fragrance itself. */
  ml: number | null;
  fields: ImportChangeField[];
}

export interface ImportReport {
  counts: ImportCounts;
  /** Cut at `ISSUE_CAP`; `errorTotal` / `warningTotal` are the real numbers. */
  errors: ImportIssue[];
  errorTotal: number;
  warnings: ImportIssue[];
  warningTotal: number;
  stock: ImportStockRow[];
  /** Every change by name, before → after; cut at `IMPORT_CHANGE_CAP`, `changeTotal` is the real number. */
  changes: ImportChange[];
  changeTotal: number;
  /** Present only when there are no errors; «Применить» sends it back with the same file. */
  token: string | null;
}

export const IMPORT_ISSUE_CAP = 200;
export const IMPORT_CHANGE_CAP = 500;

export interface ImportApplied {
  counts: ImportCounts;
  /** Counts the file set that now sit below what open orders reserve (recounted under the locks). */
  warnings: ImportIssue[];
}

/** Every `code` an `ImportIssue` can carry; the admin has an RU and a UZ text for each (tested). */
export const IMPORT_ISSUE_CODES = [
  'not_xlsx',
  'too_big',
  'too_unpacked',
  'too_many_rows',
  'missing_sheet',
  'missing_column',
  'write_conflict',
  'rejected',
  'required',
  'invalid',
  'too_long',
  'bad_url',
  'bad_code',
  'duplicate_code',
  'duplicate_value',
  'duplicate_volume',
  'duplicate_similar',
  'duplicate_note',
  'unknown_code',
  'need_a_volume',
  'bad_name',
  'name_taken',
  'bad_flag',
  'bad_option',
  'unknown_note',
  'unknown_family',
  'unknown_similar',
  'self_similar',
  'three_key_notes',
  'bad_ml',
  'bad_number',
  'bad_date',
  'sale_below_price',
  'end_without_sale',
  'sale_ended',
  'below_reserve',
  'comma_in_note',
  'formula_cell',
  'error_cell',
] as const;
