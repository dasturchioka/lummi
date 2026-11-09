import { z } from 'zod';
import { InitDataError, verifySignedFields, type VerifyOptions } from './init-data';

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
    fields = verifySignedFields(raw, opts.botToken);
  } catch (e) {
    if (e instanceof InitDataError) throw new ContactError('invalid');
    throw e;
  }
  const authDateRaw = fields.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw new ContactError('invalid');
  const age = opts.now.getTime() / 1000 - Number(authDateRaw);
  if (age > opts.maxAgeSeconds || age < -opts.maxFutureSkewSeconds) {
    throw new ContactError('expired');
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
