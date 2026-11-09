import { z } from 'zod';

/**
 * Internal endpoints (ADR 0031): only the userbot calls them, from the internal network, with the
 * shared secret in this header. The Mini App and admin never do.
 */
export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/** One message from the Humo bot chat, posted as received (ADR 0014). */
export const humoMessageBodySchema = z.object({
  /** Telegram message id. Idempotency key; in a user account it grows across all private chats. */
  messageId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /** The text exactly as received (Telegram caps a message at 4096 characters). */
  text: z
    .string()
    .max(4096)
    .refine((t) => !t.includes('\u0000'), 'text must not contain NUL (U+0000)'),
});

export const humoMessageResultSchema = z.object({
  /** credit: recorded (or had been); debit: ignored, nothing stored; unparseable: stored raw and flagged. */
  outcome: z.enum(['credit', 'debit', 'unparseable']),
  /** This message_id was stored before; nothing was recorded or alerted again. */
  duplicate: z.boolean(),
  creditId: z.number().int().nullable(),
});
export type HumoMessageResult = z.infer<typeof humoMessageResultSchema>;

/** The highest stored message_id: the userbot reads the Humo chat after it on restart. Null before the first. */
export const humoLastMessageIdSchema = z.object({ messageId: z.number().int().nullable() });

export const internalErrorSchema = z.object({ code: z.enum(['unauthorized', 'forbidden']) });
