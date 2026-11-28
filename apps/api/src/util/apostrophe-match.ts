import { APOSTROPHE_CLASS, normalizeUzbek, stripApostrophes } from '@lummi/i18n';
import { sql, type SQL } from '@lummi/db';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** The column or expression with every apostrophe variant removed (the stored side of the match). */
export const withoutApostrophes = (column: unknown): SQL =>
  sql`regexp_replace(${column}, ${APOSTROPHE_CLASS}, '', 'g')`;

/**
 * The one admin text search (spec Changes #17 (8)): apostrophe variants are ignored on both
 * sides, so «Devil's», «Devil’s» and «Devils» find the same row and «o'» finds «oʻ». `%` and `_`
 * in what staff type are text, not patterns. Match a stored column with `ilike`.
 */
export function apostropheLike(query: string): string {
  return `%${escapeLike(stripApostrophes(normalizeUzbek(query)))}%`;
}

/** `column` contains `query`, ignoring case and apostrophes. */
export const containsIgnoringApostrophes = (column: unknown, query: string): SQL =>
  sql`${withoutApostrophes(column)} ilike ${apostropheLike(query)}`;
