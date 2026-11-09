import { z } from 'zod';
import { SignedPayloadError, verifySignedPayload, type VerifyOptions } from './signed-payload';

const contactSchema = z.object({
  user_id: z.number().int().positive(),
  phone_number: z.string().min(1).max(32),
});

export type ContactFailure = 'invalid' | 'expired' | 'not_yours';

export class ContactError extends Error {
  constructor(readonly reason: ContactFailure) {
    super(`contact rejected: ${reason}`);
  }
}

/** Telegram sends the number with or without "+"; we keep one form, `+` and 7 to 15 digits (E.164). */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '').replace(/^\+/, '');
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : null;
}

/**
 * Verify the signed payload `requestContact` returns (`contact=<json>&auth_date=..&hash=..`).
 * Telegram signs it with the bot token like initData, so the number cannot be edited in transit.
 * The phone is accepted only when the contact's user_id is the signed-in Telegram user (ADR 0004).
 */
export function verifyContactProof(
  raw: string,
  sessionTelegramId: number,
  opts: VerifyOptions,
): { phone: string } {
  let fields;
  try {
    ({ fields } = verifySignedPayload(raw, opts));
  } catch (e) {
    if (!(e instanceof SignedPayloadError)) throw e;
    throw new ContactError(e.reason === 'stale' || e.reason === 'future' ? 'expired' : 'invalid');
  }
  let contact;
  try {
    contact = contactSchema.parse(JSON.parse(fields.get('contact') ?? ''));
  } catch {
    throw new ContactError('invalid');
  }
  if (contact.user_id !== sessionTelegramId) throw new ContactError('not_yours');
  const phone = normalizePhone(contact.phone_number);
  if (!phone) throw new ContactError('invalid');
  return { phone };
}
