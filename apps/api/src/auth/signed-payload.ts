import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignedPayloadFailure =
  'malformed' | 'duplicate_field' | 'bad_signature' | 'stale' | 'future';

export class SignedPayloadError extends Error {
  constructor(readonly reason: SignedPayloadFailure) {
    super(`signed payload rejected: ${reason}`);
  }
}

export interface VerifyOptions {
  botToken: string;
  now: Date;
  maxAgeSeconds: number;
  maxFutureSkewSeconds: number;
}

export interface SignedPayload {
  /** Every field except `hash` and `signature`, values url-decoded once. */
  fields: Map<string, string>;
  authDate: Date;
}

/**
 * The check shared by Mini App initData and the `requestContact` payload (one scheme, ADR 0029/0032):
 * key = HMAC_SHA256(key "WebAppData", msg bot token); `hash` and `signature` are left out of the
 * check string; fields are sorted, joined by "\n"; then `auth_date` must be neither older than
 * `maxAgeSeconds` nor further in the future than `maxFutureSkewSeconds`.
 */
export function verifySignedPayload(raw: string, opts: VerifyOptions): SignedPayload {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (fields.has(key)) throw new SignedPayloadError('duplicate_field');
    fields.set(key, value);
  }

  const received = fields.get('hash');
  if (!received || !/^[0-9a-f]{64}$/.test(received)) throw new SignedPayloadError('malformed');
  fields.delete('hash');
  fields.delete('signature');

  const checkString = [...fields.keys()]
    .sort()
    .map((k) => `${k}=${fields.get(k)}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(received, 'hex'))) {
    throw new SignedPayloadError('bad_signature');
  }

  const authDateRaw = fields.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw new SignedPayloadError('malformed');
  const ageSeconds = opts.now.getTime() / 1000 - Number(authDateRaw);
  if (ageSeconds > opts.maxAgeSeconds) throw new SignedPayloadError('stale');
  if (ageSeconds < -opts.maxFutureSkewSeconds) throw new SignedPayloadError('future');
  return { fields, authDate: new Date(Number(authDateRaw) * 1000) };
}
