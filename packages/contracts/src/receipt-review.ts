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

/**
 * Why a receipt last went to manual review (#32): the same file as another receipt
 * (`duplicate`), the AI's answer did not confirm it (`not_confirmed`), or the AI could not be
 * asked, attempt after attempt (`judge_failed`). The `receipt_review_reason` enum has these values.
 */
export const RECEIPT_REVIEW_REASONS = ['duplicate', 'not_confirmed', 'judge_failed'] as const;
export type ReceiptReviewReason = (typeof RECEIPT_REVIEW_REASONS)[number];

/**
 * What became of one answer of the receipt AI (#32): it paid the order, sent the receipt to a
 * person, found its credit taken, or came after the receipt was decided (`receipt_check_outcome`).
 */
export const RECEIPT_CHECK_OUTCOMES = [
  'confirmed',
  'manual_review',
  'credit_taken',
  'stale',
] as const;
export type ReceiptCheckOutcome = (typeof RECEIPT_CHECK_OUTCOMES)[number];

/**
 * Verdicts still open, the one list both doors read (ADR 0012): `pending` waits for a fitting
 * credit, `manual_review` for a person. Either may still be confirmed or rejected.
 */
export const WAITING_RECEIPT_VERDICTS: readonly ReceiptVerdict[] = ['pending', 'manual_review'];
/** A receipt that confirmed its order's payment; an order has at most one. */
export const ACCEPTED_RECEIPT_VERDICTS: readonly ReceiptVerdict[] = [
  'ai_confirmed',
  'manager_confirmed',
];

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
