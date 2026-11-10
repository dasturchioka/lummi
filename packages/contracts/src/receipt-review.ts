/**
 * Receipt verdicts and the reasons a manager rejects one with (ADR 0011, 0012, 0013), zod-free
 * so the admin's dialogs and the bot's messages share one list.
 */

/**
 * A Receipt's verdict: it waits (`pending`) until the AI or a manager confirms it, the AI hands it
 * to a person (`manual_review`), a manager rejects it with a reason, or the wait window ends with
 * `payment_not_found`. The order's status is separate. The `receipt_verdict` enum has these values.
 */
export const RECEIPT_VERDICTS = [
  'pending',
  'ai_confirmed',
  'manual_review',
  'manager_confirmed',
  'rejected',
  'payment_not_found',
] as const;
export type ReceiptVerdict = (typeof RECEIPT_VERDICTS)[number];

/** Verdicts still open: the receipt may yet be confirmed or rejected. */
export const WAITING_RECEIPT_VERDICTS: readonly ReceiptVerdict[] = ['pending', 'manual_review'];

/**
 * Why a manager rejects a receipt (only a manager does, ADR 0013). The shopper reads the reason
 * as a sentence in their language; `other` is the manager's own words, typed into the note.
 */
export const RECEIPT_REJECT_REASONS = [
  'amount_mismatch',
  'wrong_card',
  'not_received',
  'unreadable',
  'not_a_receipt',
  'other',
] as const;
export type ReceiptRejectReason = (typeof RECEIPT_REJECT_REASONS)[number];

/** The hard cap on a rejection note; the setting `receipts.rejectNoteMaxLength` is the working limit. */
export const RECEIPT_REJECT_NOTE_HARD_MAX = 500;
