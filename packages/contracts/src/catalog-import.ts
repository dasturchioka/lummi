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

export interface ImportStockRow {
  /** The Excel row on «Объёмы». */
  row: number;
  code: string;
  name: string;
  ml: number;
  /** null for a volume the file adds. */
  onHand: number | null;
  newOnHand: number;
  reserved: number;
  /** newOnHand − reserved; negative is a warning (ADR 0010). */
  available: number;
  negative: boolean;
}

export interface ImportCounts {
  fragrances: { new: number; changed: number; unchanged: number; notInFile: number };
  volumes: { new: number; changed: number; unchanged: number };
  families: { new: number; changed: number };
  notes: { new: number; changed: number };
}

export interface ImportReport {
  counts: ImportCounts;
  /** Cut at `ISSUE_CAP`; `errorTotal` / `warningTotal` are the real numbers. */
  errors: ImportIssue[];
  errorTotal: number;
  warnings: ImportIssue[];
  warningTotal: number;
  stock: ImportStockRow[];
  /** Present only when there are no errors; «Применить» sends it back with the same file. */
  token: string | null;
}

export const IMPORT_ISSUE_CAP = 200;

export interface ImportApplied {
  counts: ImportCounts;
}
