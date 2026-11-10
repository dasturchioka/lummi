/**
 * Receipt upload vocabulary, zod-free so the Mini App's lazy payment screen reads it from
 * `@lummi/contracts/constants` without the schema runtime (ADR 0030 budget).
 */

/** What a Receipt file may be, told by its first bytes, never its name or header (ADR 0020). */
export const RECEIPT_FILE_KINDS = ['jpeg', 'png', 'webp', 'pdf'] as const;
export type ReceiptFileKind = (typeof RECEIPT_FILE_KINDS)[number];

/**
 * Why an upload was refused before it became a Receipt (spec Changes 2026-11-10, #28):
 * - `too_large`: over the setting `receipts.maxUploadMb` (413);
 * - `unsupported_type`: not a JPG, PNG, WebP or PDF by its first bytes, or empty (415);
 * - `unreadable`: the right kind of file, but it cannot be opened (a broken image, a PDF with a
 *   password or no pages) (422).
 */
export const RECEIPT_UPLOAD_ERRORS = ['too_large', 'unsupported_type', 'unreadable'] as const;
export type ReceiptUploadError = (typeof RECEIPT_UPLOAD_ERRORS)[number];

/**
 * The body parser's ceiling for an upload, above the setting's own bound (20 MB), so an upload
 * between the setting and this ceiling is answered with our `too_large`, not a bare 413.
 */
export const RECEIPT_UPLOAD_CEILING_BYTES = 21 * 1024 * 1024;

/** The file name the shopper's device gave, kept to show back to them («chek-1042.jpg»). */
export const RECEIPT_FILE_NAME_MAX = 200;

/** The header that carries the file name (URI-encoded) on `POST /orders/:number/receipts`. */
export const RECEIPT_FILE_NAME_HEADER = 'x-file-name';

/** The shop card: 16 digits (Humo, Uzcard, Visa, Mastercard), shown in groups of four. */
export const SHOP_CARD_DIGITS = 16;

/** `9860123412341234` → `9860 1234 1234 1234`. */
export function groupCardNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The card as the audit log keeps it: the first four and the last four digits only. */
export function maskCardNumber(digits: string): string {
  return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
}
