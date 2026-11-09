import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type InitDataFailure =
  'malformed' | 'duplicate_field' | 'bad_signature' | 'stale' | 'future';

export class InitDataError extends Error {
  constructor(readonly reason: InitDataFailure) {
    super(`initData rejected: ${reason}`);
  }
}

const userSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});
export type InitDataUser = z.infer<typeof userSchema>;

export interface VerifiedInitData {
  user: InitDataUser;
  authDate: Date;
}

export interface VerifyOptions {
  botToken: string;
  now: Date;
  maxAgeSeconds: number;
  maxFutureSkewSeconds: number;
}

/**
 * Verify Telegram Mini App initData (HMAC path), ADR 0029.
 * Key = HMAC_SHA256(key "WebAppData", msg bot token); `hash` and `signature` are left out of the
 * check string; fields are sorted, joined by "\n", values as received (url-decoded once).
 */
export function verifyInitData(raw: string, opts: VerifyOptions): VerifiedInitData {
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (fields.has(key)) throw new InitDataError('duplicate_field');
    fields.set(key, value);
  }

  const received = fields.get('hash');
  if (!received || !/^[0-9a-f]{64}$/.test(received)) throw new InitDataError('malformed');
  fields.delete('hash');
  fields.delete('signature');

  const checkString = [...fields.keys()]
    .sort()
    .map((k) => `${k}=${fields.get(k)}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest();
  if (!timingSafeEqual(expected, Buffer.from(received, 'hex'))) {
    throw new InitDataError('bad_signature');
  }

  const authDateRaw = fields.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw new InitDataError('malformed');
  const ageSeconds = opts.now.getTime() / 1000 - Number(authDateRaw);
  if (ageSeconds > opts.maxAgeSeconds) throw new InitDataError('stale');
  if (ageSeconds < -opts.maxFutureSkewSeconds) throw new InitDataError('future');

  const userRaw = fields.get('user');
  if (!userRaw) throw new InitDataError('malformed');
  let user: InitDataUser;
  try {
    user = userSchema.parse(JSON.parse(userRaw));
  } catch {
    throw new InitDataError('malformed');
  }
  return { user, authDate: new Date(Number(authDateRaw) * 1000) };
}
