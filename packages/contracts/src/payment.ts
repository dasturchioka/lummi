import { z } from 'zod';
import { orderSchema } from './orders';
import { RECEIPT_UPLOAD_ERRORS, SHOP_CARD_DIGITS } from './receipt-upload';

/**
 * The shop card as the owner types it: the number with or without spaces and dashes (kept as its
 * 16 digits), and the holder as the bank shows it (spec §4: «Карта … номер + владелец»).
 */
export const shopCardInputSchema = z.object({
  number: z
    .string()
    .max(40)
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(new RegExp(`^[0-9]{${SHOP_CARD_DIGITS}}$`), 'card_number')),
  holder: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(2).max(100)),
});
export type ShopCardInput = z.input<typeof shopCardInputSchema>;

/** `PUT /admin/shop-card` as sent; the handler reads it with `shopCardInputSchema`. */
export const shopCardBodySchema = z.object({
  number: z.string().max(40),
  holder: z.string().max(200),
});
/** 400: the fields that did not pass (`number`: not 16 digits; `holder`: under 2 or over 100 letters). */
export const shopCardErrorSchema = z.object({
  code: z.literal('invalid'),
  fields: z.array(z.enum(['number', 'holder'])),
});

/** The card a shopper transfers to: 16 digits and the holder. */
export const shopCardSchema = z.object({ number: z.string(), holder: z.string() });
export type ShopCardDto = z.infer<typeof shopCardSchema>;

/** The owner's view: the card and when it was last changed; null while none is set. */
export const adminShopCardSchema = z.object({
  card: shopCardSchema.extend({ updatedAt: z.string().datetime() }).nullable(),
});
export type AdminShopCardDto = z.infer<typeof adminShopCardSchema>;

/** One uploaded Receipt as its shopper sees it (newest first on the payment screen). */
/**
 * What became of a Receipt, as the shopper may know it (ADR 0011: «Чек на проверке» whether the AI
 * or a person is checking): still being checked, accepted, rejected by a manager, or «оплата не
 * найдена» after the wait window (`not_found`) or at once as a repeat of another order's (`repeat`, #36).
 */
export const RECEIPT_STATES = ['checking', 'accepted', 'rejected', 'not_found', 'repeat'] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];

export const receiptSummarySchema = z.object({
  id: z.number().int(),
  state: z.enum(RECEIPT_STATES),
  createdAt: z.string().datetime(),
  /** The name the shopper's device gave the file; null when it gave none. */
  fileName: z.string().nullable(),
  /** The original's size in bytes. */
  size: z.number().int().positive(),
  kind: z.enum(['image', 'pdf']),
});
export type ReceiptSummaryDto = z.infer<typeof receiptSummarySchema>;

/**
 * What the payment screen needs (spec Changes 2026-11-07 payment details): the order, the shop
 * card to transfer to (null: «Оплата временно недоступна»), the receipts sent so far and the
 * upload limit (setting `receipts.maxUploadMb`, in bytes).
 */
export const paymentSchema = z.object({
  order: orderSchema,
  card: shopCardSchema.nullable(),
  receipts: z.array(receiptSummarySchema),
  maxUploadBytes: z.number().int().positive(),
});
export type PaymentDto = z.infer<typeof paymentSchema>;

/** 201 of `POST /orders/:number/receipts`: the new Receipt and the order now «Чек на проверке». */
export const receiptUploadedSchema = z.object({
  receipt: receiptSummarySchema,
  order: orderSchema,
});
export type ReceiptUploadedDto = z.infer<typeof receiptUploadedSchema>;

/**
 * A refused upload (413, 415, 422) or a busy server (503 `try_again`), statuses per
 * `RECEIPT_UPLOAD_STATUS`; `maxBytes` comes with `too_large`.
 */
export const receiptUploadErrorSchema = z.object({
  code: z.enum([...RECEIPT_UPLOAD_ERRORS, 'try_again']),
  maxBytes: z.number().int().positive().optional(),
});
export type ReceiptUploadErrorDto = z.infer<typeof receiptUploadErrorSchema>;

/** 503 of `POST /orders`: no shop card is set, so checkout is closed (spec Changes 2026-11-07). */
export const paymentUnavailableSchema = z.object({ code: z.literal('payment_unavailable') });
