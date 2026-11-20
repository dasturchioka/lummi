/**
 * Receipt upload vocabulary, zod-free so the Mini App's lazy payment screen reads it from
 * `@lummi/contracts/constants` without the schema runtime (ADR 0030 budget).
 */

/** What a Receipt file may be, told by its first bytes, never its name or header (ADR 0020). */
export const RECEIPT_FILE_KINDS = ['jpeg', 'png', 'webp', 'pdf'] as const;
export type ReceiptFileKind = (typeof RECEIPT_FILE_KINDS)[number];

/**
 * Each kind's content type and file name extensions, the first one the one the shop stores it
 * under. The server reads the content type it serves a file with; the Mini App reads both to
 * pre-check a pick and to tell the system picker what to offer.
 */
export const RECEIPT_FILE_TYPES: Record<ReceiptFileKind, { mime: string; extensions: string[] }> = {
  jpeg: { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  png: { mime: 'image/png', extensions: ['png'] },
  webp: { mime: 'image/webp', extensions: ['webp'] },
  pdf: { mime: 'application/pdf', extensions: ['pdf'] },
};

/** The file input's `accept`: every content type and extension above. */
export const RECEIPT_ACCEPT = Object.values(RECEIPT_FILE_TYPES)
  .flatMap((t) => [t.mime, ...t.extensions.map((e) => `.${e}`)])
  .join(',');

/**
 * Why an upload was refused before it became a Receipt (spec Changes 2026-11-10, #28): another
 * file is needed.
 * - `too_large`: over the setting `receipts.maxUploadMb` (413);
 * - `unsupported_type`: not a JPG, PNG, WebP or PDF by its first bytes, or empty (415);
 * - `unreadable`: the right kind of file, but it cannot be opened (a broken image, a PDF with a
 *   password or no pages, one past the render's memory or time) (422).
 */
export const RECEIPT_UPLOAD_ERRORS = ['too_large', 'unsupported_type', 'unreadable'] as const;
export type ReceiptUploadError = (typeof RECEIPT_UPLOAD_ERRORS)[number];

/**
 * Every answer of `POST /orders/:number/receipts` other than 201, by code, and its HTTP status:
 * the API answers with it and the Mini App reads the code back from it. Besides the refusals
 * above: `not_found` (not the shopper's order), `status_changed` (the order is no longer «Ожидает
 * оплаты»; the body carries it) and `try_again` (busy: the same file may go again in a minute).
 */
export const RECEIPT_UPLOAD_STATUS = {
  not_found: 404,
  status_changed: 409,
  too_large: 413,
  unsupported_type: 415,
  unreadable: 422,
  try_again: 503,
} as const satisfies Record<string, number>;
export type ReceiptUploadCode = keyof typeof RECEIPT_UPLOAD_STATUS;

/** The code a status stands for; null for one the upload never answers. */
export function receiptUploadCode(status: number): ReceiptUploadCode | null {
  const entry = Object.entries(RECEIPT_UPLOAD_STATUS).find(([, s]) => s === status);
  return entry ? (entry[0] as ReceiptUploadCode) : null;
}

/**
 * The most the setting `receipts.maxUploadMb` may allow (its schema's `max`). A technical guard,
 * not a shop rule: the API holds an upload in memory while it checks it, so this bounds one
 * upload's memory whatever the owner sets.
 */
export const RECEIPT_UPLOAD_MAX_MB = 20;

/**
 * The file name the shopper's device gave, kept to show back to them («chek-1042.jpg»), cut to
 * this many characters. A technical guard, not a shop rule.
 */
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
